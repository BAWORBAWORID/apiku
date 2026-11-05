import dns from 'dns';
import net from 'net';
import { URL } from 'url';

const BLOCKED_HOSTNAMES = [
  'localhost', 'localhost.localdomain', 'local', 'ip6-localhost', 'ip6-local',
  'broadcasthost', '0.0.0.0', 'metadata.google.internal',
  'instance-metadata', '[fd00::]',
];

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/;

/**
 * Normalize an IPv6 address to its full expanded form (8 groups of 4 hex digits).
 * Handles ::-compression, IPv4-mapped tails (::ffff:127.0.0.1), and zone IDs (fe80::1%eth0).
 * Returns null if not a valid IPv6 address.
 */
function expandIPv6(ip) {
  let s = String(ip).split('%')[0].toLowerCase(); // strip zone id
  if (!s.includes(':')) return null;

  // IPv4-mapped / IPv4-compatible tail: ::ffff:192.168.1.1
  const v4match = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let v4Groups = [];
  if (v4match) {
    const parts = v4match[2].split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    v4Groups = [
      ((parts[0] << 8) | parts[1]).toString(16),
      ((parts[2] << 8) | parts[3]).toString(16),
    ];
    s = v4match[1] + v4Groups.join(':');
  }

  // Handle :: compression
  const dblColon = s.split('::');
  if (dblColon.length > 2) return null; // more than one "::" is invalid
  const head = dblColon[0] ? dblColon[0].split(':') : [];
  const tail = dblColon.length === 2 && dblColon[1] ? dblColon[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  if (dblColon.length === 1 && missing !== 0) return null; // no "::" but wrong group count

  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const expanded = groups.map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    return g.padStart(4, '0');
  });
  if (expanded.some((g) => g === null)) return null;
  return expanded.join(':');
}

function isPrivateIP(ip) {
  if (!ip) return false;
  const raw = String(ip).trim().toLowerCase();

  // IPv4 checks (also applies to bracketed forms, e.g. "[127.0.0.1]")
  const bare = raw.replace(/^\[|\]$/g, '');
  if (PRIVATE_IP_RE.test(bare)) return true;
  if (bare.startsWith('169.254.')) return true;
  if (bare === '0.0.0.0' || bare === '::ffff:0.0.0.0') return true;

  // IPv6 checks — expand to full form first so compressed forms like ::1, fc00::1,
  // ::ffff:127.0.0.1 are all caught
  const expanded = expandIPv6(bare);
  if (expanded) {
    if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true; // ::1 loopback
    if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return true; // :: unspecified
    if (/^0000:0000:0000:0000:0000:ffff:/.test(expanded)) {
      // IPv4-mapped: last 2 groups encode the mapped IPv4 (e.g. ::ffff:7f00:1 → 127.0.0.1)
      const tail2 = expanded.split(':').slice(6);
      let mapped = null;
      if (/\./.test(bare.replace(/^.*ffff:/, ''))) {
        mapped = bare.replace(/^.*ffff:/, ''); // dotted form
      } else {
        const hi = parseInt(tail2[0], 16), lo = parseInt(tail2[1], 16);
        mapped = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
      }
      if (mapped && (PRIVATE_IP_RE.test(mapped) || mapped.startsWith('169.254.'))) return true;
    }
    const first = expanded.slice(0, 4);
    if (first.startsWith('fc') || first.startsWith('fd')) return true; // ULA fc00::/7
    if (['fe8', 'fe9', 'fea', 'feb'].some((p) => first.startsWith(p))) return true; // link-local fe80::/10
    if (first.startsWith('ff')) return true; // multicast
    if (first === '0100' || first === '0101') return true; // discard-only 100::/64 & neighbors
    if (expanded.startsWith('2001:0db8')) return true; // documentation range
    if (expanded.startsWith('2001:0000')) return true; // Teredo
  }

  return false;
}

function validateUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error(`Blocked protocol: ${protocol} (only http/https allowed)`);
  }

  // WHATWG URL keeps brackets on IPv6 literals ("[::1]") — strip for checks
  const hostnameRaw = parsed.hostname.toLowerCase();
  const hostname = hostnameRaw.replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.includes(hostnameRaw) || BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error(`Blocked hostname: ${hostnameRaw}`);
  }

  // IP literal (v4 or v6): validate directly — no DNS needed
  if (net.isIPv4(hostname) || net.isIPv6(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked private/reserved IP: ${hostnameRaw}`);
    }
    return { parsed, hostname, isIP: true };
  }

  if (isPrivateIP(hostname)) {
    throw new Error(`Blocked private/reserved IP: ${hostnameRaw}`);
  }

  return { parsed, hostname, isIP: false };
}

async function resolveDNS(hostname) {
  const v4 = await new Promise((resolve) => {
    dns.resolve4(hostname, (err, addrs) => err ? resolve([]) : resolve(addrs));
  });
  const v6 = await new Promise((resolve) => {
    dns.resolve6(hostname, (err, addrs) => err ? resolve([]) : resolve(addrs));
  });
  return [...v4, ...v6];
}

async function validateResolvedIPs(hostname) {
  const addresses = await resolveDNS(hostname);
  if (addresses.length === 0) {
    throw new Error(`SSRF blocked: cannot resolve ${hostname}`);
  }
  for (const ip of addresses) {
    if (isPrivateIP(ip)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${ip}`);
    }
  }
}

export async function safeFetch(urlStr, opts = {}) {
  const { parsed, hostname, isIP } = validateUrl(urlStr);
  if (!isIP) {
    await validateResolvedIPs(hostname);
  }

  const timeout = opts.timeout || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const { signal: _, ...fetchOpts } = opts;
    const res = await fetch(urlStr, {
      ...fetchOpts,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...opts.headers,
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function safeFetchBuffer(urlStr, opts = {}) {
  const res = await safeFetch(urlStr, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function safeFetchJSON(urlStr, opts = {}) {
  const res = await safeFetch(urlStr, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export { validateUrl as validateSSRFUrl, isPrivateIP };
