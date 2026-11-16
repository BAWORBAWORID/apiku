/**
 * donghua.js — satu file: gateway crypto + auth + API + CLI.
 *
 *   node donghua.js <command> [args] [options]
 *
 * Contoh:
 *   node donghua.js detail primeval-overlord
 *   node donghua.js stream <episodeId>
 *   node donghua.js subtitle <subtitleId> --srt
 */

import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GATEWAY_BASE = "https://gateway.dongha.id";
const UA =
  "Mozilla/5.0 (Linux; Android 14; Dongha) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

function hkdf(ikm, salt, info, length = 32) {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

function maybeDecompress(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  if (buf.length >= 2 && buf[0] === 0x78 && [0x01, 0x9c, 0xda].includes(buf[1]))
    return zlib.inflateSync(buf);
  return buf;
}

function isJsonType(contentType = "") {
  return (
    contentType.includes("json") ||
    contentType.includes("javascript") ||
    contentType.includes("xml") ||
    contentType.includes("urlencoded") ||
    contentType.startsWith("text/")
  );
}

class GatewayError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.body = body;
  }
}

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

class Gateway {
  constructor({ token = null } = {}) {
    this.token = token;
    this.session = null;
    this.key = null;
  }

  async bootstrap() {
    const { status, raw } = await this.#send("POST", "/gateway/session/bootstrap", "{}");
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = null;
    }
    if (status !== 200 || !body) throw new GatewayError("bootstrap failed", status, body);
    const data = body.data;
    const info = Buffer.from(`dongha-gateway|v1|${data.scope}|${data.kid}`);
    this.session = data;
    this.key = hkdf(Buffer.from(data.session_secret, "base64"), Buffer.from(data.session_id), info);
    return data;
  }

  async #send(method, pathName, body, headers = {}) {
    const h = {
      "user-agent": UA,
      accept: "application/json, */*",
      ...headers,
    };
    if (this.session) h["X-Gateway-Kid"] = this.session.kid;
    if (this.token) h.authorization = `Bearer ${this.token}`;
    let payload;
    if (body !== undefined && body !== null) {
      payload = Buffer.isBuffer(body)
        ? body
        : typeof body === "string"
          ? Buffer.from(body)
          : Buffer.from(JSON.stringify(body));
      h["content-type"] = "application/json";
    }
    const res = await fetch(GATEWAY_BASE + pathName, { method, headers: h, body: payload });
    const raw = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, raw };
  }

  #decrypt(env, method, pathName) {
    const barePath = pathName.split("?")[0];
    const aad = Buffer.from(
      [method, barePath, env.upstream, String(env.status), env.content_type, env.kid].join("\n")
    );
    const decipher = crypto.createDecipheriv(
      "chacha20-poly1305",
      this.key,
      Buffer.from(env.nonce, "base64"),
      { authTagLength: 16 }
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(env.ciphertext, "base64").subarray(-16));
    const ct = Buffer.from(env.ciphertext, "base64").subarray(0, -16);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return { plaintext: maybeDecompress(pt), contentType: env.content_type, status: env.status };
  }

  async request(method, pathName, { body, headers, allowError = true } = {}) {
    if (!this.session) await this.bootstrap();
    const { status, raw } = await this.#send(method, pathName, body, headers);

    let payload = raw;
    let contentType = "";
    let httpStatus = status;
    let env = null;
    try {
      env = JSON.parse(raw.toString("utf8"));
    } catch {
      env = null;
    }
    if (env && env.alg === "C20P") {
      let dec;
      try {
        dec = this.#decrypt(env, method, pathName);
      } catch (e) {
        throw new GatewayError(`decrypt failed: ${e.message}`, Number(env.status) || 500, env);
      }
      payload = dec.plaintext;
      contentType = dec.contentType;
      httpStatus = dec.status;
    }

    let parsed = payload;
    if (contentType && isJsonType(contentType)) {
      const text = payload.toString("utf8");
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else if (payload.length === 0) {
      parsed = null;
    } else {
      const text = payload.toString("utf8");
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = payload;
      }
    }

    if (httpStatus >= 400 && !allowError) {
      const msg =
        (parsed && parsed.errors && parsed.errors[0] && parsed.errors[0].message) ||
        `HTTP ${httpStatus}`;
      throw new GatewayError(msg, httpStatus, parsed);
    }
    return { status: httpStatus, body: parsed, raw: payload };
  }

  get(pathName, opts) {
    return this.request("GET", pathName, opts);
  }

  post(pathName, body, opts) {
    return this.request("POST", pathName, { ...opts, body });
  }
}

const MAIL_API = "https://api.mail.tm";

let CREDS_OVERRIDE = null;

function credsPath() {
  if (CREDS_OVERRIDE) return CREDS_OVERRIDE;
  if (process.env.DONGHA_CREDS) return process.env.DONGHA_CREDS;
  return "/home/agentuser/apiku/api/anime/assets/dongha-creds.json";
}

function readCreds() {
  try {
    return JSON.parse(fs.readFileSync(credsPath(), "utf8"));
  } catch {
    return null;
  }
}

function writeCreds(creds) {
  const p = credsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(creds, null, 2) + "\n");
  try {
    fs.chmodSync(p, 0o600);
  } catch {}
  return creds;
}

async function mail(method, url, { body, token } = {}) {
  const headers = { accept: "application/json", "user-agent": "Mozilla/5.0" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }
  throw new Error("mail.tm rate limited too many times");
}

function members(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === "object") return obj["hydra:member"] || obj.member || [];
  return [];
}

async function login(email, password) {
  const g = new Gateway();
  const { status, body } = await g.post("/auth-login", { email, password });
  if (status !== 200) {
    const msg = body?.errors?.[0]?.message || `login failed (${status})`;
    throw new GatewayError(msg, status, body);
  }
  const data = body.data || body;
  const creds = { ...(readCreds() || {}), email, password, ...data };
  writeCreds(creds);
  return creds;
}

async function refresh() {
  const creds = readCreds();
  if (!creds?.refresh_token) throw new Error("no refresh token; run `login` first");
  const g = new Gateway();
  const { status, body } = await g.post("/auth/refresh", { refresh_token: creds.refresh_token });
  if (status !== 200) {
    const msg = body?.errors?.[0]?.message || `refresh failed (${status})`;
    throw new GatewayError(msg, status, body);
  }
  const data = body.data || body;
  writeCreds({ ...creds, ...data });
  return data;
}

async function getToken() {
  const creds = readCreds();
  if (creds && creds.access_token) {
    // Jika masih ada sisa waktu valid minimal 5 menit, pakai
    if (creds.expires && creds.date_created) {
      const created = new Date(creds.date_created).getTime();
      const expires = Number(creds.expires) || 0;
      if (Date.now() < created + expires - 300000) {
        return creds.access_token;
      }
    } else {
      return creds.access_token;
    }
  }

  // Coba refresh token
  if (creds && creds.refresh_token) {
    try {
      const data = await refresh();
      if (data && data.access_token) return data.access_token;
    } catch (e) {
      console.warn("[Dongha] Refresh token failed, falling back to login/register:", e.message);
    }
  }

  // Coba login ulang jika ada email & password
  if (creds && creds.email && creds.password) {
    try {
      const c = await login(creds.email, creds.password);
      if (c && c.access_token) return c.access_token;
    } catch (e) {
      console.warn("[Dongha] Re-login failed, attempting auto-register:", e.message);
    }
  }

  // Jika semua gagal / belum ada creds / token expired permanen -> AUTO REGISTER
  try {
    console.log("[Dongha] Auto-registering new session via mail.tm...");
    const newCreds = await register();
    return newCreds.access_token;
  } catch (err) {
    console.error("[Dongha] Auto-register failed:", err.message);
    return null;
  }
}

async function newInbox() {
  const dom = await mail("GET", `${MAIL_API}/domains`);
  const domain = members(dom.body)[0]?.domain;
  if (!domain) throw new Error("mail.tm: no domain available");
  const user = "dg" + crypto.randomBytes(8).toString("hex");
  const address = `${user}@${domain}`;
  const password = crypto.randomBytes(12).toString("base64url");
  const acc = await mail("POST", `${MAIL_API}/accounts`, { body: { address, password } });
  if (acc.status !== 200 && acc.status !== 201)
    throw new Error(`mail.tm account create failed: ${JSON.stringify(acc.body)}`);
  const tok = await mail("POST", `${MAIL_API}/token`, { body: { address, password } });
  if (tok.status !== 200) throw new Error(`mail.tm token failed: ${JSON.stringify(tok.body)}`);
  return { address, token: tok.body.token };
}

async function waitForCode(token, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  const patterns = [/code is (\d{6})/i, /kode\s*:?\s*(\d{6})/i, /\b(\d{6})\b/];
  while (Date.now() < deadline) {
    const list = await mail("GET", `${MAIL_API}/messages`, { token });
    for (const m of members(list.body)) {
      const full = await mail("GET", `${MAIL_API}/messages/${m.id}`, { token });
      const text = full.body?.text || "";
      for (const re of patterns) {
        const hit = re.exec(text);
        if (hit) return hit[1];
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("timed out waiting for verification code");
}

async function register() {
  const inbox = await newInbox();
  const password = "Dh" + crypto.randomBytes(12).toString("base64url") + "!7";
  const g = new Gateway();

  let reg = await g.post("/auth-register", { email: inbox.address, password });
  if (reg.status === 429) {
    await new Promise((r) => setTimeout(r, 65000));
    reg = await g.post("/auth-register", { email: inbox.address, password });
  }
  if (reg.status !== 200)
    throw new GatewayError(`register failed (${reg.status})`, reg.status, reg.body);

  const code = await waitForCode(inbox.token);
  const ver = await g.post("/auth-register/verify", {
    email: inbox.address,
    password,
    code,
  });
  if (ver.status !== 200)
    throw new GatewayError(`verify failed (${ver.status})`, ver.status, ver.body);

  const data = ver.body.data || ver.body;
  return writeCreds({ email: inbox.address, password, mail_token: inbox.token, ...data });
}

const ASSETS_BASE = "https://dongha.epeministudio.com";
const VIDEO_BASE = "https://video.epeministudio.com";
const HLS_BASE = "https://media.epeministudio.com/v";

const SERIES_DETAIL_FIELDS = [
  "id", "title", "title_english", "title_native", "title_romaji", "slug",
  "synopsis", "synopsis_id", "poster_image.filename_disk",
  "backdrop_image.filename_disk", "logo_image.filename_disk", "trailer_url",
  "content_rating", "original_language", "is_featured", "status",
  "category.id", "category.name", "category.slug",
  "genres.id", "genres.genres_id.id", "genres.genres_id.name", "genres.genres_id.slug",
  "seasons.id", "seasons.season_number", "seasons.title", "seasons.synopsis",
  "seasons.synopsis_id", "seasons.poster_image.filename_disk", "seasons.airing_status",
  "seasons.broadcast_day", "seasons.broadcast_time", "seasons.mal_score",
  "seasons.studio.name", "seasons.release_year", "seasons.type.name",
  "seasons.total_episodes", "seasons.is_premium", "seasons.status",
];

const EPISODE_LIST_FIELDS = [
  "id", "number", "title", "title_id", "synopsis", "thumbnail.filename_disk",
  "duration", "air_date", "is_filler", "is_premium", "status", "sort",
  "videos.id", "videos.quality", "videos.r2_url", "videos.status", "videos.file_size",
  "subtitles.id", "subtitles.language", "subtitles.label", "subtitles.is_default",
  "subtitles.format", "subtitles.file.filename_disk", "subtitles.file_url",
];

const EPISODE_DETAIL_FIELDS = [
  "id", "number", "title", "title_id", "synopsis", "thumbnail.filename_disk",
  "duration", "air_date", "series_id.id", "series_id.title",
  "series_id.poster_image.filename_disk", "series_id.slug",
  "season_id.id", "season_id.season_number", "season_id.poster_image.filename_disk",
  "season_id.type.name", "season_id.title", "season_id.title_english",
  "season_id.title_romaji", "is_filler", "is_premium",
  "subtitle_offset_percent", "season_id.subtitle_offset_percent",
  "series_id.subtitle_offset_percent",
  "videos.id", "videos.quality", "videos.r2_url", "videos.hls_url",
  "videos.backup_url", "videos.file_size", "videos.codec", "videos.status",
  "segments.id", "segments.type", "segments.start_time", "segments.end_time",
  "subtitles.id", "subtitles.language", "subtitles.label", "subtitles.format",
  "subtitles.file.filename_disk", "subtitles.file.filename_download",
  "subtitles.file.type", "subtitles.file_url", "subtitles.is_default", "subtitles.sort",
];

const SERIES_SEARCH_FIELDS = [
  "id", "title", "slug", "poster_image.filename_disk", "content_rating",
  "category.slug", "original_language", "date_created",
  "seasons.id", "seasons.season_number", "seasons.airing_status",
  "seasons.release_year", "seasons.mal_score", "seasons.type.name",
];

const SCHEDULE_SEASON_FIELDS = [
  "id", "season_number", "title", "airing_status", "broadcast_day",
  "broadcast_time", "poster_image.filename_disk", "release_year", "type.name",
  "series_id.id", "series_id.title", "series_id.poster_image.filename_disk",
  "series_id.slug", "series_id.category.slug",
];

const SORTS = ["popular", "latest", "top_rated"];
const DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of v) if (item !== undefined && item !== null) sp.append(k, String(item));
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function imageUrl(file, base = ASSETS_BASE) {
  if (!file) return null;
  if (/^https?:\/\//.test(file)) return file;
  return `${base}/${file}`;
}

function absolutizeUrl(p, kind = "auto") {
  if (!p) return null;
  if (/^https?:\/\//.test(p)) return p;
  const s = String(p).replace(/^\//, "");
  const wantsHls =
    kind === "hls" || (kind === "auto" && (s.endsWith(".m3u8") || s.includes(".m3u8")));
  if (wantsHls) return `${HLS_BASE}/${s}`;
  return `${VIDEO_BASE}/${s}`;
}

function videoUrl(video, kind = "auto") {
  if (!video) return null;
  const raw =
    video.streaming_url || video.r2_url || video.hls_url || video.backup_url || video.download_url;
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) return raw;
  const isHls = String(raw).includes(".m3u8");
  return absolutizeUrl(raw, kind === "auto" ? (isHls ? "hls" : "mp4") : kind);
}

function decorateVideos(videos) {
  if (!Array.isArray(videos)) return videos;
  return videos.map((v) => {
    const hls = absolutizeUrl(v.hls_url, "hls");
    const mp4 = absolutizeUrl(v.r2_url, "mp4");
    const backup = absolutizeUrl(
      v.backup_url,
      String(v.backup_url || "").includes(".m3u8") ? "hls" : "mp4"
    );
    return {
      ...v,
      r2_url: mp4,
      hls_url: hls,
      backup_url: v.backup_url ? backup : v.backup_url,
      url: hls || mp4 || backup,
    };
  });
}

function decorateEpisode(ep) {
  if (!ep) return ep;
  return { ...ep, videos: decorateVideos(ep.videos) };
}

class Dongha {
  #initing = null;

  constructor({ token } = {}) {
    this.token = token;
    this.gateway = null;
  }

  async init() {
    if (this.gateway) return this;
    if (!this.#initing) {
      this.#initing = (async () => {
        if (this.token === undefined) this.token = await getToken();
        const g = new Gateway({ token: this.token });
        await g.bootstrap();
        this.gateway = g;
      })();
    }
    await this.#initing;
    return this;
  }

  async #get(pathName, { allowError = true } = {}) {
    await this.init();
    const res = await this.gateway.get(pathName, { allowError });
    if (res.status >= 400) {
      const msg = res.body?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new HttpError(`${msg} (${pathName})`, res.status, res.body);
    }
    return res.body;
  }

  home({ category = "donghua" } = {}) {
    return this.#get(`/home-feed${qs({ category })}`);
  }

  latest({ category = "donghua", limit = 20, page = 1 } = {}) {
    return this.#get(`/latest-episodes${qs({ category, limit, page })}`);
  }

  filters() {
    return this.#get("/explore/filters");
  }

  explore({ sort, category, genre, studio, year, page, limit = 24, search } = {}) {
    return this.#get(
      `/explore${qs({ sort, category, genre, studio, year, page, limit, search })}`
    );
  }

  async #all(pathName, params, { maxPages = 50 } = {}) {
    const out = [];
    let page = 1;
    for (;;) {
      const body = await this.#get(`${pathName}${qs({ ...params, page })}`);
      const data = body.data || [];
      out.push(...data);
      const total = body.meta?.total;
      if (!data.length || out.length >= (total ?? Infinity) || page >= maxPages) break;
      page += 1;
    }
    return { data: out, meta: { count: out.length } };
  }

  seasons({ category = "donghua", airingStatus = "ongoing" } = {}) {
    const params = { fields: SCHEDULE_SEASON_FIELDS, sort: "series_id.title", limit: 100 };
    if (airingStatus) params["filter[airing_status][_eq]"] = airingStatus;
    if (category) params["filter[series_id][category][slug][_eq]"] = category;
    return this.#all("/items/seasons", params);
  }

  async schedule({ category = "donghua", day = null } = {}) {
    const { data } = await this.seasons({ category });
    const byDay = Object.fromEntries(DAYS.map((d) => [d, []]));
    for (const s of data) {
      const raw = s.broadcast_day;
      const days = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const d of days) if (byDay[d]) byDay[d].push(s);
    }
    for (const d of DAYS) {
      byDay[d].sort((a, b) =>
        String(a.broadcast_time || "99").localeCompare(String(b.broadcast_time || "99"))
      );
    }
    if (day) {
      const key = String(day).toLowerCase();
      const items = byDay[key] || [];
      return { day: key, count: items.length, items };
    }
    return {
      category,
      total: data.length,
      week: DAYS.map((d) => ({ day: d, count: byDay[d].length, items: byDay[d] })),
    };
  }

  /** Detail series (id UUID atau slug) + daftar episode tiap season. */
  async detail(idOrSlug, { includeEpisodes = true, episodeLimit = 1000 } = {}) {
    const q = qs({ fields: SERIES_DETAIL_FIELDS });
    let series = null;
    if (UUID_RE.test(idOrSlug)) {
      const body = await this.#get(`/items/series/${idOrSlug}${q}`);
      series = body.data;
    } else {
      const res = await this.#get(
        `/items/series${qs({
          "filter[slug][_eq]": idOrSlug,
          limit: 1,
          fields: SERIES_DETAIL_FIELDS,
        })}`
      );
      series = res.data?.[0] || null;
    }
    if (series && includeEpisodes && Array.isArray(series.seasons) && series.seasons.length) {
      await Promise.all(
        series.seasons.map(async (season) => {
          try {
            const res = await this.episodes(season.id, { limit: episodeLimit });
            season.episodes = res.data || [];
          } catch (err) {
            season.episodes = [];
            season.episodes_error = err.message;
          }
          season.episode_count = season.episodes.length;
        })
      );
      series.episode_count = series.seasons.reduce((n, s) => n + (s.episode_count || 0), 0);
    }
    return series;
  }

  async episodes(seasonId, { limit = 500, offset = 0 } = {}) {
    const body = await this.#get(
      `/items/episodes${qs({
        "filter[season_id][_eq]": seasonId,
        sort: "number",
        limit,
        offset,
        fields: EPISODE_LIST_FIELDS,
      })}`
    );
    return { ...body, data: (body.data || []).map(decorateEpisode) };
  }

  async episode(episodeId) {
    const body = await this.#get(
      `/items/episodes/${episodeId}${qs({ fields: EPISODE_DETAIL_FIELDS })}`
    );
    return decorateEpisode(body.data);
  }

  async sources(episodeId) {
    const body = await this.#get(`/media/episodes/${episodeId}/sources`);
    const data = body.data || {};
    const videos = (data.videos || []).map((v) => ({
      ...v,
      url: videoUrl(v),
      streaming_url: absolutizeUrl(v.streaming_url, "hls"),
      download_url: absolutizeUrl(v.download_url || v.r2_url, "mp4"),
      r2_url: v.r2_url ? absolutizeUrl(v.r2_url, "mp4") : v.r2_url,
    }));
    return { ...data, videos };
  }

  async stream(episodeId) {
    const episode = await this.episode(episodeId);
    const sources = await this.sources(episodeId);
    const subtitles = (episode?.subtitles || []).map((s) => ({
      ...s,
      vttUrl: `${GATEWAY_BASE}/subtitles-vtt/${s.id}`,
      srtUrl: s.file?.filename_disk ? `${ASSETS_BASE}/${s.file.filename_disk}` : s.file_url || null,
    }));
    return {
      episode,
      videos: sources.videos,
      segments: episode?.segments || [],
      subtitles,
    };
  }

  /** Isi subtitle. format: "vtt" (default) atau "srt". */
  async subtitle(subtitleId, { format = "vtt" } = {}) {
    await this.init();
    if (format === "srt") {
      let target = subtitleId;
      if (!/\.(srt|vtt|ass|ssa|txt)$/i.test(target)) {
        const rec = await this.#get(
          `/items/subtitles/${subtitleId}${qs({
            fields: ["file.filename_disk", "file_url"],
          })}`
        );
        target = rec.data?.file?.filename_disk || rec.data?.file_url;
        if (!target) throw new Error(`no srt file for subtitle ${subtitleId}`);
      }
      const url = /^https?:\/\//.test(target) ? target : `${ASSETS_BASE}/${target}`;
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      return { status: res.status, text: await res.text() };
    }
    const res = await this.gateway.get(`/subtitles-vtt/${subtitleId}`);
    const text = res.raw && res.raw.length ? res.raw.toString("utf8") : String(res.body ?? "");
    return { status: res.status, text };
  }

  search(query, { category, limit = 20, offset = 0 } = {}) {
    const params = {
      search: query,
      limit,
      offset,
      sort: "-date_created",
      fields: SERIES_SEARCH_FIELDS,
    };
    if (category) params["filter[category][slug][_eq]"] = category;
    return this.#get(`/items/series${qs(params)}`);
  }
}

const USAGE = `donghua.js — donghua-only scraper untuk app Dongha (satu file)

Usage: node donghua.js <command> [args] [options]

Auth
  login --email <e> --password <p>   Sign in dan simpan creds.json
  register                           Buat akun baru (inbox sekali pakai)
  refresh                            Refresh access token

Content (default --category donghua)
  home                               Beranda: banner, episode terbaru, section katalog
  latest [--limit N] [--page N]      Episode Terbaru
  filters                            Genre, studio, tahun, kategori
  explore [--genre slug] [--studio slug] [--year YYYY]
           [--sort popular|latest|top_rated] [--page N] [--limit N] [--search q]
  jadwal [--day <hari>]              Jadwal tayang (monday..sunday)
  detail <id|slug> [--no-episodes]   Detail series + season + daftar episode
  episodes <seasonId>                Daftar episode
  episode <episodeId>                Detail episode (video/segmen/subtitle)
  stream <episodeId>                 URL streaming siap putar + subtitle
  subtitle <subtitleId> [--srt]      Isi subtitle (vtt default, atau srt)
  search <query>                     Pencarian judul

Global: --category <slug> (anime|donghua), --raw, --creds <path>
`;

function parseArgs(argv) {
  const args = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args.opts[key] = true;
      else {
        args.opts[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function print(value, raw) {
  if (raw && typeof value === "string") process.stdout.write(value);
  else process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

const num = (v, d) => (v === undefined ? d : Number(v));

async function main() {
  const { _, opts } = parseArgs(process.argv.slice(2));
  const cmd = _[0];

  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  if (opts.creds) CREDS_OVERRIDE = opts.creds;

  const category = opts.category || "donghua";

  if (cmd === "login") {
    const email = opts.email || _[1];
    const password = opts.password || _[2];
    if (!email || !password) throw new Error("usage: login --email <e> --password <p>");
    const creds = await login(email, password);
    print({ ok: true, email: creds.email, expires: creds.expires });
    return;
  }
  if (cmd === "register") {
    const creds = await register();
    print({ ok: true, email: creds.email, expires: creds.expires });
    return;
  }
  if (cmd === "refresh") {
    const data = await refresh();
    print({ ok: true, expires: data.expires });
    return;
  }

  const api = new Dongha();

  switch (cmd) {
    case "home": {
      const body = await api.home({ category });
      const d = body.data || body;
      print(
        {
          categories: d.categories,
          banners: d.banners,
          latest_episodes: d.latest_episodes,
          featured_sections: d.featured_sections,
          catalog_sections: (d.catalog_sections || []).map((s) => ({
            title: s.title,
            display_type: s.display_type,
            filter_type: s.filter_type,
            filter_slug: s.filter_slug,
            content_category: s.content_category,
            items: s.items,
          })),
        },
        opts.raw
      );
      break;
    }
    case "latest":
      print(await api.latest({ category, limit: num(opts.limit, 20), page: num(opts.page, 1) }), opts.raw);
      break;
    case "filters":
      print(await api.filters(), opts.raw);
      break;
    case "explore": {
      if (opts.sort && !SORTS.includes(opts.sort))
        throw new Error(`--sort must be one of: ${SORTS.join(", ")}`);
      print(
        await api.explore({
          category,
          sort: opts.sort,
          genre: opts.genre,
          studio: opts.studio,
          year: opts.year ? Number(opts.year) : undefined,
          page: opts.page ? Number(opts.page) : undefined,
          limit: num(opts.limit, 24),
          search: opts.search,
        }),
        opts.raw
      );
      break;
    }
    case "jadwal":
    case "schedule":
      print(await api.schedule({ category, day: opts.day || _[1] }), opts.raw);
      break;
    case "detail": {
      const id = _[1];
      if (!id) throw new Error("usage: detail <id|slug> [--no-episodes]");
      print(await api.detail(id, { includeEpisodes: !opts["no-episodes"] }), opts.raw);
      break;
    }
    case "episodes": {
      const seasonId = _[1];
      if (!seasonId) throw new Error("usage: episodes <seasonId>");
      const body = await api.episodes(seasonId, {
        limit: num(opts.limit, 500),
        offset: num(opts.offset, 0),
      });
      print(body.data || body, opts.raw);
      break;
    }
    case "episode": {
      const id = _[1];
      if (!id) throw new Error("usage: episode <episodeId>");
      print(await api.episode(id), opts.raw);
      break;
    }
    case "stream": {
      const id = _[1];
      if (!id) throw new Error("usage: stream <episodeId>");
      print(await api.stream(id), opts.raw);
      break;
    }
    case "subtitle": {
      const id = _[1];
      if (!id) throw new Error("usage: subtitle <subtitleId> [--srt]");
      const out = await api.subtitle(id, { format: opts.srt ? "srt" : "vtt" });
      if (out.status >= 400) throw new Error(`subtitle fetch failed (${out.status})`);
      process.stdout.write(out.text);
      break;
    }
    case "search": {
      const q = _[1];
      if (!q) throw new Error("usage: search <query>");
      const body = await api.search(q, {
        category: opts.all ? undefined : category,
        limit: num(opts.limit, 20),
        offset: num(opts.offset, 0),
      });
      print(body.data || body, opts.raw);
      break;
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch((err) => {
    const payload = { error: err.message };
    if (err.status) payload.status = err.status;
    if (err.body && err.status >= 400) payload.detail = err.body;
    process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
    process.exit(1);
  });
}

const Auth = { login, refresh, register, getToken, credsPath, setCredsPath: (p) => (CREDS_OVERRIDE = p) };

export {
  Gateway,
  GatewayError,
  HttpError,
  Dongha,
  Auth,
  SORTS,
  DAYS,
  UUID_RE,
  qs,
  imageUrl,
  absolutizeUrl,
  videoUrl,
  decorateVideos,
  ASSETS_BASE,
  VIDEO_BASE,
  HLS_BASE,
  GATEWAY_BASE,
  USAGE,
};



export default {
  name: "Dongha Stream & Catalog",
  description: "Scraper & API Streaming Donghua / Anime via gateway Dongha (home, latest, filters, explore, schedule, detail, episodes, episode, stream, subtitle, search). Auto-register & auto-refresh session aktif.",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "id", "slug", "season_id", "category", "sort", "genre", "studio", "year", "day", "page", "limit", "format"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: ["home", "latest", "filters", "explore", "schedule", "jadwal", "detail", "episodes", "episode", "stream", "subtitle", "search"],
      description: "Aksi yang diinginkan"
    },
    query: { type: "string", required: false, description: "Keyword pencarian judul (action=search)" },
    id: { type: "string", required: false, description: "ID atau slug (action=detail, episode, stream, subtitle)" },
    slug: { type: "string", required: false, description: "Alias untuk id" },
    season_id: { type: "string", required: false, description: "Season ID (action=episodes)" },
    category: { type: "string", required: false, default: "donghua", description: "Kategori: donghua atau anime" },
    sort: { type: "string", required: false, enum: ["popular", "latest", "top_rated"], description: "Sort explore" },
    genre: { type: "string", required: false, description: "Slug genre untuk explore" },
    studio: { type: "string", required: false, description: "Slug studio untuk explore" },
    year: { type: "number", required: false, description: "Tahun rilis untuk explore" },
    day: { type: "string", required: false, description: "Hari tayang (monday..sunday) untuk action=schedule" },
    page: { type: "number", required: false, default: 1, description: "Halaman paginasi" },
    limit: { type: "number", required: false, default: 20, description: "Batas item per request" },
    format: { type: "string", required: false, enum: ["vtt", "srt"], default: "vtt", description: "Format subtitle (action=subtitle)" }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = String(params.action || "").trim().toLowerCase();

      if (!action) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' wajib diisi: home, latest, filters, explore, schedule, detail, episodes, episode, stream, subtitle, search"
        });
      }

      const api = new Dongha();
      const category = params.category || "donghua";
      const limit = Number(params.limit) || 20;
      const page = Number(params.page) || 1;
      const targetId = params.id || params.slug || params.query;

      let result;

      switch (action) {
        case "home": {
          const body = await api.home({ category });
          const d = body.data || body;
          result = {
            categories: d.categories,
            banners: d.banners,
            latest_episodes: d.latest_episodes,
            featured_sections: d.featured_sections,
            catalog_sections: (d.catalog_sections || []).map((s) => ({
              title: s.title,
              display_type: s.display_type,
              filter_type: s.filter_type,
              filter_slug: s.filter_slug,
              content_category: s.content_category,
              items: s.items,
            })),
          };
          break;
        }

        case "latest": {
          const body = await api.latest({ category, limit, page });
          result = body.data || body;
          break;
        }

        case "filters": {
          const body = await api.filters();
          result = body.data || body;
          break;
        }

        case "explore": {
          const body = await api.explore({
            category,
            sort: params.sort,
            genre: params.genre,
            studio: params.studio,
            year: params.year ? Number(params.year) : undefined,
            page,
            limit,
            search: params.query || params.search,
          });
          result = body.data || body;
          break;
        }

        case "schedule":
        case "jadwal": {
          result = await api.schedule({ category, day: params.day });
          break;
        }

        case "detail": {
          if (!targetId) {
            return res.status(400).json({ status: false, message: "Parameter 'id' atau 'slug' wajib untuk action=detail" });
          }
          const noEpisodes = params.no_episodes === true || params.no_episodes === "true";
          result = await api.detail(targetId, { includeEpisodes: !noEpisodes });
          break;
        }

        case "episodes": {
          const seasonId = params.season_id || targetId;
          if (!seasonId) {
            return res.status(400).json({ status: false, message: "Parameter 'season_id' wajib untuk action=episodes" });
          }
          const body = await api.episodes(seasonId, { limit, offset: (page - 1) * limit });
          result = body.data || body;
          break;
        }

        case "episode": {
          if (!targetId) {
            return res.status(400).json({ status: false, message: "Parameter 'id' (episodeId) wajib untuk action=episode" });
          }
          result = await api.episode(targetId);
          break;
        }

        case "stream": {
          if (!targetId) {
            return res.status(400).json({ status: false, message: "Parameter 'id' (episodeId) wajib untuk action=stream" });
          }
          result = await api.stream(targetId);
          break;
        }

        case "subtitle": {
          if (!targetId) {
            return res.status(400).json({ status: false, message: "Parameter 'id' (subtitleId) wajib untuk action=subtitle" });
          }
          const fmt = (params.format || "vtt").toLowerCase();
          const sub = await api.subtitle(targetId, { format: fmt });
          if (params.raw === "true" || params.raw === true) {
            res.setHeader("Content-Type", fmt === "srt" ? "text/plain; charset=utf-8" : "text/vtt; charset=utf-8");
            return res.send(sub.text);
          }
          result = { format: fmt, status: sub.status, content: sub.text };
          break;
        }

        case "search": {
          if (!params.query) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search" });
          }
          const body = await api.search(params.query, {
            category: params.all === "true" ? undefined : category,
            limit,
            offset: (page - 1) * limit,
          });
          result = body.data || body;
          break;
        }

        default:
          return res.status(400).json({
            status: false,
            message: "Aksi tidak dikenali: " + action
          });
      }

      return res.json({
        status: true,
        action,
        result
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        status: false,
        message: err.message || "Internal Server Error",
        detail: err.body || undefined
      });
    }
  }
};
