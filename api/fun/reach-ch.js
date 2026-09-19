/**
 * Reach CH — WhatsApp Channel Reaction Automation
 * Provider: Keyyss React (react.keyysspanel.web.id)
 * Fitur   : Mengirim reaksi emoji ke postingan channel WhatsApp via Turnstile solver (bycf) & fast HTTP proxy pool
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { shz as bycf } from 'bycf';
import logger from '../../src/utils/logger.js';

const CREATOR = 'Always Codex';
const BASE_URL = 'https://react.keyysspanel.web.id';
const TURNSTILE_FALLBACK_SITEKEY = '0x4AAAAAAErNYkwC4FusFhKz';
const PROXYSCRAPE_API_KEY = process.env.PROXYSCRAPE_API_KEY || 'bYUUcDxaPvupyNuMBn6wTJnR5f6PehQ08i6AvyHYwKGSpZDQear1Wb4YJ7gm5Ozz';

function parseSetCookies(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .map(line => line.split(';')[0].trim())
    .filter(Boolean);
}

function createCookieJar() {
  return new Map();
}

function storeCookies(jar, res) {
  if (!jar || !res || !res.headers) return;
  for (const cookie of parseSetCookies(res)) {
    const eq = cookie.indexOf('=');
    if (eq > 0) {
      jar.set(cookie.slice(0, eq), cookie.slice(eq + 1));
    }
  }
}

function request(url, options = {}, postData = null, proxy = null, jar = null) {
  const timeoutMs = options.timeout || 15000;
  return new Promise((outerResolve, outerReject) => {
    let settled = false;
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(deadline); fn(v); } };

    const deadline = setTimeout(() => {
      settle(outerReject, new Error(`Timeout ${timeoutMs}ms: ${url}${proxy ? ` (via ${proxy})` : ''}`));
    }, timeoutMs);

    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const defaultPort = isHttps ? 443 : 80;
    const targetPort = u.port || defaultPort;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Host: u.hostname,
      ...options.headers
    };

    if (jar && jar.size > 0) {
      headers['Cookie'] = [...jar.values()].join('; ');
    }

    const finish = (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        settle(outerResolve, {
          statusCode: response.statusCode,
          headers: response.headers,
          body: data
        });
      });
      response.on('error', (e) => settle(outerReject, e));
    };

    if (proxy) {
      const [proxyHost, proxyPortStr] = proxy.replace(/^https?:\/\//, '').split(':');
      const proxyPort = parseInt(proxyPortStr, 10) || 8080;

      const connectReq = http.request({
        host: proxyHost,
        port: proxyPort,
        method: 'CONNECT',
        path: `${u.hostname}:${targetPort}`,
        headers: { Host: `${u.hostname}:${targetPort}` }
      });

      connectReq.on('connect', (res, socket) => {
        if (settled) { socket.destroy(); return; }
        if (res.statusCode !== 200) {
          socket.destroy();
          return settle(outerReject, new Error(`Proxy CONNECT returned ${res.statusCode}`));
        }

        const proceedWithSocket = (networkSocket) => {
          if (settled) { networkSocket.destroy(); return; }
          const req = (isHttps ? https : http).request({
            hostname: u.hostname,
            port: targetPort,
            path: u.pathname + u.search,
            method: options.method || 'GET',
            createConnection: () => networkSocket,
            headers
          }, (response) => finish(response));

          req.on('error', (e) => settle(outerReject, e));
          if (postData) {
            req.write(postData);
          }
          req.end();
        };

        if (isHttps) {
          const tlsSocket = tls.connect({
            socket,
            servername: u.hostname,
            rejectUnauthorized: false
          }, () => proceedWithSocket(tlsSocket));
          tlsSocket.on('error', (e) => settle(outerReject, e));
        } else {
          proceedWithSocket(socket);
        }
      });

      connectReq.on('error', (e) => settle(outerReject, e));
      connectReq.end();
      return;
    }

    const client = isHttps ? https : http;
    const req = client.request({
      hostname: u.hostname,
      port: targetPort,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers
    }, (response) => finish(response));

    req.on('error', (e) => settle(outerReject, e));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function jsonRequest(url, { method = 'GET', body = null, headers = {}, timeout = 15000, proxy = null, jar = null } = {}) {
  const payload = body === null ? null : JSON.stringify(body);
  const res = await request(url, {
    method,
    timeout,
    headers: {
      Accept: 'application/json',
      ...(payload !== null ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}),
      ...headers
    }
  }, payload, proxy, jar);

  storeCookies(jar, res);

  try {
    return { res, json: JSON.parse(res.body) };
  } catch {
    return { res, json: null };
  }
}

async function fetchProxyScrapeList() {
  const endpoint = `https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=http&ssl=yes&api_key=${encodeURIComponent(PROXYSCRAPE_API_KEY)}`;

  const res = await request(endpoint, { timeout: 10000 });
  if (res.statusCode !== 200 || !res.body) {
    throw new Error(`ProxyScrape API error (${res.statusCode}): ${(res.body || '').slice(0, 120)}`);
  }

  const list = res.body
    .trim()
    .split(/\r?\n/)
    .map(p => p.trim())
    .filter(p => /^https?:\/\//i.test(p))
    .map(p => p.replace(/^https?:\/\//i, ''))
    .filter(p => /^[^:\s]+:\d{2,5}$/.test(p));

  return [...new Set(list)];
}

async function solveTurnstile(siteKey = TURNSTILE_FALLBACK_SITEKEY, targetPageUrl = BASE_URL) {
  const token = await bycf.turnstileMin(targetPageUrl || BASE_URL, siteKey);
  if (!token || typeof token !== 'string') {
    throw new Error('Gagal mendapatkan captcha token dari bycf');
  }
  return token;
}

async function findWorkingProxies(want = 4) {
  const list = await fetchProxyScrapeList();
  // Acak pool dan ambil sampel hingga 120 proxy
  const shuffled = list.sort(() => Math.random() - 0.5).slice(0, 120);

  const results = await Promise.all(shuffled.map(async (proxyAddr) => {
    try {
      const jar = createCookieJar();
      const { res, json } = await jsonRequest(`${BASE_URL}/api/free/status`, { timeout: 2500, proxy: proxyAddr, jar });
      if (res.statusCode === 200 && json && typeof json.uid === 'string' && json.uid && json.limit > 0 && !json.ipBlocked) {
        return { proxy: proxyAddr, uid: json.uid, limit: json.limit || 0, jar };
      }
    } catch {}
    return null;
  }));

  const candidates = results.filter(Boolean);
  if (!candidates.length) {
    throw new Error('Tidak ada proxy ProxyScrape yang berhasil terhubung dengan limit reaksi.');
  }

  candidates.sort((a, b) => b.limit - a.limit);
  return candidates.slice(0, want);
}

async function getTurnstileStatus(proxy = null) {
  try {
    const { json } = await jsonRequest(`${BASE_URL}/api/turnstile/status`, { timeout: 5000, proxy });
    if (json && json.siteKey) return json;
  } catch {}
  return { configured: true, siteKey: TURNSTILE_FALLBACK_SITEKEY };
}

async function getFreeStatus(proxy = null, jar = null) {
  const { res, json } = await jsonRequest(`${BASE_URL}/api/free/status`, { timeout: 5000, proxy, jar });
  return (res.statusCode === 200 && json) ? json : null;
}

async function getVipSession(vipKey, proxy = null, jar = null) {
  const { res, json } = await jsonRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    timeout: 10000,
    proxy,
    jar,
    body: { key: vipKey }
  });

  if (res.statusCode === 200 && json && json.success && json.user) {
    return json.user;
  }
  return null;
}

async function sendReaction({ channelLink, emojis = '👍', vipKey = null, useProxy = false }) {
  const startTime = Date.now();
  let useProxyLocal = useProxy;

  if (!useProxyLocal && !vipKey) {
    try {
      const sData = await getFreeStatus(null);
      if (sData && (sData.limit <= 0 || sData.ipBlocked)) {
        useProxyLocal = true;
      }
    } catch {
      useProxyLocal = true;
    }
  }

  // 1. Eksekusi pencarian proxy dan Turnstile solving secara konruen (paralel)
  const [candidates, turnstileToken] = await Promise.all([
    useProxyLocal ? findWorkingProxies(4) : Promise.resolve([{ proxy: null, uid: null, limit: 0, jar: createCookieJar() }]),
    solveTurnstile(TURNSTILE_FALLBACK_SITEKEY, BASE_URL)
  ]);

  let activeProxy = null;
  let uid = null;
  let vipUser = null;
  let jar = null;
  let isSuccess = false;
  let messageDetail = '';
  let lastError = null;

  for (let ci = 0; ci < candidates.length; ci++) {
    activeProxy = candidates[ci].proxy;
    jar = candidates[ci].jar || createCookieJar();
    uid = candidates[ci].uid;
    vipUser = null;

    try {
      if (!uid && !vipKey) {
        const free = await getFreeStatus(activeProxy, jar);
        if (free && free.uid) uid = free.uid;
      }

      if (vipKey) {
        vipUser = await getVipSession(vipKey, activeProxy, jar);
        if (vipUser && vipUser.key) {
          uid = vipUser.key;
        }
      }

      if (!uid) {
        throw new Error('Gagal mendapatkan UID sesi');
      }

      const payload = JSON.stringify({
        link: channelLink,
        emoji: emojis,
        'cf-turnstile-response': turnstileToken
      });

      const submitRes = await request(`${BASE_URL}/api/react`, {
        method: 'POST',
        timeout: 18000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Origin': BASE_URL,
          'Referer': `${BASE_URL}/`
        }
      }, payload, activeProxy, jar);

      storeCookies(jar, submitRes);
      logger.info(`[REACH-CH] Proxy ${activeProxy} -> code: ${submitRes.statusCode}, body: ${submitRes.body}`);

      let jsonResp = null;
      try {
        jsonResp = JSON.parse(submitRes.body);
      } catch {}

      isSuccess = Boolean(jsonResp && jsonResp.success);
      messageDetail = (jsonResp && jsonResp.message) ||
        (submitRes.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) ||
        'Gagal memproses reaksi';

      if (isSuccess) {
        break;
      }

      // Jika gagal atau ditolak provider/proxy, coba kandidat proxy berikutnya
      const msgLower = messageDetail.toLowerCase();
      const retryable = /(cooldown|limit|blacklist|blocked|coba lagi|try again|provider|menolak|gagal memproses|bad gateway)/.test(msgLower);
      if (retryable && ci < candidates.length - 1) {
        continue;
      }
      break;
    } catch (err) {
      lastError = err;
      if (ci < candidates.length - 1) {
        continue;
      }
    }
  }

  if (!isSuccess && !messageDetail && lastError) {
    throw lastError;
  }

  const durationMs = Date.now() - startTime;

  return {
    success: isSuccess,
    message: messageDetail || (lastError ? lastError.message : 'Gagal'),
    target: channelLink,
    emojis: emojis.split(',').map(e => e.trim()).filter(Boolean),
    vip: Boolean(vipUser),
    key: vipUser ? vipUser.key : uid,
    proxy: activeProxy || null,
    duration: `${(durationMs / 1000).toFixed(2)}s`
  };
}

function formatEmojis(str) {
  if (!str) return '👍';
  if (str.includes(',')) {
    return str.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4).join(',');
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segs = [...segmenter.segment(str.trim())].map(s => s.segment).filter(s => s.trim() && s !== ' ');
  return segs.slice(0, 4).join(',') || '👍';
}

export default {
  name: "Reach CH",
  description: "Kirim reaksi emoji otomatis ke postingan WhatsApp Channel",
  category: "FUN",
  methods: ["GET", "POST"],
  params: ["url", "emoji"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/xxx/123)",
      example: "https://whatsapp.com/channel/0029Vb8EfuN35fM5AX25AT1W/1360"
    },
    emoji: {
      type: "string",
      required: false,
      default: "👍",
      description: "Emoji reaksi (bisa dipisah koma jika multi emoji, contoh: 👍,🔥,❤️ atau ⚡💥)",
      example: "⚡💥"
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const channelUrl = String(params.url || params.link || params.channelLink || '').trim();
      const rawEmoji = String(params.emoji || params.emojis || '👍').trim() || '👍';
      const formattedEmojis = formatEmojis(rawEmoji);
      const vipKey = params.key || params.vipKey || null;
      const useProxy = params.proxy === 'true' || params.proxy === true || params.proxy === '1';

      if (!channelUrl) {
        return res.status(400).json({
          status: false,
          creator: CREATOR,
          message: "Parameter 'url' wajib diisi dengan tautan postingan channel WhatsApp."
        });
      }

      if (!/^https?:\/\/(www\.)?whatsapp\.com\/channel\/[^\/]+\/\d+/i.test(channelUrl)) {
        return res.status(400).json({
          status: false,
          creator: CREATOR,
          message: "Format URL tidak valid. Contoh yang benar: https://whatsapp.com/channel/0029Vb8EfuN35fM5AX25AT1W/1360"
        });
      }

      logger.info(`[REACH-CH] Mengirim reaksi ${formattedEmojis} ke ${channelUrl}`);

      const result = await sendReaction({
        channelLink: channelUrl,
        emojis: formattedEmojis,
        vipKey,
        useProxy
      });

      return res.status(result.success ? 200 : 400).json({
        status: result.success,
        creator: CREATOR,
        message: result.message,
        result
      });
    } catch (err) {
      logger.error(`[REACH-CH] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        creator: CREATOR,
        message: err.message || "Terjadi kesalahan internal saat memproses reaksi"
      });
    }
  }
};
