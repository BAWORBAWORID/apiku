/**
 * Bicolink Bypass API
 * Engine: native HTTP solver (JAMVANHAX0R) — gate form, nonce verify, go-link polling
 *
 * GET/POST /api/bypass/bicolink?url=https://bicolink.com/xxxx
 */

"use strict";

/**
 * © JAMVANHAX0R — FIONY BOT
 * HAPUS CREDIT GAK BIKIN U JAGO DUMBASS. 
 * HARGAI SEBAGAIMANA U MAU DIHARGAI.
 * BICOLINK.js — BICOLINK SCRAPER
 */

import { spawn, spawnSync } from "node:child_process";

const baseRes = { status: true, data: [] };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 10;
const MAX_PASSES = 15;
const GO_FORM_DELAY_MS = 5500;
const PER_REQUEST_CAP_MS = 45000;

function bikinRes(status, data, extra) {
  return { ...baseRes, status, data, ...(extra || {}) };
}

function JHAnswer(nonce) {
  let sum = 0;
  for (let i = 0; i < nonce.length; i++) {
    sum = (sum * 31 + nonce.charCodeAt(i) + i) % 1000000007;
  }
  return sum.toString(36);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function debug(ctx, ...a) {
  if (ctx.debug) console.error("[bicolink]", ...a);
}

class CookieJar {
  constructor() {
    this.store = new Map();
  }
  set(domain, name, value) {
    let bucket = this.store.get(domain);
    if (!bucket) {
      bucket = new Map();
      this.store.set(domain, bucket);
    }
    bucket.set(name, value);
  }
  storeFromResponse(r, requestUrl) {
    const host = new URL(requestUrl).hostname;
    for (const raw of r.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      let expired = false;
      for (const a of attrs) {
        const [k, ...v] = a.split("=");
        const key = k.trim().toLowerCase();
        const val = v.join("=").trim();
        if (key === "domain" && val) domain = val.replace(/^\./, "").toLowerCase();
        if (key === "max-age" && Number(val) <= 0) expired = true;
        if (key === "expires" && val && new Date(val).getTime() <= Date.now()) expired = true;
      }
      if (expired || value === "") {
        const bucket = this.store.get(domain);
        if (bucket) bucket.delete(name);
      } else {
        this.set(domain, name, value);
      }
    }
  }
  headerFor(url) {
    const host = new URL(url).hostname;
    const out = [];
    for (const [domain, bucket] of this.store) {
      if (host === domain || host.endsWith("." + domain)) {
        for (const [n, v] of bucket) out.push(`${n}=${v}`);
      }
    }
    return out.join("; ");
  }
}

const WORKER_SRC = String.raw`
import sys, json, urllib.request, urllib.error, uuid, gzip

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def make_opener(proxy):
    h = [NoRedirect(), urllib.request.ProxyHandler({"http": proxy, "https": proxy} if proxy else {})]
    return urllib.request.build_opener(*h)

def handle(req, opener):
    headers = dict(req.get("headers") or {})
    body = None
    b = req.get("body")
    if b:
        if b["type"] == "multipart":
            boundary = uuid.uuid4().hex
            parts = []
            for k, v in b["fields"]:
                parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, k, v)).encode("utf-8"))
            parts.append(("--%s--\r\n" % boundary).encode("utf-8"))
            body = b"".join(parts)
            headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
        else:
            body = b["data"].encode("utf-8")
    r = urllib.request.Request(req["url"], data=body, method=req.get("method", "GET"))
    for k, v in headers.items():
        r.add_header(k, v)
    try:
        resp = opener.open(r, timeout=req.get("timeout", 30))
        status, rh, raw = resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as e:
        status, rh, raw = e.code, e.headers, e.read()
    try:
        if (rh.get("Content-Encoding") or "").lower() == "gzip":
            raw = gzip.decompress(raw)
    except Exception:
        pass
    return {"status": status, "headers": [[k, v] for k, v in rh.items()], "body": raw.decode("utf-8", "replace")}

def main():
    proxy = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    opener = make_opener(proxy)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = None
        try:
            req = json.loads(line)
            res = handle(req, opener)
            res["id"] = req.get("id")
        except Exception as e:
            res = {"id": (req or {}).get("id"), "error": "%s: %s" % (type(e).__name__, e)}
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()

main()
`;

class PythonTransport {
  constructor(bin, proxy) {
    this.bin = bin;
    this.proxy = proxy || "";
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buf = "";
    this.stderrTail = "";
    this.closed = false;
  }
  _start() {
    this.proc = spawn(this.bin, ["-u", "-c", WORKER_SRC, this.proxy], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error("python worker: " + msg.error));
        else p.resolve(msg);
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (c) => {
      this.stderrTail = (this.stderrTail + c).slice(-2000);
    });
    const failAll = (err) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    };
    this.proc.on("error", (e) => failAll(new Error(`gagal spawn ${this.bin}: ${e.message}`)));
    this.proc.on("exit", (code) => {
      if (!this.closed) failAll(new Error(`python worker exit (code ${code}) ${this.stderrTail}`));
    });
  }
  request(req, timeoutMs) {
    if (this.closed) return Promise.reject(new Error("python transport sudah ditutup"));
    if (!this.proc) this._start();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timeout: python worker tidak merespons."));
      }, timeoutMs + 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ ...req, id, timeout: Math.ceil(timeoutMs / 1000) }) + "\n");
    });
  }
  close() {
    this.closed = true;
    if (this.proc) {
      try { this.proc.stdin.end(); } catch {}
      try { this.proc.kill("SIGTERM"); } catch {}
      this.proc = null;
    }
  }
}

let _pythonBin;
function findPython() {
  if (_pythonBin !== undefined) return _pythonBin;
  for (const bin of ["python3", "python"]) {
    try {
      const r = spawnSync(bin, ["--version"], { timeout: 5000 });
      if (!r.error && r.status === 0) {
        _pythonBin = bin;
        return bin;
      }
    } catch {}
  }
  _pythonBin = null;
  return null;
}

function normalizeFetch(res, text) {
  return {
    status: res.status,
    headers: {
      get: (n) => res.headers.get(n),
      getSetCookie: () =>
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : res.headers.get("set-cookie")
            ? [res.headers.get("set-cookie")]
            : [],
    },
    text,
  };
}

function normalizeWorker(msg) {
  const hl = (msg.headers || []).map(([k, v]) => [String(k).toLowerCase(), v]);
  return {
    status: msg.status,
    headers: {
      get: (n) => {
        const vals = hl.filter(([k]) => k === String(n).toLowerCase()).map(([, v]) => v);
        return vals.length ? vals.join(", ") : null;
      },
      getSetCookie: () => hl.filter(([k]) => k === "set-cookie").map(([, v]) => v),
    },
    text: msg.body || "",
  };
}

function isCfBlock(r) {
  if (![403, 503, 429].includes(r.status)) return false;
  return (
    !!r.headers.get("cf-mitigated") ||
    (r.headers.get("server") || "").toLowerCase().includes("cloudflare") ||
    /challenge-platform|just a moment|attention required|connection check/i.test(r.text || "")
  );
}

function toWorkerBody(body) {
  if (!body) return null;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { type: "multipart", fields: [...body.entries()] };
  }
  if (body instanceof URLSearchParams) return { type: "urlencoded", data: body.toString() };
  return { type: "urlencoded", data: String(body) };
}

function switchToPython(ctx, reason) {
  const bin = findPython();
  if (!bin) {
    throw new Error(
      "Cloudflare nge-challenge koneksi Node dan python3 tidak ditemukan di server. " +
        "Install dulu (mis. apt install python3) atau pakai --proxy=http://user:pass@host:port."
    );
  }
  ctx.transport = "python";
  ctx.py = new PythonTransport(bin, ctx.proxy);
  debug(ctx, `transport: fetch -> ${bin} (${reason})`);
}

async function perform(ctx, url, method, body, headers, timeoutMs) {
  if (ctx.transport === "python") {
    const msg = await ctx.py.request(
      { url, method, headers: Object.fromEntries(headers.entries()), body: toWorkerBody(body) },
      timeoutMs
    );
    const r = normalizeWorker(msg);
    if (isCfBlock(r)) {
      throw new Error(
        `Cloudflare tetap nge-challenge lewat python (HTTP ${r.status}, cf-ray ${r.headers.get("cf-ray") || "-"}). ` +
          "Kemungkinan reputasi IP server jelek — coba --proxy=http://user:pass@host:port atau jalankan dari jaringan lain."
      );
    }
    return r;
  }

  let res;
  try {
    res = await fetch(url, { method, body, headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (findPython()) {
      switchToPython(ctx, "fetch error: " + e.message);
      return perform(ctx, url, method, body, headers, timeoutMs);
    }
    throw e;
  }
  const text = await res.text();
  const r = normalizeFetch(res, text);
  if (isCfBlock(r)) {
    switchToPython(ctx, `CF block HTTP ${r.status}`);
    return perform(ctx, url, method, body, headers, timeoutMs);
  }
  return r;
}

async function request(ctx, url, opts = {}) {
  let current = url;
  let method = opts.method || "GET";
  let body = opts.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = ctx.deadline - Date.now();
    if (remaining <= 0) throw new Error("Timeout: waktu bypass habis.");

    const headers = new Headers(opts.headers || {});
    headers.set("User-Agent", UA);
    if (!headers.has("Accept")) {
      headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    }
    headers.set("Accept-Language", "id-ID,id;q=0.9,en;q=0.8");
    headers.set("sec-ch-ua", '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"');
    headers.set("sec-ch-ua-mobile", "?0");
    headers.set("sec-ch-ua-platform", '"Windows"');
    if (method === "GET") {
      headers.set("Upgrade-Insecure-Requests", "1");
      headers.set("Sec-Fetch-Dest", "document");
      headers.set("Sec-Fetch-Mode", "navigate");
      headers.set("Sec-Fetch-User", "?1");
    }
    const cookie = ctx.jar.headerFor(current);
    if (cookie) headers.set("Cookie", cookie);
    if (opts.referer) headers.set("Referer", opts.referer);
    if (method !== "GET" && method !== "HEAD") headers.set("Origin", new URL(current).origin);
    if (!body) headers.delete("Content-Type");

    const r = await perform(ctx, current, method, body, headers, Math.min(remaining, PER_REQUEST_CAP_MS));
    ctx.jar.storeFromResponse(r, current);
    debug(ctx, `[${ctx.transport}] ${method} ${current.slice(0, 90)} -> ${r.status}`);

    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get("location");
      if (!loc) return { res: r, url: current };
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      current = new URL(loc, current).href;
      continue;
    }
    return { res: r, url: current };
  }
  throw new Error("Terlalu banyak redirect.");
}

function harvestJsCookies(jar, html, url) {
  const host = new URL(url).hostname;
  const re = /document\.cookie\s*=\s*["']([^=;"']+)=([^;"']*)/g;
  let m;
  while ((m = re.exec(html))) jar.set(host, m[1].trim(), m[2]);
}

async function getPage(ctx, url, referer) {
  const { res, url: finalUrl } = await request(ctx, url, { referer });
  if (res.status >= 400) {
    const snippet = (res.text || "").replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`HTTP ${res.status} saat GET ${finalUrl}${snippet ? " | " + snippet : ""}`);
  }
  harvestJsCookies(ctx.jar, res.text, finalUrl);
  return { url: finalUrl, html: res.text };
}

function extractClientRedirect(html, baseUrl) {
  const m =
    html.match(/window\.location\.replace\(\s*["']([^"']+)["']\s*\)/) ||
    html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*?url=([^"']+)["']/i) ||
    html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
  if (!m) return null;
  const target = decodeEntities(m[1].replace(/\\\//g, "/")).trim();
  if (!target || target.startsWith("#")) return null;
  try {
    return new URL(target, baseUrl).href;
  } catch {
    return null;
  }
}

function extractSafeLink(html, baseUrl) {
  const m =
    html.match(/id=["']wpsafe-link["'][^>]*>[\s\S]{0,500}?<a[^>]+href=["']([^"']+)["']/i) ||
    html.match(/<a[^>]+id=["']wpsafe-link["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<a[^>]+href=["']([^"']+)["'][^>]+id=["']wpsafe-link["']/i);
  if (!m) return null;
  const href = decodeEntities(m[1]).trim();
  if (!href || href === "#") return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function extractForm(html, id) {
  const fm = html.match(new RegExp(`<form[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?</form>`, "i"));
  if (!fm) return null;
  const block = fm[0];
  const openTag = (block.match(/<form[^>]*>/i) || [""])[0];
  const actionMatch = openTag.match(/action=["']([^"']*)["']/i);
  const fields = {};
  for (const tag of block.match(/<input[^>]*>/gi) || []) {
    const nameMatch = tag.match(/name=["']([^"']*)["']/i);
    if (!nameMatch) continue;
    const typeMatch = tag.match(/type=["']([^"']*)["']/i);
    const type = (typeMatch ? typeMatch[1] : "text").toLowerCase();
    if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/i.test(tag)) continue;
    const valueMatch = tag.match(/value=["']([^"']*)["']/i);
    fields[decodeEntities(nameMatch[1])] = decodeEntities(valueMatch ? valueMatch[1] : "");
  }
  return { action: actionMatch ? decodeEntities(actionMatch[1]) : null, fields };
}

async function bypassBicolinkNative(url, options = {}) {
  const startTime = performance.now();
  const elapsed = () => Math.round(performance.now() - startTime);
  const timeoutMs = options.timeoutMs || 90000;
  const proxy = options.proxy || null;
  const ctx = {
    jar: new CookieJar(),
    deadline: Date.now() + timeoutMs,
    debug: !!options.debug,
    proxy,
    transport: proxy || options.forcePython ? "python" : "fetch",
    py: null,
  };

  try {
    const cleanUrl = url.replace(/\/+$/, "");
    const slug = cleanUrl.split("/").pop() || "";
    if (!slug) throw new Error("Invalid shortlink URL: slug not found.");

    if (ctx.transport === "python") {
      const bin = findPython();
      if (!bin) throw new Error("python3 tidak ditemukan (dibutuhkan untuk mode --python/--proxy). Install: apt install python3");
      ctx.py = new PythonTransport(bin, proxy);
      debug(ctx, `transport awal: ${bin}${proxy ? " via proxy" : ""}`);
    }

    const origin = new URL(cleanUrl).origin;
    const freeUrl = `${origin}/al/free/${slug}`;

    let page = await getPage(ctx, cleanUrl);
    page = await getPage(ctx, freeUrl, page.url);

    const nonceMatch = page.html.match(/var\s+nonce\s*=\s*["']([^"']+)["']/);
    if (nonceMatch) {
      const fd = new FormData();
      fd.append("nt_fb", JHAnswer(nonceMatch[1]));
      fd.append("nt_dari", "tantangan");
      const { res } = await request(ctx, `${origin}/al/verify/${slug}`, { method: "POST", body: fd, referer: page.url });
      let parsed = null;
      try {
        parsed = JSON.parse(res.text);
      } catch {}
      if (parsed && parsed.ok === false) {
        throw new Error(`Verifikasi tantangan ditolak: ${res.text.slice(0, 120)}`);
      }
      page = await getPage(ctx, freeUrl, page.url);
    }

    let bypassedUrl = null;
    for (let pass = 0; pass < MAX_PASSES && !bypassedUrl; pass++) {
      if (Date.now() >= ctx.deadline) throw new Error("Timeout: waktu bypass habis.");

      const goForm = extractForm(page.html, "go-link");
      if (goForm) {
        const action = new URL(goForm.action || page.url, page.url).href;
        const body = new URLSearchParams(goForm.fields);
        await delay(GO_FORM_DELAY_MS);
        while (!bypassedUrl && Date.now() < ctx.deadline) {
          const { res } = await request(ctx, action, {
            method: "POST",
            body,
            referer: page.url,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Accept: "application/json, text/javascript, */*; q=0.01",
            },
          });
          let data = null;
          try {
            data = JSON.parse(res.text);
          } catch {}
          if (data && data.url) {
            bypassedUrl = data.url;
            break;
          }
          await delay(2000);
        }
        break;
      }

      const safeLink = extractSafeLink(page.html, page.url);
      if (safeLink && safeLink !== page.url) {
        page = await getPage(ctx, safeLink, page.url);
        continue;
      }

      const clientRedirect = extractClientRedirect(page.html, page.url);
      if (clientRedirect && clientRedirect !== page.url) {
        page = await getPage(ctx, clientRedirect, page.url);
        continue;
      }

      await delay(1000);
      page = await getPage(ctx, page.url, page.url);
    }

    if (!bypassedUrl) throw new Error("Unable to extract destination URL via native HTTP.");

    return bikinRes(true, [{ original_url: url, bypassed_url: bypassedUrl, execution_time_ms: elapsed() }]);
  } catch (e) {
    return bikinRes(false, [], { original_url: url, error: (e && e.message) || "Unknown error", execution_time_ms: elapsed() });
  } finally {
    if (ctx.py) ctx.py.close();
  }
}

const bypassBicolink = bypassBicolinkNative;

export { bypassBicolinkNative, bypassBicolink };


export default {
  name: "Bicolink Bypass",
  description: "Bypass shortlink bicolink.com via native solver (gate, nonce verify, go-link)",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL bicolink.com yang ingin di-bypass",
      example: "https://bicolink.com/9Vrvf",
    },
  },

  async run(req, res) {
    const { url } = { ...(req.query || {}), ...(req.body || {}) };
    const input = String(url || "").trim();

    if (!input) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
    }
    if (!/bicolink\.com/i.test(input)) {
      return res.status(400).json({ status: false, message: "Link harus dari domain bicolink.com" });
    }

    try {
      const result = await bypassBicolinkNative(input, { timeoutMs: 90000 });
      if (!result.status) {
        return res.status(502).json({
          status: false,
          message: result.error || "Gagal bypass bicolink",
          original_url: input,
          execution_time_ms: result.execution_time_ms || null,
        });
      }
      return res.json({
        status: true,
        url: result.data?.[0]?.bypassed_url || null,
        source: input,
        execution_time_ms: result.data?.[0]?.execution_time_ms || null,
      });
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: err?.message || "Gagal bypass bicolink",
      });
    }
  },
};
