/**
 * SFL.gl Bypass API
 * Engine: JH a.k.a Dhika (sfl.gl gate solver) — auto handle session, verify, dan /api/go
 * Result: URL gateway berikutnya (mis. adlinksumo.com), bukan selalu link final
 *
 * GET/POST /api/bypass/sflgl?url=https://sfl.gl/xxxx
 */

const SFL_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const VW = 392;
const VH = 687;
const MAX_HOP = 10;
const MAX_ROUND = 5;
const GATE_RE = /id=["']verify["']/i;

function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

class SflError extends Error {
  constructor(msg, raw) {
    super(msg);
    this.raw = raw;
  }
}

const rawOf = (e) =>
  [e && e.name, e && e.message, e && e.cause && (e.cause.code || e.cause.message)]
    .filter(Boolean)
    .join(" | ");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSfl = (h) => /(^|\.)sfl\.gl$/i.test(h);

function bersih(finalUrl) {
  const SKIP = /(^|\.)(sfl\.gl|w3\.org|google\.com|googleapis\.com|gstatic\.com|cloudflare\.com|jquery\.com|facebook\.com|twitter\.com)$/i;
  const base = new URL(finalUrl);
  for (const mm of finalUrl.replace(/\\+\//g, "/").matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) {
    try {
      const u = new URL(mm[0]);
      if (!SKIP.test(u.hostname)) return u.href;
    } catch {}
  }
  return null;
}

function buildHeaders() {
  return {
    "Accept-Language": "id-ID,id;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="147", "Not.A/Brand";v="8"',
    "Sec-Ch-Ua-Mobile": "?1",
    "Sec-Ch-Ua-Platform": '"Android"',
    "User-Agent": SFL_UA,
  };
}

function createSolver(axios) {
  const jar = new Map();

  const storeCookies = (host, res) => {
    const raw = res.headers["set-cookie"] || [];
    if (!jar.has(host)) jar.set(host, new Map());
    const store = jar.get(host);
    for (const c of [].concat(raw)) {
      const parts = c.split(";");
      const kv = parts[0];
      const i = kv.indexOf("=");
      if (i < 1) continue;
      const name = kv.slice(0, i).trim();
      const val = kv.slice(i + 1).trim();
      if (/max-age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c)) store.delete(name);
      else store.set(name, val);
    }
  };

  const cookieHeader = (host) => {
    const store = jar.get(host);
    if (!store || !store.size) return "";
    return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  };

  const http = async (url, { method = "GET", json, referer } = {}) => {
    const u = new URL(url);
    const headers = buildHeaders();
    const ck = cookieHeader(u.host);
    if (ck !== "") headers["Cookie"] = ck;
    if (referer) headers["Referer"] = referer;
    let data;
    if (method === "POST") {
      headers["Accept"] = "*/*";
      headers["Content-Type"] = "application/json";
      headers["Origin"] = u.origin;
      headers["Sec-Fetch-Dest"] = "empty";
      headers["Sec-Fetch-Mode"] = "cors";
      headers["Sec-Fetch-Site"] = "same-origin";
      data = JSON.stringify(json || {});
    } else {
      headers["Accept"] = "text/html,application/xhtml+xml,*/*;q=0.8";
      headers["Upgrade-Insecure-Requests"] = "1";
    }

    let res;
    try {
      res = await axios({
        url,
        method,
        headers,
        data,
        maxRedirects: 0,
        validateStatus: () => true,
        responseType: "text",
        transformResponse: [(d) => d],
      });
    } catch (e) {
      throw new SflError("Gagal terhubung ke " + u.host + ".", rawOf(e));
    }
    storeCookies(u.host, res);
    return {
      status: res.status,
      location: res.headers["location"],
      text: typeof res.data === "string" ? res.data : String(pick(res.data, "")),
    };
  };

  const sniffBody = (html, base) => {
    const form = html.match(/<form[^>]+action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i);
    if (form && !/method=["']?post/i.test(form[0].match(/^<form[^>]*>/i)[0])) {
      const u = new URL(form[1], base);
      for (const mm of form[2].matchAll(/<input[^>]+>/gi)) {
        const n = mm[0].match(/name=["']([^"']+)["']/i);
        const v = mm[0].match(/value=["']([^"']*)["']/i);
        if (n) u.searchParams.set(n[1], v ? v[1] : "");
      }
      return u.href;
    }
    const meta = html.match(
      /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i
    );
    if (meta) return new URL(meta[1], base).href;
    const js = html.match(/(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
    if (js) return new URL(js[1], base).href;
    const rep = html.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i);
    if (rep) return new URL(rep[1], base).href;
    return null;
  };

  const sniffFinal = (body, base) => {
    const SKIP = /(^|\.)(sfl\.gl|w3\.org|google\.com|googleapis\.com|gstatic\.com|cloudflare\.com|jquery\.com|facebook\.com|twitter\.com)$/i;
    for (const mm of body.replace(/\\+\//g, "/").matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) {
      try {
        const u = new URL(mm[0]);
        if (!SKIP.test(u.hostname)) return u.href;
      } catch {}
    }
    return null;
  };

  const navigate = async (start, referer, chain) => {
    let url = start;
    let prev = referer || "";
    for (let i = 0; i < MAX_HOP; i++) {
      const res = await http(url, { referer: prev });
      chain.push({ url, status: res.status });
      if (res.status >= 300 && res.status < 400 && res.location) {
        prev = url;
        url = new URL(res.location, url).href;
        continue;
      }
      if (res.status >= 400)
        throw new SflError("Server menolak request (HTTP " + res.status + ").", url + " :: " + res.text);
      if (GATE_RE.test(res.text)) return { url, body: res.text, gate: true };
      const next = sniffBody(res.text, url);
      if (next && next !== url) {
        prev = url;
        url = next;
        continue;
      }
      return { url, body: res.text, gate: false };
    }
    throw new SflError(
      "Redirect terlalu banyak (>" + MAX_HOP + ").",
      chain.map((c) => c.url).join(" -> ")
    );
  };

  const finalize = async (start, referer, chain) => {
    let url = start;
    let prev = referer || "";
    for (let i = 0; i < MAX_HOP; i++) {
      if (!isSfl(new URL(url).hostname)) return url;
      const res = await http(url, { referer: prev });
      chain.push({ url, status: res.status });
      if (res.status >= 300 && res.status < 400 && res.location) {
        prev = url;
        url = new URL(res.location, url).href;
        continue;
      }
      if (res.status >= 400)
        throw new SflError("Server menolak request (HTTP " + res.status + ").", url + " :: " + res.text);
      const next = sniffFinal(res.text, url);
      if (!next || next === url)
        throw new SflError("Tujuan akhir tidak ditemukan di halaman /ready/go.", url + " :: " + res.text);
      prev = url;
      url = next;
    }
    throw new SflError("Redirect terlalu banyak di hop terakhir.", chain.map((c) => c.url).join(" -> "));
  };

  const api = async (page, path, json) => {
    const res = await http(new URL(path, page).href, { method: "POST", json, referer: page });
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 419)
        throw new SflError("Sesi/token ditolak server (419), coba jalankan ulang.", `${path} :: ${res.text}`);
      if (res.status === 422)
        throw new SflError("Request ditolak validasi server (422).", `${path} :: ${res.text}`);
      throw new SflError(`API ${path} ditolak (HTTP ${res.status}).`, res.text);
    }
    try {
      return JSON.parse(res.text);
    } catch {
      throw new SflError(`Response ${path} bukan JSON.`, res.text);
    }
  };

  const makeToken = (host) => {
    const xsrf = jar.get(host) && jar.get(host).get("XSRF-TOKEN");
    if (!xsrf) {
      throw new SflError(
        "Cookie XSRF-TOKEN tidak ada.",
        "host=" + host + " cookies=[" + (jar.has(host) ? [...jar.get(host).keys()].join(",") : "") + "]"
      );
    }
    // Token style: prefix XSRF + tag '#base64'
    const u = "#" + Buffer.from("sfl-solver-v2").toString("base64");
    return decodeURIComponent(xsrf).slice(0, 128 - u.length) + u;
  };

  const resolve = async (startUrl) => {
    const chain = [];
    let page = await navigate(startUrl, "", chain);

    for (let round = 0; round < MAX_ROUND; round++) {
      if (!page.gate)
        throw new SflError("Halaman gate SafelinkU tidak ditemukan (mungkin struktur berubah).", page.url);

      const host = new URL(page.url).host;
      const s = await api(page.url, "/api/session", { _token: makeToken(host) });
      if (s.captcha || s.passcode)
        throw new SflError("Link ini butuh captcha/passcode.", JSON.stringify(s));

      if (s.step === 1) {
        await sleep(12000);
        const v = await api(page.url, "/api/verify", { _a: 0 });
        const next = new URL(pick(v.target, "/redirect.php"), page.url).href;
        page = await navigate(next, page.url, chain);
        continue;
      }

      if (s.step === 2) {
        await sleep(5000);
        const a = Math.floor(Math.random() * 1000);
        const size = `${(VW + a) * 2}.${(VH + a) * 2}`;
        const g = await api(page.url, "/api/go", { key: a, size, ado: null });
        if (!g.url) throw new SflError("Response /api/go tidak berisi url.", JSON.stringify(g));
        return bersih(await finalize(new URL(g.url, page.url).href, page.url, chain)) || g.url;
      }

      throw new SflError("Step tidak dikenal: " + s.step, JSON.stringify(s));
    }
    throw new SflError("Terlalu banyak putaran gate (>" + MAX_ROUND + ").", chain.map((c) => c.url).join(" -> "));
  };

  return resolve;
}

export default {
  name: "SFL.gl Bypass",
  description:
    "Bypass shortlink sfl.gl dengan gate solver (session, verify, /api/go) — hasil berupa URL gateway berikutnya atau link final",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL sfl.gl yang ingin di-bypass",
      example: "https://sfl.gl/mQdE",
    },
  },

  async run(req, res) {
    const start = Date.now();
    const axios = (await import("axios")).default;
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const input = String(params.url || params.link || "").trim();

    try {
      if (!input) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }

      const matchUrl = input.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*sfl\.gl(?:\/[^\s]*)?/i);
      if (!matchUrl) {
        return res
          .status(400)
          .json({ status: false, message: "Link harus dari domain sfl.gl" });
      }

      const startUrl = /^https?:\/\//i.test(matchUrl[0]) ? matchUrl[0] : "https://" + matchUrl[0];
      const resolveSfl = createSolver(axios);
      const final = await resolveSfl(startUrl);

      let hostName = "";
      try {
        hostName = pick(new URL(final).hostname, "");
      } catch {}

      return res.json({
        status: true,
        url: final,
        gateway: hostName,
        source: startUrl,
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    } catch (error) {
      return res.status(502).json({
        status: false,
        message: error.message || "Gagal bypass sfl.gl",
        raw: error.raw || null,
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  },
};
