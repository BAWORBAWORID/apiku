#!/usr/bin/env node
/**
 * tesall.js — Smoke test SELURUH endpoint Zyyvor API
 *
 * Sumber daftar endpoint : GET /openapi.json (499 endpoint)
 * Parameter uji          : diambil dari paramsSchema (default > example > enum[0] > heuristik tipe)
 *
 * Usage:
 *   node tesall.js                          test semua endpoint online
 *   node tesall.js --filter tiktok          filter nama/route/kategori
 *   node tesall.js --category "AI Chat"     per kategori
 *   node tesall.js --only /api/ai/gemini    satu endpoint
 *   node tesall.js --status online,premium  filter status endpoint
 *   node tesall.js --all-methods            test GET dan POST (default: method pertama saja)
 *   node tesall.js --key <APIKEY>           sertakan header X-API-Key
 *   node tesall.js --concurrency 6 --rps 8  tuning beban
 *   node tesall.js --json logs/tesall.json  simpan laporan JSON
 *
 * Catatan: RPS default 8 agar tetap di bawah batas spamDetection
 *          (configuration.json: 100 request / 10 detik -> auto violation).
 */

const BASE = process.env.API_BASE || "http://localhost:3000";
const UA = "Zyyvor-Tester/1.0 (+tesall.js)";

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const a = {
    filter: null,
    category: null,
    only: null,
    status: ["online"],
    concurrency: 6,
    rps: 8,
    timeout: 30000,
    allMethods: false,
    key: null,
    json: "logs/tesall-report.json",
    verbose: false,
    includeEmpty: true,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const next = () => argv[++i];
    if (x === "--filter") a.filter = next();
    else if (x === "--category") a.category = next();
    else if (x === "--only") a.only = next();
    else if (x === "--status") a.status = next().split(",").map((s) => s.trim());
    else if (x === "--concurrency") a.concurrency = Math.max(1, +next() || 6);
    else if (x === "--rps") a.rps = Math.max(1, +next() || 8);
    else if (x === "--timeout") a.timeout = +next() || 30000;
    else if (x === "--key") a.key = next();
    else if (x === "--json") a.json = next();
    else if (x === "--all-methods") a.allMethods = true;
    else if (x === "--no-empty") a.includeEmpty = false;
    else if (x === "--verbose" || x === "-v") a.verbose = true;
    else if (x === "--help" || x === "-h") a.help = true;
    else a.rest.push(x);
  }
  return a;
}

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help) {
  console.log(
    require("node:fs")
      .readFileSync(new URL(import.meta.url), "utf8")
      .split("*/")[0]
      .replace(/^\/\*\*?/, "")
      .trim()
  );
  process.exit(0);
}

/* --------------------------------------------------------- value sampler */
function sampleValue(name, sch) {
  if (!sch || typeof sch !== "object") return "tes";
  if (sch.default !== undefined && sch.default !== null && sch.default !== "") return sch.default;
  if (sch.example !== undefined && sch.example !== null && sch.example !== "") return sch.example;
  if (Array.isArray(sch.enum) && sch.enum.length) return sch.enum[0];

  switch (sch.type) {
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
  }

  const n = String(name || "").toLowerCase();
  if (/(url|link|source|target|image|img|avatar|photo|ppurl|profile)/.test(n))
    return "https://picsum.photos/200";
  if (/(phone|nomor|number|no_?hp|msisdn)/.test(n)) return "6281234567890";
  if (/(email|mail)/.test(n)) return "tes@example.com";
  if (/(text|teks|query|q|prompt|message|msg|kata|nama)/.test(n)) return "halo";
  if (/amount|nominal|price|nilai/.test(n)) return 10000;
  if (/(^|_)id$|id_/.test(n)) return "1";
  if (/(apikey|api_?key|token)/.test(n)) return "tes";
  if (/kode|code/.test(n)) return "TES123";
  return "tes";
}

function buildParams(ep) {
  const out = {};
  const schema = ep.paramsSchema || {};
  for (const [k, sch] of Object.entries(schema)) {
    const v = sampleValue(k, sch);
    if (v !== undefined && v !== null) out[k] = v;
  }
  // fallback bila paramsSchema kosong tapi params tercantum
  if (!Object.keys(out).length && Array.isArray(ep.params)) {
    for (const k of ep.params) out[k] = sampleValue(k, {});
  }
  return out;
}

/* ------------------------------------------------------------- throttler */
class Limiter {
  constructor(rps) {
    this.interval = 1000 / rps;
    this.next = 0;
  }
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

/* --------------------------------------------------------------- tester */
function classify(code, body, err) {
  if (err) return err.name === "AbortError" ? "TIMEOUT" : "CONN";
  if (code >= 200 && code < 300) {
    if (body && typeof body === "object") {
      if (body.status === false || body.success === false || body.error)
        return "APP_ERROR";
    }
    return "PASS";
  }
  if (code === 401 || code === 403) return "AUTH";
  if (code === 404) return "NOTFOUND";
  if (code === 429) return "RATELIMIT";
  if (code === 400 || code === 422) return "CLIENT_ERR";
  if (code >= 500) return "SERVER";
  return "HTTP_" + code;
}

function shortMsg(body) {
  if (!body || typeof body !== "object") return "";
  const m = body.message || body.error || body.msg || body.reason || "";
  if (m) return String(m).slice(0, 90);
  if (body.status === false || body.success === false) return "status=false";
  return "";
}

async function probe(ep, method, params) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ARGS.timeout);
  const t0 = Date.now();
  const headers = { "User-Agent": UA, Accept: "application/json, */*" };
  if (ARGS.key) headers["X-API-Key"] = ARGS.key;

  let url = BASE + ep.route;
  const init = { method, headers, signal: ctrl.signal, redirect: "manual" };

  try {
    if (method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params))
        qs.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params);
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}

    // lokasi diikuti (redirect) tidak diambil: cukup status + body
    const cls = classify(res.status, body, null);
    return {
      code: res.status,
      ms: Date.now() - t0,
      cls,
      msg: shortMsg(body),
      bytes: text.length,
      truncated: text.length > 300 ? text.slice(0, 300) : text,
    };
  } catch (err) {
    return {
      code: 0,
      ms: Date.now() - t0,
      cls: classify(0, null, err),
      msg: err.name === "AbortError" ? "timeout" : String(err.message).slice(0, 90),
      bytes: 0,
      truncated: "",
    };
  } finally {
    clearTimeout(to);
  }
}

/* --------------------------------------------------------------- runner */
async function main() {
  console.log(`\n  Zyyvor API — smoke test semua endpoint`);
  console.log(`  base: ${BASE}\n`);

  let spec;
  try {
    const r = await fetch(`${BASE}/openapi.json`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`openapi.json HTTP ${r.status}`);
    spec = await r.json();
  } catch (e) {
    console.error(`  gagal ambil openapi.json: ${e.message}`);
    process.exit(1);
  }

  let eps = Array.isArray(spec.endpoints) ? spec.endpoints : [];
  console.log(`  daftar endpoint : ${eps.length}`);

  const totalAll = eps.length;
  const byStatus = {};
  for (const e of eps) byStatus[e.status || "?"] = (byStatus[e.status || "?"] || 0) + 1;

  if (ARGS.filter) {
    const f = ARGS.filter.toLowerCase();
    eps = eps.filter(
      (e) =>
        (e.route || "").toLowerCase().includes(f) ||
        (e.name || "").toLowerCase().includes(f) ||
        (e.category || "").toLowerCase().includes(f)
    );
  }
  if (ARGS.category) {
    const c = ARGS.category.toLowerCase();
    eps = eps.filter((e) => (e.category || "").toLowerCase() === c);
  }
  if (ARGS.only) eps = eps.filter((e) => e.route === ARGS.only);
  if (ARGS.status.length && !(ARGS.status.length === 1 && ARGS.status[0] === "all"))
    eps = eps.filter((e) => ARGS.status.includes(e.status || "online"));

  console.log(`  terpilih untuk uji: ${eps.length}`);
  console.log(`  status tersedia  : ${JSON.stringify(byStatus)}`);
  console.log(`  concurrency ${ARGS.concurrency} | ${ARGS.rps} req/dtk | timeout ${ARGS.timeout}ms`);
  if (ARGS.key) console.log(`  X-API-Key        : ${ARGS.key.slice(0, 6)}***`);
  console.log(`  ${"-".repeat(70)}\n`);

  if (!eps.length) {
    console.log("  tidak ada endpoint yang cocok dengan filter.\n");
    process.exit(0);
  }

  const limiter = new Limiter(ARGS.rps);
  const results = [];
  let done = 0;

  const jobs = [];
  for (const ep of eps) {
    const params = buildParams(ep);
    const methods = ARGS.allMethods ? ep.methods || ["GET"] : (ep.methods || ["GET"]).slice(0, 1);
    if (!ARGS.includeEmpty && !Object.keys(params).length && !(ep.methods || []).length) continue;
    for (const m of methods) jobs.push({ ep, m, params });
  }

  async function worker() {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      await limiter.take();
      const r = await probe(job.ep, job.m, job.params);
      results.push({
        route: job.ep.route,
        name: job.ep.name,
        category: job.ep.category,
        status: job.ep.status,
        method: job.m,
        params: Object.keys(job.params),
        ...r,
      });
      done++;
      const flag =
        r.cls === "PASS" ? "✅" : r.cls === "AUTH" ? "🔑" : r.cls === "APP_ERROR" ? "⚠️ " : "❌";
      if (ARGS.verbose || r.cls !== "PASS")
        console.log(
          `  ${flag} ${String(done).padStart(3)}/${jobs.lengthTotal} ${job.m.padEnd(4)} ${String(r.code).padStart(3)} ${String(r.ms + "ms").padStart(8)}  ${job.ep.route}${r.msg ? `  — ${r.msg}` : ""}`
        );
      else if (done % 25 === 0)
        console.log(`  … ${done}/${jobs.lengthTotal} selesai (${r.cls} terakhir)`);
    }
  }

  jobs.lengthTotal = jobs.length;
  await Promise.all(Array.from({ length: ARGS.concurrency }, () => worker()));

  /* -------------------------------------------------------------- report */
  const agg = {};
  for (const r of results) agg[r.cls] = (agg[r.cls] || 0) + 1;

  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] : 0);

  console.log(`\n  ${"=".repeat(70)}`);
  console.log(`  RINGKASAN`);
  console.log(`  ${"=".repeat(70)}`);
  console.log(`  total request : ${results.length}`);
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(12)} : ${v}`);
  console.log(`  latency ms    : p50=${p(0.5)}  p95=${p(0.95)}  max=${lat.length ? lat[lat.length - 1] : 0}`);

  const bad = results.filter((r) => !["PASS", "AUTH"].includes(r.cls));
  if (bad.length) {
    console.log(`\n  ${"-".repeat(70)}`);
    console.log(`  MASALAH (${bad.length})`);
    console.log(`  ${"-".repeat(70)}`);
    const byRoute = new Map();
    for (const r of bad) {
      const key = r.route;
      if (!byRoute.has(key)) byRoute.set(key, r);
    }
    for (const r of [...byRoute.values()].slice(0, 120)) {
      console.log(
        `    ${String(r.code).padStart(3)} ${r.cls.padEnd(11)} ${r.method.padEnd(4)} ${r.route}${r.msg ? `  — ${r.msg}` : ""}`
      );
    }
    if (byRoute.size > 120) console.log(`    … +${byRoute.size - 120} lainnya`);
  }

  const byCat = {};
  for (const r of results) {
    const c = r.category || "?";
    byCat[c] ||= { total: 0, pass: 0 };
    byCat[c].total++;
    if (r.cls === "PASS") byCat[c].pass++;
  }
  console.log(`\n  ${"-".repeat(70)}`);
  console.log(`  PER KATEGORI`);
  console.log(`  ${"-".repeat(70)}`);
  for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1].total - a[1].total))
    console.log(`    ${String(c).padEnd(18)} ${v.pass}/${v.total} ok`);

  /* ---------------------------------------------------------- simpan json */
  if (ARGS.json) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.mkdirSync(path.dirname(ARGS.json), { recursive: true });
      fs.writeFileSync(
        ARGS.json,
        JSON.stringify(
          {
            base: BASE,
            at: new Date().toISOString(),
            totalSpec: totalAll,
            tested: results.length,
            summary: agg,
            latency: { p50: p(0.5), p95: p(0.95), max: lat.length ? lat[lat.length - 1] : 0 },
            results,
          },
          null,
          2
        ),
        "utf8"
      );
      console.log(`\n  laporan: ${ARGS.json}`);
    } catch (e) {
      console.log(`\n  gagal tulis laporan: ${e.message}`);
    }
  }

  const failed = (agg.SERVER || 0) + (agg.CONN || 0) + (agg.TIMEOUT || 0);
  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n  fatal: ${e.stack || e.message}`);
  process.exit(1);
});
