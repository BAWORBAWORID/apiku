import logger from "../../src/utils/logger.js";

const BASE_API = "https://pencarinafkah.xyz/vA6";
const API_KEY = "cda11y63tfI7rwln8BLeiKTvjsD5g2Mox01RzkhQCEXSGWbqYO";
const BASE_IMG = "http://elara.whatbox.ca:29318/Duljanah/";
const UA = "Dalvik/7.1.12.1.0 (com.newanimeku.animechanneldonghuasubindosubenglish U; Android ; 20175 Build/NMF260)";
const HEADERS = { "User-Agent": UA, Accept: "application/vnd.yourapi.v1.full+json" };
const TIMEOUT = 15000;

function fixLooseJson(text) {
  let fixed = text
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, "$1");
  const stack = [];
  for (const ch of fixed) {
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (stack.length) fixed += stack.reverse().join("");
  return fixed;
}

async function api(path, params = {}) {
  const qs = new URLSearchParams({ api_key: API_KEY, ...params });
  const res = await fetch(`${BASE_API}/${path}?${qs}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(fixLooseJson(text));
    } catch {
      throw new Error(`${path} -> bukan JSON: ${text.slice(0, 120)}`);
    }
  }
}

const imgUrl = (name) => (name ? BASE_IMG + name : null);

function normalizeAnimeItem(c) {
  return {
    cid: c.cid,
    title: c.category_name,
    image: imgUrl(c.category_image),
    status: c.status_video,
    rating: c.rating,
    year: c.year,
    genre: c.genre?.trim(),
    episode_count: c.video_count,
    views: c.total_views,
    updated: c.update_date_time,
  };
}

function normalizeList(d) {
  const items = d.categories ?? d.new_anime ?? [];
  return { count_total: d.count_total, pages: d.pages, items: items.map(normalizeAnimeItem) };
}

function normalizeVideo(v) {
  if (!v) return null;
  return {
    vid: v.vid,
    cid: v.cat_id,
    title: v.video_title?.trim(),
    anime: v.category_name,
    date: v.date_time,
    views: v.total_views,
    streams: {
      sd: v.video_url,
      minihd: v.video_url_minihd,
      hd: v.video_url_hd,
      fullhd: v.video_url_fullhd,
      eng: v.video_url_eng,
      hdeng: v.video_url_hdeng,
    },
  };
}

function normalizeVideos(posts) {
  return posts.map(normalizeVideo);
}

export default {
  name: "AnimeKu",
  description: "API anime AnimeKu — search, new, popular, detail, episode, stream URL, jadwal, genre, dan lainnya",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "q", "cid", "vid", "page", "count", "sort"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: [
        "search", "eps", "new", "popular", "favorite", "complete", "coming",
        "latest", "detail", "episodes", "ep", "epnav", "genres",
        "schedule", "tv", "updatedhome", "servers", "pkg",
      ],
      description: "Aksi yang dijalankan",
    },
    q: {
      type: "string",
      required: false,
      description: "Keyword pencarian (wajib untuk action=search, eps)",
      example: "naruto",
    },
    cid: {
      type: "string",
      required: false,
      description: "Category ID anime (wajib untuk action=detail, episodes)",
      example: "44",
    },
    vid: {
      type: "string",
      required: false,
      description: "Video ID episode (wajib untuk action=ep, epnav)",
      example: "96507",
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor halaman",
    },
    count: {
      type: "number",
      required: false,
      default: 20,
      description: "Jumlah item per halaman",
    },
    sort: {
      type: "string",
      required: false,
      default: "rating",
      description: "Sortir (rating / dll)",
    },
  },

  async run(req, res) {
    const start = Date.now();
    try {
      const p = { ...req.query, ...req.body };
      const action = String(p.action || "").toLowerCase();
      const page = parseInt(p.page ?? 1, 10);
      const count = parseInt(p.count ?? 20, 10);
      const sort = p.sort || "rating";

      if (!action) {
        return res.status(400).json({ status: false, message: "Parameter 'action' wajib diisi" });
      }

      // ── search ──────────────────────────────────────────────
      if (action === "search") {
        if (!p.q) return res.status(400).json({ status: false, message: "Parameter 'q' wajib untuk action=search" });
        const d = await api("api/get_cari_anime", { search: p.q, sort });
        return res.json({ status: true, result: normalizeList(d) });
      }

      // ── eps (search episode) ─────────────────────────────────
      if (action === "eps") {
        if (!p.q) return res.status(400).json({ status: false, message: "Parameter 'q' wajib untuk action=eps" });
        const d = await api("api/get_search_results", { search: p.q, count });
        return res.json({ status: true, result: normalizeVideos(d.posts ?? []) });
      }

      // ── new / popular / favorite / complete / coming ─────────
      const categoryMap = {
        new: "get_category_new",
        popular: "get_category_popular",
        favorite: "get_category_favorite",
        complete: "get_category_complete",
        coming: "get_category_coming",
      };
      if (categoryMap[action]) {
        const d = await api(`api/${categoryMap[action]}`, { page, count });
        return res.json({ status: true, result: normalizeList(d) });
      }

      // ── latest ───────────────────────────────────────────────
      if (action === "latest") {
        const d = await api("api/get_videos", { page, count });
        return res.json({ status: true, result: normalizeVideos(d.latest_anime ?? []) });
      }

      // ── updatedhome ──────────────────────────────────────────
      if (action === "updatedhome") {
        const d = await api("api/get_videosUpdateHome");
        return res.json({ status: true, result: normalizeVideos(d.latest_anime ?? []) });
      }

      // ── detail ───────────────────────────────────────────────
      if (action === "detail") {
        if (!p.cid) return res.status(400).json({ status: false, message: "Parameter 'cid' wajib untuk action=detail" });
        const d = await api("api/get_anime_detail", { id: p.cid });
        d.category.image_full = imgUrl(d.category?.category_image);
        return res.json({ status: true, result: d });
      }

      // ── episodes (all episodes of an anime) ──────────────────
      if (action === "episodes") {
        if (!p.cid) return res.status(400).json({ status: false, message: "Parameter 'cid' wajib untuk action=episodes" });
        const all = [];
        let pg = 1;
        while (true) {
          const d = await api("api/get_category_videos", { id: p.cid, page: pg, count: 100, sort });
          const posts = d.posts ?? [];
          all.push(...normalizeVideos(posts));
          if (pg >= (d.pages ?? 1) || posts.length === 0) break;
          pg++;
        }
        return res.json({ status: true, total: all.length, result: all });
      }

      // ── ep (episode detail + streams) ────────────────────────
      if (action === "ep") {
        if (!p.vid) return res.status(400).json({ status: false, message: "Parameter 'vid' wajib untuk action=ep" });
        const d = await api("api/get_post_detail", { id: p.vid });
        return res.json({
          status: true,
          result: {
            post: normalizeVideo(d.post),
            suggested: normalizeVideos(d.suggested ?? []),
          },
        });
      }

      // ── epnav (prev/next episode) ─────────────────────────────
      if (action === "epnav") {
        if (!p.vid || !p.cid) return res.status(400).json({ status: false, message: "Parameter 'vid' dan 'cid' wajib untuk action=epnav" });
        const d = await api("api/get_post_detail_next_provious", { id: p.vid, cat_id: p.cid });
        return res.json({
          status: true,
          result: {
            post: normalizeVideo(d.post),
            suggested: normalizeVideos(d.suggested ?? []),
          },
        });
      }

      // ── genres ───────────────────────────────────────────────
      if (action === "genres") {
        const d = await api("api/get_genre_index");
        return res.json({ status: true, result: d });
      }

      // ── schedule ─────────────────────────────────────────────
      if (action === "schedule") {
        const d = await api("api/get_jadwal_detail");
        return res.json({ status: true, result: d.jadwal_anime });
      }

      // ── tv ───────────────────────────────────────────────────
      if (action === "tv") {
        const d = await api("api/get_tv");
        return res.json({ status: true, result: d.tv ?? [] });
      }

      // ── servers ───────────────────────────────────────────────
      if (action === "servers") {
        const cfgRes = await fetch(
          `${BASE_API}/config/com.newanimeku.animechanneldonghuasubindosubenglish`,
          { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) }
        );
        const cfgText = await cfgRes.text();
        let cfg;
        try { cfg = JSON.parse(cfgText); } catch { cfg = JSON.parse(fixLooseJson(cfgText)); }
        return res.json({ status: true, result: cfg?.Iklan?.[0]?.servers ?? [] });
      }

      // ── pkg ───────────────────────────────────────────────────
      if (action === "pkg") {
        const d = await api("api/get_package_name");
        return res.json({ status: true, result: d });
      }

      return res.status(400).json({ status: false, message: `Action '${action}' tidak dikenal` });
    } catch (err) {
      logger.error(`[ANIMEKU] ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "AnimeKu request gagal",
      });
    }
  },
};
