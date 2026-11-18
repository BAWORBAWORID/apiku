/**
 * NunoDrama Scraper (nunodrama.my.id)
 * Fitur: platforms, latest/browse (section), search, detail (+daftar episode),
 *        watch (stream per kualitas, uji playability).
 * Zero dependency npm — Node built-in + curl.
 * Bypass:
 *   1) Tanpa Cloudflare challenge (cuma proxy CF) — DNS ISP bisa di-hijack
 *      (cert mismatch -> code 000) -> retry otomatis via DoH cloudflare-dns.com.
 *   2) Situs SPA tapi konten server-rendered + API JSON resmi theme:
 *      - GET /api/search/{platform}?q=  -> {dramas:[...]}
 *      - GET /api/section/{platform}/{category}?page=N -> {dramas, next}
 *        (next == "" -> halaman habis; default category: all_drama)
 *   3) Stream langsung ada di halaman watch:
 *      <video data-kind="mp4" data-src="CDN"> + tombol <button data-quality-option data-url="...">
 *      (240p..720p) -> decode &amp; -> uji Range GET -> 206 video/mp4 + box ftyp = PLAYABLE.
 *      Kalau probe pertama gagal, retry dengan Referer situs.
 *   4) URL detail/watch yang bawa ?c=<cover raksasa> bisa bikin curl mati (000)
 *      -> buang query kecuali ep saat fetch.
 *   5) Video pakai referrerpolicy="no-referrer" -> CDN tidak wajib Referer.
 */

import { spawnSync } from "node:child_process";

const BASE = "https://nunodrama.my.id";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const DOH = "https://cloudflare-dns.com/dns-query";
const DEF_PLATFORM = "melolo";
const DEF_CATEGORY = "all_drama";

const dec = (s) => {
  if (s == null) return s;
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
};
const stripTags = (s) => dec(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function curl(url, { timeout = 20, referer, range } = {}) {
  const run = (useDoh) => {
    const args = ["-s", "-m", String(timeout), "--http1.1", "--compressed", "-L", "--max-redirs", "4",
      "-A", UA, "-w", "\n__CURL_CODE__%{http_code}"];
    if (useDoh) args.push("--doh-url", DOH);
    if (referer) args.push("-H", `Referer: ${referer}`);
    if (range) args.push("-r", range);
    args.push(url);
    const r = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 });
    const raw = r.stdout || "";
    const m = raw.match(/\n__CURL_CODE__(\d{3})$/);
    return { code: m ? Number(m[1]) : 0, body: m ? raw.slice(0, m.index) : raw, status: r.status ?? 0 };
  };
  let r = run(false);
  if (r.code === 0 || r.status !== 0) r = run(true);
  return r;
}

class UpstreamError extends Error {}

function jget(path) {
  const r = curl(`${BASE}${path}`);
  if (r.code !== 200) throw new UpstreamError(`HTTP ${r.code} untuk ${path}`);
  try { return JSON.parse(r.body); } catch { throw new UpstreamError(`respons bukan JSON: ${path}`); }
}

function mapDrama(x) {
  const platform = String(x.Platform || "").toLowerCase();
  const id = x.BookID;
  return {
    id,
    title: dec(x.BookName) || null,
    platform,
    platformName: x.PlatformName || null,
    chapters: x.ChapterCount ?? null,
    cover: x.Cover || null,
    tag: dec(x.Tag) || null,
    tags: Array.isArray(x.Tags) ? x.Tags : (x.Tags ? [x.Tags] : []),
    intro: dec(x.Introduction) || null,
    url: platform && id ? `${BASE}/detail/${platform}/${id}` : null,
  };
}

/* ---------- platforms ---------- */
function getPlatforms() {
  const r = curl(`${BASE}/`);
  if (r.code !== 200) throw new UpstreamError(`homepage HTTP ${r.code}`);
  const items = [];
  for (const m of r.body.matchAll(/data-platform-link[^>]*data-slug="([^"]+)"[^>]*data-name="([^"]+)"/g)) {
    items.push({ slug: m[1], name: dec(m[2]) });
  }
  if (!items.length) throw new UpstreamError("daftar platform tidak ditemukan");
  return { total: items.length, items };
}

/* ---------- search ---------- */
function searchDrama(q, platform = DEF_PLATFORM) {
  const j = jget(`/api/search/${encodeURIComponent(platform)}?q=${encodeURIComponent(q)}`);
  const items = (j.dramas || []).map(mapDrama);
  return { platform, query: q, success: !!j.success, total: items.length, items };
}

/* ---------- latest / browse section ---------- */
function detectCategory(platform) {
  const r = curl(`${BASE}/?platform=${encodeURIComponent(platform)}`);
  if (r.code !== 200) throw new UpstreamError(`homepage HTTP ${r.code}`);
  const tags = [...r.body.matchAll(/<section[^>]*data-inf-section[^>]*>/g)].map((m) => m[0]);
  const mine = tags.find((t) => t.includes(`data-platform="${platform}"`)) || null;
  if (!mine) return null;
  return (mine.match(/data-category="([^"]+)"/) || [])[1] || DEF_CATEGORY;
}

function latestDrama(page = 1, platform = DEF_PLATFORM, category = null) {
  platform = String(platform).toLowerCase();
  let cat = category || null;
  if (!cat) {
    cat = detectCategory(platform);
    if (!cat) throw new UpstreamError(`platform "${platform}" tidak dikenal (lihat action=platforms)`);
  }
  const j = jget(`/api/section/${encodeURIComponent(platform)}/${encodeURIComponent(cat)}?page=${page}`);
  const items = (j.dramas || []).map(mapDrama);
  if (!items.length) throw new UpstreamError(`halaman ${page} kosong (platform=${platform}, category=${cat})`);
  let hasMore = !!(j.next && String(j.next).length);
  if (!hasMore) {
    const nx = curl(`${BASE}/api/section/${encodeURIComponent(platform)}/${encodeURIComponent(cat)}?page=${page + 1}`);
    try {
      const nj = JSON.parse(nx.body);
      hasMore = nx.code === 200 && Array.isArray(nj.dramas) && nj.dramas.length > 0;
    } catch { hasMore = false; }
  }
  return { platform, category: cat, page, next: j.next || "", hasMore, success: !!j.success, total: items.length, items };
}

/* ---------- detail ---------- */
function toDetailUrl(x) {
  x = String(x || "").trim();
  if (!x) throw new UpstreamError("parameter 'slug' wajib (url | platform:id)");
  if (/^https?:\/\//.test(x)) return x.split("?")[0].replace(/\/+$/, "");
  if (x.includes("/")) return `${BASE}/${x.replace(/^\/+/, "").split("?")[0].replace(/\/+$/, "")}`;
  const m = x.match(/^([a-z0-9]+)[:/](\d+)$/i);
  if (m) return `${BASE}/detail/${m[1].toLowerCase()}/${m[2]}`;
  throw new UpstreamError(`format tidak dikenal "${x}" (pakai URL /detail/platform/id atau platform:id)`);
}

function detailDrama(x) {
  const url = toDetailUrl(x);
  const pm = url.match(/\/detail\/([a-z0-9]+)\/(\d+)/i);
  if (!pm) throw new UpstreamError("bukan URL detail nunodrama (/detail/platform/id)");
  const platform = pm[1].toLowerCase(), id = pm[2];
  const r = curl(url);
  if (r.code !== 200) throw new UpstreamError(`detail HTTP ${r.code}`);
  const h = r.body;

  let ld = null;
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      const arr = Array.isArray(j) ? j : [j];
      const vo = arr.find((x2) => x2 && x2["@type"] === "VideoObject");
      if (vo) { ld = vo; break; }
    } catch { /* skip */ }
  }
  const ogTitle = dec((h.match(/property="og:title" content="([^"]*)"/) || [])[1]) || "";
  const title = (ld && ld.name) || ogTitle.replace(/\s+[—-]\s+Tonton Sub Indo.*$/i, "").trim() || null;
  if (!title) throw new UpstreamError("judul tidak ditemukan");
  const synopsis = stripTags((h.match(/<h3[^>]*>Sinopsis<\/h3>\s*<p>([\s\S]*?)<\/p>/) || [])[1])
    || (ld && ld.description) || null;
  const cover = (h.match(/property="og:image" content="([^"]*)"/) || [])[1]
    || (ld && Array.isArray(ld.thumbnailUrl) && ld.thumbnailUrl[0]) || null;
  const totalEpisodes = (ld && ld.numberOfEpisodes) || null;

  const seen = new Set();
  const episodes = [];
  const epRe = new RegExp(`href="/watch/${platform}/${id}\\?ep=(\\d+)`, "g");
  for (const m of h.matchAll(epRe)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    episodes.push({ ep: n, url: `${BASE}/watch/${platform}/${id}?ep=${n}` });
  }
  episodes.sort((a, b) => a.ep - b.ep);
  if (!episodes.length) throw new UpstreamError("daftar episode tidak ditemukan");

  return {
    platform, id, url: `${BASE}/detail/${platform}/${id}`,
    title, cover, synopsis,
    totalEpisodes: totalEpisodes || episodes.length,
    totalListed: episodes.length, episodes,
  };
}

/* ---------- watch / stream ---------- */
function toWatchUrl(x, ep) {
  x = String(x || "").trim();
  if (!x) throw new UpstreamError("parameter 'slug' wajib (url | platform:id[:ep])");
  let base, givenEp = null;
  if (/^https?:\/\//.test(x) || x.startsWith("/watch/")) {
    const u = /^https?:\/\//.test(x) ? x : `${BASE}${x}`;
    const q = u.split("?");
    base = q[0].replace(/\/+$/, "");
    const em = (q[1] || "").match(/[?&]ep=(\d+)/);
    if (em) givenEp = Number(em[1]);
  } else {
    const m = x.match(/^([a-z0-9]+)[:/](\d+)(?:[:/](\d+))?$/i);
    if (!m) throw new UpstreamError(`format tidak dikenal "${x}" (pakai URL /watch/platform/id atau platform:id[:ep])`);
    base = `${BASE}/watch/${m[1].toLowerCase()}/${m[2]}`;
    if (m[3]) givenEp = Number(m[3]);
  }
  const pm = base.match(/\/watch\/([a-z0-9]+)\/(\d+)/i);
  if (!pm) throw new UpstreamError("bukan URL watch nunodrama (/watch/platform/id)");
  const finalEp = ep != null ? Number(ep) : (givenEp != null ? givenEp : 1);
  if (!Number.isFinite(finalEp) || finalEp < 1) throw new UpstreamError("ep harus angka >= 1");
  return { url: `${base}?ep=${finalEp}`, platform: pm[1].toLowerCase(), id: pm[2], ep: finalEp };
}

function probeVideo(url, referer) {
  const ok = (r) => r.status === 0 && (r.code === 200 || r.code === 206);
  let r = curl(url, { range: "0-63", timeout: 15 });
  let how = "range";
  if (!ok(r)) { r = curl(url, { range: "0-63", timeout: 15, referer }); how = "range+referer"; }
  if (!ok(r)) return { alive: false };
  const ftyp = r.body.length >= 8 && r.body.slice(4, 8) === "ftyp";
  return { alive: true, ftyp, via: how };
}

function watchDrama(x, ep) {
  const w = toWatchUrl(x, ep);
  const r = curl(w.url);
  if (r.code !== 200) throw new UpstreamError(`watch HTTP ${r.code}`);
  const h = r.body;

  const vi = h.indexOf('id="player"');
  const vseg = vi >= 0 ? h.slice(vi, vi + 4000) : "";
  const title = dec((vseg.match(/data-title="([^"]*)"/) || [])[1])
    || dec((h.match(/property="og:title" content="([^"]*)"/) || [])[1]) || null;
  const cover = (vseg.match(/data-cover="([^"]*)"/) || [])[1] || null;
  const kind = (vseg.match(/data-kind="([^"]*)"/) || [])[1] || "mp4";
  const primary = dec((vseg.match(/data-src="([^"]+)"/) || [])[1] || "");
  const prev = dec((h.match(/data-prev="([^"]*)"/) || [])[1] || "") || null;
  const next = dec((h.match(/data-next="([^"]*)"/) || [])[1] || "") || null;

  const seenEp = new Set();
  const episodes = [];
  for (const m of h.matchAll(/href="(\/watch\/[a-z0-9]+\/\d+\?ep=(\d+))[^"]*"/gi)) {
    const n = Number(m[2]);
    if (seenEp.has(n)) continue;
    seenEp.add(n);
    episodes.push({ ep: n, url: `${BASE}${m[1]}` });
  }
  episodes.sort((a, b) => a.ep - b.ep);

  const seenUrl = new Set();
  const files = [];
  const addFile = (quality, rawUrl) => {
    const u = dec(rawUrl);
    if (!u) return;
    if (seenUrl.has(u)) return;
    seenUrl.add(u);
    files.push({ quality, url: u, alive: null, ftyp: null });
  };
  for (const bm of h.matchAll(/<button[^>]*data-quality-option[^>]*>/g)) {
    const tag = bm[0];
    const label = (tag.match(/data-label="([^"]*)"/) || [])[1]
      || (tag.match(/data-id="([^"]*)"/) || [])[1] || `q${files.length + 1}`;
    const u = (tag.match(/data-url="([^"]+)"/) || [])[1];
    if (u) addFile(label, u);
  }
  if (primary) addFile(kind === "hls" ? "hls" : "default", primary);
  if (!files.length) throw new UpstreamError("tidak ada stream di halaman ini (ep tidak ada / halaman error?)");

  for (const f of files) {
    const p = probeVideo(f.url, w.url);
    f.alive = p.alive;
    f.ftyp = p.ftyp ?? null;
  }
  const aliveN = files.filter((f) => f.alive).length;
  const notes = [];
  if (aliveN) {
    notes.push(`${aliveN}/${files.length} kualitas live (Range GET 206 video/mp4, box ftyp = MP4 valid)`);
    notes.push("URL CDN langsung tanpa token — buka di browser/player dengan UA normal; kalau basi, scrape ulang");
  } else {
    notes.push("SEMUA kualitas tidak bisa diakses — coba scrape ulang (URL CDN cepat basi)");
  }

  return {
    platform: w.platform, id: w.id, ep: w.ep,
    title, cover, kind, url: w.url,
    prev: prev ? `${BASE}${prev}` : null,
    next: next ? `${BASE}${next}` : null,
    totalEpisodes: episodes.length || null,
    episodes,
    files,
    notes,
  };
}

export default {
  name: "NunoDrama",
  description: "Scraper short drama multi-platform (65 platform): daftar platform, terbaru, pencarian, detail + episode, dan link streaming per kualitas",
  category: "Movie",
  methods: ["GET", "POST"],
  params: ["action", "query", "slug", "platform", "page", "ep"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "platforms | latest | search | detail | watch",
      example: "latest",
    },
    query: { type: "string", required: false, description: "Kata kunci pencarian (action=search)" },
    slug: { type: "string", required: false, description: "URL detail/watch atau platform:id[:ep] (action=detail/watch)" },
    platform: { type: "string", required: false, description: "Slug platform (default: melolo)" },
    page: { type: "number", required: false, description: "Halaman (action=latest), default 1" },
    ep: { type: "number", required: false, description: "Nomor episode (action=watch), default 1" },
  },

  async run(req, res) {
    const start = Date.now();
    const q = { ...(req.body || {}), ...(req.query || {}) };
    const action = String(q.action || "latest").toLowerCase();

    const send = (data) =>
      res.json({
        status: true,
        action,
        result: data,
        metadata: { processing_time: `${Date.now() - start}ms` },
        attribution: "@zyvorapi",
      });

    try {
      switch (action) {
        case "platforms": {
          const d = getPlatforms();
          return send(d);
        }
        case "search": {
          const query = String(q.query || "").trim();
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search" });
          const platform = String(q.platform || DEF_PLATFORM).toLowerCase();
          return send(searchDrama(query, platform));
        }
        case "latest":
        case "browse": {
          const page = Math.max(1, parseInt(q.page, 10) || 1);
          const platform = String(q.platform || DEF_PLATFORM).toLowerCase();
          const category = q.category ? String(q.category) : null;
          return send(latestDrama(page, platform, category));
        }
        case "detail": {
          const slug = String(q.slug || q.url || "").trim();
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib (url | platform:id)" });
          return send(detailDrama(slug));
        }
        case "watch":
        case "stream": {
          const slug = String(q.slug || q.url || "").trim();
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib (url | platform:id[:ep])" });
          const ep = q.ep != null && q.ep !== "" ? Number(q.ep) : null;
          return send(watchDrama(slug, ep));
        }
        default:
          return res.status(400).json({
            status: false,
            message: "Action tidak dikenal: " + action + " (platforms | latest | search | detail | watch)",
          });
      }
    } catch (err) {
      const isUpstream = err instanceof UpstreamError;
      return res.status(isUpstream ? 502 : 500).json({
        status: false,
        action,
        message: err?.message || "Upstream error",
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  },
};
