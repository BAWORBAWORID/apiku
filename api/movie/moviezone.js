/**
 * MovieZone API Scraper
 * Base Web: https://moviezone.web.id
 * Fitur   : Trending, Popular, Latest, Upcoming, Top-Rated, Search, & Detail Movie/Series dengan Multi-Server Streaming Embed
 */

import https from "node:https";
import zlib from "node:zlib";
import logger from "../../src/utils/logger.js";

const HOST = "moviezone.web.id";
const BASE_URL = "https://" + HOST;
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36";

const ACTIONS = [
  "trending",
  "search",
  "detail",
  "popular",
  "latest",
  "upcoming",
  "toprated",
];

const jar = new Map();
if (process.env.MZ_COOKIE) {
  process.env.MZ_COOKIE.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  });
}

function cookieHeader() {
  return [...jar].map(([k, v]) => k + "=" + v).join("; ");
}

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const h = {
      "User-Agent": UA,
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      ...headers,
    };
    if (jar.size) h.Cookie = cookieHeader();

    const r = https.request({ hostname: HOST, path, method: "GET", headers: h }, (res) => {
      for (const c of res.headers["set-cookie"] || []) {
        const pair = c.split(";")[0];
        const i = pair.indexOf("=");
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }

      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = res.headers["content-encoding"];
          if (enc === "gzip") buf = zlib.gunzipSync(buf);
          else if (enc === "deflate") buf = zlib.inflateSync(buf);
          else if (enc === "br") buf = zlib.brotliDecompressSync(buf);
        } catch {}
        resolve({ status: res.statusCode, body: buf.toString() });
      });
    });

    r.setTimeout(30000, () => {
      r.destroy();
      reject(new Error("Koneksi timeout ke MovieZone"));
    });
    r.on("error", reject);
    r.end();
  });
}

async function initSession() {
  await request("/", {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  });
}

function apiHeaders() {
  return {
    Accept: "*/*",
    Referer: BASE_URL + "/",
    Origin: BASE_URL,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

function parse(res) {
  let j;
  try {
    j = JSON.parse(res.body);
  } catch {
    throw new Error(`Respon bukan JSON (HTTP ${res.status}): ${res.body.slice(0, 120)}`);
  }
  return j;
}

function isSessionError(j, res) {
  const msg = String((j && (j.message || j.error)) || "").toLowerCase();
  return (
    msg.includes("sesi") ||
    msg.includes("session") ||
    res.status === 401 ||
    res.status === 403
  );
}

async function get(path) {
  if (!jar.size) await initSession();
  let res = await request("/api/movies" + path, apiHeaders());
  let j = parse(res);

  if (isSessionError(j, res)) {
    jar.clear();
    await initSession();
    res = await request("/api/movies" + path, apiHeaders());
    j = parse(res);
  }

  if (res.status >= 400 || j.status === false) {
    const m = (j && (j.message || j.error)) || `HTTP ${res.status}`;
    throw new Error(m);
  }

  return j.results !== undefined ? j.results : j;
}

function pick(o, ...keys) {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return "";
}

function toList(r) {
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.data)) return r.data;
  if (r && Array.isArray(r.movies)) return r.movies;
  if (r && Array.isArray(r.results)) return r.results;
  return [];
}

function fmt(m) {
  return {
    title: pick(m, "title", "judul", "name", "nama"),
    type: pick(m, "type", "tipe", "category"),
    year: pick(m, "year", "tahun", "release_date", "date"),
    rating: pick(m, "rating", "score", "vote_average", "nilai"),
    genre: pick(m, "genre", "genres", "kategori"),
    poster: pick(m, "poster", "image", "thumbnail", "img", "cover"),
    slug: pick(m, "slug", "id", "url", "link", "href"),
  };
}

function fmtDetail(raw) {
  const stream = raw.stream && typeof raw.stream === "object" ? raw.stream : {};
  let servers = Array.isArray(stream.servers) ? stream.servers : [];
  if (!servers.length && Array.isArray(raw.servers)) servers = raw.servers;

  const list = servers
    .map((s, i) => ({
      name: s.server || s.name || s.label || `Server ${i + 1}`,
      url: s.url || s.link || s.embed || "",
    }))
    .filter((s) => s.url);

  const cast = Array.isArray(raw.cast)
    ? raw.cast.map((c) => (typeof c === "string" ? c : (c && c.name) || "")).filter(Boolean)
    : [];

  const genres = Array.isArray(raw.genres)
    ? raw.genres
    : Array.isArray(raw.genre)
    ? raw.genre
    : [];

  return {
    title: pick(raw, "title", "judul", "name"),
    slug: pick(raw, "slug", "id"),
    type: pick(raw, "type", "tipe"),
    year: pick(raw, "year"),
    release_date: pick(raw, "releaseDate", "release_date"),
    rating: pick(raw, "rating", "score"),
    duration: pick(raw, "duration", "durasi", "runtime"),
    status: pick(raw, "status"),
    tagline: pick(raw, "tagline"),
    synopsis: pick(raw, "synopsis", "sinopsis", "overview"),
    genres,
    director: pick(raw, "director", "sutradara"),
    cast,
    seasons: pick(raw, "numberOfSeasons"),
    episodes: pick(raw, "numberOfEpisodes"),
    poster: pick(raw, "poster", "image"),
    backdrop: pick(raw, "backdrop", "banner"),
    trailer: pick(raw, "trailer"),
    primary_stream: stream.primaryIframe || (list[0] && list[0].url) || "",
    servers: list,
  };
}

export default {
  name: "MovieZone",
  description: "Scraper film dan serial MovieZone (trending, search, popular, latest, upcoming, toprated, serta detail server streaming embed)",
  category: "Movie",
  methods: ["GET", "POST"],
  params: ["action", "query", "slug", "type"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      enum: ACTIONS,
      description: `Aksi yang ingin dijalankan (${ACTIONS.join(", ")}). Default: 'trending', otomatis 'search' jika query diisi, otomatis 'detail' jika slug diisi`,
      example: "trending",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci judul film/serial untuk pencarian (action=search)",
      example: "avengers",
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug atau ID film/serial untuk mengambil detail dan server streaming embed (action=detail)",
      example: "movie-1248832",
    },
    type: {
      type: "string",
      required: false,
      enum: ["all", "movie", "tv"],
      description: "Filter tipe konten untuk action popular/latest/toprated (default: all / movie)",
      example: "all",
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    let action = params.action ? String(params.action).trim().toLowerCase() : "";
    const query = String(params.query || params.q || "").trim();
    const slug = String(params.slug || params.id || "").trim();
    const type = String(params.type || "").trim().toLowerCase();

    if (!action) {
      if (slug) action = "detail";
      else if (query) action = "search";
      else action = "trending";
    }

    if (!ACTIONS.includes(action)) {
      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: ${ACTIONS.join(", ")}`,
      });
    }

    logger.info(`[MovieZone] Request action=${action}${query ? ` query=${query}` : ""}${slug ? ` slug=${slug}` : ""}`);

    try {
      if (action === "search") {
        if (!query) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const raw = await get("/search?q=" + encodeURIComponent(query) + "&page=1");
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          query,
          total: items.length,
          result: items,
        });
      }

      if (action === "detail") {
        if (!slug) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'slug' (atau 'id') wajib diisi untuk action=detail",
          });
        }
        const raw = await get("/detail/" + encodeURIComponent(slug));
        const data = fmtDetail(Array.isArray(raw) ? raw[0] || {} : raw);
        return res.status(200).json({
          status: true,
          action,
          slug,
          result: data,
        });
      }

      if (action === "trending") {
        const raw = await get("/trending");
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          total: items.length,
          result: items,
        });
      }

      if (action === "popular") {
        const targetType = type || "all";
        const raw = await get("/popular?page=1&type=" + targetType);
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          type: targetType,
          total: items.length,
          result: items,
        });
      }

      if (action === "latest") {
        const targetType = type || "all";
        const raw = await get("/latest?type=" + targetType);
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          type: targetType,
          total: items.length,
          result: items,
        });
      }

      if (action === "upcoming") {
        const raw = await get("/upcoming");
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          total: items.length,
          result: items,
        });
      }

      if (action === "toprated") {
        const targetType = type || "movie";
        const raw = await get("/top-rated?type=" + targetType);
        const items = toList(raw).map(fmt);
        return res.status(200).json({
          status: true,
          action,
          type: targetType,
          total: items.length,
          result: items,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak dikenali`,
      });
    } catch (err) {
      logger.error(`[MovieZone] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        action,
        message: err.message || "Terjadi kesalahan saat memproses data MovieZone",
      });
    }
  },
};
