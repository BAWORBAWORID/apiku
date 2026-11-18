import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://manta.net";
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const HOME_CACHE_TTL_MS = 5 * 60 * 1000;
const CATEGORIES_CACHE_TTL_MS = 30 * 60 * 1000;

const homeCache = new Map();
let categoriesCache = null;

function pickLang(obj, lang = "en") {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return (
    obj[lang] ||
    obj.en ||
    obj.es ||
    obj.fr ||
    obj.de ||
    obj.ko ||
    Object.values(obj).find((v) => typeof v === "string") ||
    ""
  );
}

function slugify(title) {
  return String(title || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractCover(image) {
  if (!image) return "";
  const preferred = [
    "1280x1840_720",
    "1280x1840_480",
    "1280x1840",
    "1440x1440_720",
    "1440x1440_480",
    "1440x1440",
    "thumbnail1",
    "cover",
    "title_450",
  ];
  for (const key of preferred) {
    if (image[key]?.downloadUrl) return image[key].downloadUrl;
  }
  for (const val of Object.values(image)) {
    if (val?.downloadUrl) return val.downloadUrl;
  }
  return "";
}

function extractImagesMap(image) {
  const out = {};
  if (!image || typeof image !== "object") return out;
  for (const [key, val] of Object.entries(image)) {
    if (val?.downloadUrl) out[key] = val.downloadUrl;
  }
  return out;
}

function extractSeriesIdFromInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return { numericId: null, slug: "" };
  if (/^\d+$/.test(raw)) return { numericId: parseInt(raw, 10), slug: "" };

  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const u = new URL(raw);
      const qId = u.searchParams.get("seriesId");
      if (qId && /^\d+$/.test(qId)) return { numericId: parseInt(qId, 10), slug: "" };
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("series");
      if (idx !== -1 && parts[idx + 1]) return { numericId: null, slug: slugify(parts[idx + 1]) };
    }
  } catch {
    // ignore
  }
  return { numericId: null, slug: slugify(raw) };
}

function normalizeCreators(creators) {
  if (!Array.isArray(creators)) return [];
  return creators.map((c) => ({
    name: c.name || c.creatorName || "",
    role: c.role || c.type || "",
  }));
}

function normalizeTags(tags, lang = "en") {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => {
      const name = pickLang(t.name, lang);
      return { id: t.id, name, slug: slugify(name) };
    })
    .filter((t) => t.name);
}

function normalizeSeriesSummary(series, lang = "en", extra = {}) {
  const d = series?.data || {};
  const title = pickLang(d.title, lang) || extra.title || "";
  const slug = slugify(title);
  const id = series?.id ?? extra.seriesId;
  return {
    id,
    title,
    slug,
    url: id ? `${BASE_URL}/${lang}/series/${slug || "title"}?seriesId=${id}` : "",
    cover: extractCover(series?.image),
    images: extractImagesMap(series?.image),
    description: pickLang(d.description, lang),
    creators: normalizeCreators(d.creators),
    tags: normalizeTags(d.tags, lang),
    ageRating: d.ageRating?.rate ?? d.ageRating ?? null,
    isCompleted: Boolean(d.isCompleted),
    isExclusive: Boolean(d.isExclusive),
    releaseSchedule: d.releaseSchedule || series?.derived?.releaseSchedule1?.text || "",
    freeEpisodeCount: d.freeEpisodeCount ?? null,
    latestEpisode: series?.latestEpisode
      ? {
          id: series.latestEpisode.id,
          ord: series.latestEpisode.ord,
          title: pickLang(series.latestEpisode.data?.title, lang),
          openAt: series.latestEpisode.openAt || null,
        }
      : null,
    firstEpisodeId: series?.firstEpisode?.id ?? null,
    openAt: series?.openAt || extra.openAt || null,
    updatedAt: series?.updatedAt || extra.updatedAt || null,
    popularity: extra.popularity ?? null,
    rank: extra.rank ?? null,
    badge: series?.derived?.badge?.type ?? null,
  };
}

function normalizeEpisode(ep, lang = "en") {
  const lockState = ep?.lockData?.state ?? null;
  const isFree =
    lockState === 110 ||
    lockState === 100 ||
    (!ep?.lockData?.buyOption && !ep?.lockData?.rentOption);
  return {
    id: ep.id,
    ord: ep.ord,
    title: pickLang(ep.data?.title, lang) || `Episode ${ep.ord}`,
    thumbnail: ep.image?.thumbnail1?.downloadUrl || extractCover(ep.image),
    openAt: ep.openAt || null,
    isFree,
    isPreviewAvailable: Boolean(ep.isPreviewAvailable),
    totalCutImageSize: ep.data?.totalCutImageSize ?? null,
    ageRating: ep.data?.ageRating?.rate ?? null,
    lockData: ep.lockData || null,
  };
}

class Manta {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || BASE_URL).replace(/\/+$/, "");
    this.lang = options.lang || "en";
    this.timeout = options.timeout || 15000;
  }

  static get DEFAULT_HEADERS() {
    return {
      "User-Agent": DEFAULT_UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/en`,
    };
  }

  async _getJson(endpoint, params = {}, headers = {}) {
    const url = new URL(endpoint, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { ...Manta.DEFAULT_HEADERS, ...headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} on ${endpoint}: ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async _fetchHomeRaw(lang = this.lang) {
    const now = Date.now();
    const cached = homeCache.get(lang);
    if (cached && cached.expiresAt > now) return cached.data;

    const json = await this._getJson("/front/v1/home/202606", {}, { "Accept-Language": `${lang},en;q=0.8` });
    const data = json?.data;
    if (!data) throw new Error("Respons home Manta tidak valid.");
    homeCache.set(lang, { data, expiresAt: now + HOME_CACHE_TTL_MS });
    return data;
  }

  async _hydrateSeriesMap(ids, seriesMap) {
    const missing = ids.filter((id) => id && !seriesMap[String(id)]);
    if (!missing.length) return;
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      try {
        const json = await this._getJson("/front/v1/home/series", { id: chunk.join(",") });
        Object.assign(seriesMap, json?.data?.seriesMap || {});
      } catch {
        // ignore partial failure
      }
    }
  }

  async resolveSeriesId(idOrSlug) {
    const { numericId, slug } = extractSeriesIdFromInput(idOrSlug);
    if (numericId) return numericId;
    if (!slug) throw new Error("Parameter 'id' atau 'slug' komik wajib diisi.");

    try {
      const home = await this._fetchHomeRaw();
      const seriesMap = home.seriesMap || {};
      for (const item of home.items || []) {
        const s = seriesMap[String(item.seriesId)];
        const title = pickLang(s?.data?.title, this.lang) || item.title || "";
        if (slugify(title) === slug) return Number(item.seriesId);
      }
    } catch {
      // fall through
    }

    const searchJson = await this._getJson("/manta/v1/search/series", { q: slug.replace(/-/g, " ") });
    const list = searchJson?.data || [];
    if (!list.length) throw new Error(`Komik '${idOrSlug}' tidak ditemukan di Manta.`);
    const exact = list.find((s) => slugify(pickLang(s.data?.title, this.lang)) === slug);
    return Number((exact || list[0]).id);
  }

  async home(lang = this.lang) {
    const home = await this._fetchHomeRaw(lang);
    const seriesMap = home.seriesMap || {};

    return {
      totalCatalog: (home.items || []).length,
      tabs: (home.tabs || []).map((t) => ({
        key: t.key,
        label: pickLang(t.label, lang),
        subTabs: (t.subTabs || []).map((st) => ({
          key: st.key,
          label: pickLang(st.label, lang),
          imageUrl: st.imageUrl || null,
        })),
      })),
      billboards: (home.billboardList || []).map((b) => ({
        id: b.id,
        type: b.type,
        title: pickLang(b.title, lang) || b.series?.data?.title?.[lang] || "",
        subtitle: b.subText || pickLang(b.description, lang) || "",
        seriesId: b.seriesId || b.series?.id || null,
        image: extractCover(b.image),
        images: extractImagesMap(b.image),
      })),
      themeCurations: (home.themeCurations || []).map((c) => ({
        id: c.id,
        title: pickLang(c.title, lang),
        subtitle: pickLang(c.subTitle || c.description, lang),
        series: (c.seriesIds || [])
          .map((id) => seriesMap[String(id)])
          .filter(Boolean)
          .map((s) => normalizeSeriesSummary(s, lang)),
      })),
      topItems: (home.items || []).slice(0, 30).map((item) => {
        const s = seriesMap[String(item.seriesId)];
        return s
          ? normalizeSeriesSummary(s, lang, item)
          : { id: item.seriesId, title: item.title, rank: item.rank, popularity: item.popularity };
      }),
    };
  }

  async popular(options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;
    const lang = options.lang || this.lang;
    const genreFilter = String(options.genre || "").trim().toLowerCase();

    const [rankingJson, home] = await Promise.all([
      this._getJson("/front/v1/ranking", { keys: "subsRead1Y", limit: 100 }).catch(() => null),
      this._fetchHomeRaw(lang),
    ]);

    const seriesMap = home.seriesMap || {};
    const rankingList = rankingJson?.data?.rankingsMap?.subsRead1Y || [];
    const rankingSeriesMap = rankingJson?.data?.seriesMap || {};

    const seen = new Set();
    const combined = [];

    for (let i = 0; i < rankingList.length; i++) {
      const r = rankingList[i];
      const id = Number(r.id);
      const s = rankingSeriesMap[String(id)] || seriesMap[String(id)];
      if (s && !seen.has(id)) {
        seen.add(id);
        combined.push(normalizeSeriesSummary(s, lang, { rank: i + 1, popularity: r.cnt }));
      }
    }

    const sortedHome = [...(home.items || [])].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const pageCandidates =
      genreFilter || options.completed !== undefined ? sortedHome : sortedHome.slice(0, offset + limit);
    await this._hydrateSeriesMap(
      pageCandidates.map((it) => Number(it.seriesId)).filter((id) => !seen.has(id)),
      seriesMap
    );

    for (const item of sortedHome) {
      const id = Number(item.seriesId);
      if (seen.has(id)) continue;
      const s = seriesMap[String(id)];
      if (!s) continue;
      seen.add(id);
      combined.push(normalizeSeriesSummary(s, lang, item));
    }

    let filtered = combined;
    if (genreFilter) {
      filtered = filtered.filter((s) =>
        s.tags?.some((t) => t.slug === genreFilter || t.name.toLowerCase().includes(genreFilter))
      );
    }
    if (options.completed !== undefined) {
      filtered = filtered.filter((s) => s.isCompleted === options.completed);
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      results: filtered.slice(offset, offset + limit),
    };
  }

  async trending(options = {}) {
    const mode = String(options.mode || "search").toLowerCase();
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;
    const lang = options.lang || this.lang;

    if (mode === "search") {
      const json = await this._getJson("/manta/v1/search/series/trending");
      let results = (json?.data || []).map((s, idx) => normalizeSeriesSummary(s, lang, { rank: idx + 1 }));
      if (options.completed !== undefined) {
        results = results.filter((s) => s.isCompleted === options.completed);
      }
      const total = results.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      return {
        mode: "search-trending",
        pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
        results: results.slice(offset, offset + limit),
      };
    }

    const home = await this._fetchHomeRaw(lang);
    const seriesMap = home.seriesMap || {};
    const items = [...(home.items || [])].sort((a, b) =>
      mode === "view" || mode === "binged"
        ? (a.rank || 9999) - (b.rank || 9999)
        : (b.popularity || 0) - (a.popularity || 0)
    );

    const candidates = options.completed !== undefined ? items : items.slice(0, offset + limit);
    await this._hydrateSeriesMap(
      candidates.map((it) => Number(it.seriesId)),
      seriesMap
    );

    let results = items
      .map((item, idx) => {
        const s = seriesMap[String(item.seriesId)];
        return s ? normalizeSeriesSummary(s, lang, { ...item, rank: item.rank ?? idx + 1 }) : null;
      })
      .filter(Boolean);

    if (options.completed !== undefined) {
      results = results.filter((s) => s.isCompleted === options.completed);
    }

    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      mode,
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      results: results.slice(offset, offset + limit),
    };
  }

  async search(options = {}) {
    const lang = options.lang || this.lang;
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const params = {};
    if (options.q) params.q = String(options.q).trim();
    if (options.cat) params.cat = String(options.cat).trim();
    if (options.tagId) params.tagId = options.tagId;
    if (options.scope) params.scope = String(options.scope).trim();

    if (!params.q && !params.cat && !params.tagId) {
      throw new Error("Minimal satu parameter ('q', 'cat', atau 'tagId') harus diisi.");
    }

    const json = await this._getJson("/manta/v1/search/series", params);
    const normalized = (json?.data || []).map((s) => normalizeSeriesSummary(s, lang));
    const total = normalized.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    return {
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      results: normalized.slice(offset, offset + limit),
    };
  }

  async genres(lang = this.lang) {
    const now = Date.now();
    let rawCats;
    if (categoriesCache && categoriesCache.expiresAt > now) {
      rawCats = categoriesCache.data;
    } else {
      const json = await this._getJson("/manta/v1/search/categories");
      rawCats = json?.data || [];
      categoriesCache = { data: rawCats, expiresAt: now + CATEGORIES_CACHE_TTL_MS };
    }
    return rawCats.map((c) => ({
      id: c.id,
      name: pickLang(c.name, lang),
      slug: slugify(pickLang(c.name, "en")),
      type: c.type || "Genre",
    }));
  }

  async byGenre(options = {}) {
    const lang = options.lang || this.lang;
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const genreSlug = slugify(options.genre || "");
    const tagId = options.tagId ? Number(options.tagId) : null;

    const home = await this._fetchHomeRaw(lang);
    const seriesMap = home.seriesMap || {};
    let results = (home.items || [])
      .map((item) => {
        const s = seriesMap[String(item.seriesId)];
        return s ? normalizeSeriesSummary(s, lang, item) : null;
      })
      .filter(Boolean);

    if (tagId) {
      results = results.filter((s) => s.tags.some((t) => t.id === tagId));
    } else if (genreSlug && genreSlug !== "all") {
      results = results.filter((s) =>
        s.tags.some((t) => t.slug === genreSlug || t.name.toLowerCase().includes(genreSlug))
      );
    }

    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    return {
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      results: results.slice(offset, offset + limit),
    };
  }

  async daily(options = {}) {
    const lang = options.lang || this.lang;
    const dayFilter = String(options.day || "all").trim().toLowerCase();
    const json = await this._getJson("/front/v1/cms/newAndNow/202606");
    const schedule = json?.data?.schedule || [];

    const normalized = schedule.map((entry) => ({
      isoDate: entry.isoDate,
      date: entry.display?.date || entry.isoDate,
      dayOfWeek: entry.display?.dayOfWeek || "",
      daysFromToday: entry.display?.daysFromToday || "",
      total: (entry.series || []).length,
      series: (entry.series || []).map((s) => normalizeSeriesSummary(s, lang)),
    }));

    if (dayFilter === "all") return normalized;
    if (dayFilter === "today" || dayFilter === "d-0" || dayFilter === "d0") {
      return normalized.filter((d) => d.daysFromToday === "D-0" || d.daysFromToday === "Today");
    }
    return normalized.filter(
      (d) =>
        d.dayOfWeek.toLowerCase() === dayFilter ||
        d.isoDate === dayFilter ||
        d.daysFromToday.toLowerCase() === dayFilter
    );
  }

  async completed(options = {}) {
    return this.popular({ ...options, completed: true });
  }

  async newReleases(options = {}) {
    const lang = options.lang || this.lang;
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    const offset = (page - 1) * limit;
    const home = await this._fetchHomeRaw(lang);
    const seriesMap = home.seriesMap || {};

    const sorted = [...(home.items || [])].sort((a, b) => {
      const ta = new Date(a.openAt || a.updatedAt || 0).getTime();
      const tb = new Date(b.openAt || b.updatedAt || 0).getTime();
      return tb - ta;
    });

    const pageItems = sorted.slice(offset, offset + limit);
    await this._hydrateSeriesMap(
      pageItems.map((it) => Number(it.seriesId)),
      seriesMap
    );

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      results: pageItems
        .map((item) => {
          const s = seriesMap[String(item.seriesId)];
          return s ? normalizeSeriesSummary(s, lang, item) : null;
        })
        .filter(Boolean),
    };
  }

  async detail(idOrSlug, options = {}) {
    const lang = options.lang || this.lang;
    const seriesId = await this.resolveSeriesId(idOrSlug);
    const json = await this._getJson(`/front/v1/series/${seriesId}`);
    const s = json?.data;
    if (!s) throw new Error(`Detail komik dengan ID ${seriesId} tidak ditemukan.`);

    const d = s.data || {};
    const episodesRaw = s.episodes || [];
    const base = normalizeSeriesSummary(s, lang);

    const result = {
      ...base,
      type: s.type || null,
      state: s.state || null,
      lang: s.lang || lang,
      scoreData: s.scoreData || null,
      scheduleSubText: d.scheduleSubText || "",
      billboardSubText: d.billboardSubText || "",
      searchKeywords: Array.isArray(d.searchKeywords) ? d.searchKeywords : [],
      freePassBeginAt: d.freePassBeginAt || null,
      freePassLockPercentage: d.freePassLockPercentage ?? null,
      notices: (Array.isArray(d.noticeList) ? d.noticeList : []).map((n) => ({
        title: pickLang(n.title, lang),
        description: pickLang(n.description, lang),
      })),
      relatedSeries: (Array.isArray(d.relatedSeriesList) ? d.relatedSeriesList : []).map((r) => ({
        id: r.id,
        title: pickLang(r.data?.title, lang),
        cover: extractCover(r.image),
      })),
      totalEpisodes: episodesRaw.length,
      firstEpisode: episodesRaw.length ? normalizeEpisode(episodesRaw[0], lang) : null,
      latestEpisode: episodesRaw.length ? normalizeEpisode(episodesRaw[episodesRaw.length - 1], lang) : null,
    };

    if (options.includeEpisodes) {
      result.episodes = episodesRaw.map((ep) => normalizeEpisode(ep, lang));
    }
    return result;
  }

  async chapters(idOrSlug, options = {}) {
    const lang = options.lang || this.lang;
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
    const order = options.order === "desc" ? "desc" : "asc";

    const seriesId = await this.resolveSeriesId(idOrSlug);
    const json = await this._getJson(`/front/v1/series/${seriesId}`);
    const s = json?.data;
    if (!s) throw new Error(`Komik dengan ID ${seriesId} tidak ditemukan.`);

    const episodesRaw = [...(s.episodes || [])];
    if (order === "desc") episodesRaw.reverse();

    const total = episodesRaw.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;

    return {
      series: {
        id: s.id,
        title: pickLang(s.data?.title, lang),
        slug: slugify(pickLang(s.data?.title, lang)),
        cover: extractCover(s.image),
      },
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      chapters: episodesRaw.slice(offset, offset + limit).map((ep) => normalizeEpisode(ep, lang)),
    };
  }

  async read(episodeIdOrSeries, chapterOrd, lang = this.lang) {
    let targetEpisodeId = null;
    let seriesEpisodes = [];

    if (chapterOrd !== undefined && String(chapterOrd).trim() !== "") {
      const seriesId = await this.resolveSeriesId(episodeIdOrSeries);
      const sJson = await this._getJson(`/front/v1/series/${seriesId}`);
      const sData = sJson?.data;
      if (!sData) throw new Error(`Komik '${episodeIdOrSeries}' tidak ditemukan.`);
      seriesEpisodes = sData.episodes || [];
      const ordStr = String(chapterOrd).trim();
      const ordNum = parseInt(ordStr.replace(/[^0-9]/g, ""), 10);
      const matched =
        seriesEpisodes.find((ep) => String(ep.id) === ordStr) ||
        seriesEpisodes.find((ep) => ep.ord === ordNum) ||
        seriesEpisodes.find((ep) => slugify(pickLang(ep.data?.title, lang)) === slugify(ordStr));
      if (!matched) throw new Error(`Chapter '${chapterOrd}' pada komik ID ${seriesId} tidak ditemukan.`);
      targetEpisodeId = Number(matched.id);
    } else {
      const raw = String(episodeIdOrSeries || "").trim();
      if (/^\d+$/.test(raw)) {
        targetEpisodeId = parseInt(raw, 10);
      } else {
        try {
          const u = new URL(raw);
          const epParam = u.searchParams.get("episodeId");
          if (epParam && /^\d+$/.test(epParam)) targetEpisodeId = parseInt(epParam, 10);
        } catch {
          // ignore
        }
      }
    }

    if (!targetEpisodeId) throw new Error("Parameter 'episodeId' (atau 'id' + 'chapter') wajib diisi.");

    const json = await this._getJson(`/front/v1/episodes/${targetEpisodeId}`);
    const ep = json?.data;
    if (!ep) throw new Error(`Episode ID ${targetEpisodeId} tidak ditemukan.`);

    if (!seriesEpisodes.length && ep.seriesId) {
      try {
        const sJson = await this._getJson(`/front/v1/series/${ep.seriesId}`);
        seriesEpisodes = sJson?.data?.episodes || [];
      } catch {
        // ignore
      }
    }

    const idx = seriesEpisodes.findIndex((e) => Number(e.id) === Number(ep.id));
    const prevEp = idx > 0 ? normalizeEpisode(seriesEpisodes[idx - 1], lang) : null;
    const nextEp = idx >= 0 && idx < seriesEpisodes.length - 1 ? normalizeEpisode(seriesEpisodes[idx + 1], lang) : null;

    const images = (ep.cutImages || []).map((img, i) => ({
      index: i + 1,
      id: img.id,
      url: img.downloadUrl,
      width: img.data?.width ?? null,
      height: img.data?.height ?? null,
      size: img.data?.size ?? null,
    }));

    return {
      episodeId: ep.id,
      ord: ep.ord,
      title: pickLang(ep.data?.title, lang) || `Episode ${ep.ord}`,
      seriesId: ep.seriesId,
      seriesTitle: pickLang(ep.series?.data?.title, lang),
      openAt: ep.openAt || null,
      isPreview: Boolean(ep.isPreview),
      isLocked: images.length === 0,
      lockData: ep.lockData || null,
      cutImagesExpiresAt: ep.cutImagesExpiresAt || null,
      navigation: {
        prev: prevEp ? { id: prevEp.id, ord: prevEp.ord, title: prevEp.title } : null,
        next: nextEp ? { id: nextEp.id, ord: nextEp.ord, title: nextEp.title } : null,
      },
      images,
    };
  }
}

function parseBool(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return undefined;
}

async function dispatch(q) {
  const action = String(q.action || "popular").toLowerCase().trim();
  const lang = q.lang || "en";
  const m = new Manta({ lang, timeout: Number(q.timeout) || 15000 });
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;

  switch (action) {
    case "home":
      return m.home(lang);
    case "popular":
      return m.popular({ page, limit, genre: q.genre, lang, completed: parseBool(q.completed) });
    case "trending":
      return m.trending({ mode: q.mode || "search", page, limit, lang, completed: parseBool(q.completed) });
    case "search":
      return m.search({ q: q.q, cat: q.cat, tagId: q.tagId, scope: q.scope, page, limit, lang });
    case "genres":
      return m.genres(lang);
    case "bygenre":
    case "genre":
      return m.byGenre({ genre: q.genre, tagId: q.tagId, page, limit, lang });
    case "daily":
      return m.daily({ day: q.day || "all", lang });
    case "completed":
      return m.completed({ page, limit, genre: q.genre, lang });
    case "new":
    case "newreleases":
      return m.newReleases({ page, limit, lang });
    case "detail":
      if (!q.id && !q.slug && !q.url) throw new Error("Parameter 'id' (atau slug/url) wajib untuk action=detail.");
      return m.detail(q.id || q.slug || q.url, { lang, includeEpisodes: parseBool(q.includeEpisodes) });
    case "chapters":
      if (!q.id && !q.slug && !q.url) throw new Error("Parameter 'id' (atau slug/url) wajib untuk action=chapters.");
      return m.chapters(q.id || q.slug || q.url, { page, limit: q.limit ?? 100, order: q.order || "asc", lang });
    case "read":
      if (q.episodeId) return m.read(q.episodeId, undefined, lang);
      if ((q.id || q.slug || q.url) && (q.chapter || q.ord)) return m.read(q.id || q.slug || q.url, q.chapter || q.ord, lang);
      throw new Error("Parameter 'episodeId' atau ('id'+'chapter') wajib untuk action=read.");
    default:
      throw new Error(`Action tidak dikenal: ${action}`);
  }
}

export { Manta, dispatch };

export default {
  name: "Manta",
  description: "Scraper Manta.net (manga): home, popular, trending, search, genres, byGenre, daily, completed, new releases, detail, chapters, read.",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "q", "id", "slug", "url", "episodeId", "chapter", "page", "limit", "genre", "tagId", "cat", "mode", "day", "lang", "order", "includeEpisodes", "completed", "scope"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      description: "Aksi: home, popular, trending, search, genres, byGenre, daily, completed, new, detail, chapters, read",
      example: "popular",
      enum: ["home", "popular", "trending", "search", "genres", "byGenre", "genre", "daily", "completed", "new", "newReleases", "detail", "chapters", "read"],
    },
    q: { type: "string", required: false, description: "Query pencarian (action=search)", example: "under the oak tree" },
    id: { type: "string", required: false, description: "Series ID/slug/URL (detail/chapters/read)", example: "1255" },
    slug: { type: "string", required: false, description: "Slug series (alternatif id)", example: "under-the-oak-tree" },
    url: { type: "string", required: false, description: "URL series Manta (alternatif id)", example: "https://manta.net/en/series/under-the-oak-tree?seriesId=1255" },
    episodeId: { type: "string", required: false, description: "Episode ID (action=read)", example: "4782" },
    chapter: { type: "string", required: false, description: "Nomor/ord chapter (action=read dengan id)", example: "1" },
    page: { type: "integer", required: false, description: "Halaman (default 1)", example: 1 },
    limit: { type: "integer", required: false, description: "Jumlah item per halaman (default 20)", example: 20 },
    genre: { type: "string", required: false, description: "Filter genre/slug (popular/byGenre)", example: "romance" },
    tagId: { type: "integer", required: false, description: "Tag/genre ID (search/byGenre)", example: 1 },
    mode: { type: "string", required: false, description: "Mode trending: search|ppe|view", example: "search" },
    day: { type: "string", required: false, description: "Hari untuk daily: all|today|mon..sun|YYYY-MM-DD", example: "all" },
    lang: { type: "string", required: false, description: "Bahasa konten (default en)", example: "en" },
    order: { type: "string", required: false, description: "Urutan chapters: asc|desc", example: "asc" },
    includeEpisodes: { type: "boolean", required: false, description: "Sertakan daftar episode di detail", example: false },
  },

  async run(req, res) {
    const start = Date.now();
    const q = { ...(req.body || {}), ...(req.query || {}) };
    try {
      const result = await dispatch(q);
      return res.json({
        status: true,
        result,
        metadata: { processing_time: `${Date.now() - start}ms` },
        attribution: "@zyvorapi",
      });
    } catch (err) {
      const msg = err?.message || "Gagal mengambil data";
      const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      return res.status(status === 403 ? 502 : status).json({
        status: false,
        message: msg,
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  },
};

// CLI: node api/anime/manta.js <action> [args...]
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  (async () => {
    const [, , cmd = "popular", ...args] = process.argv;
    try {
      let q = { action: cmd };
      switch (cmd) {
        case "home": q.lang = args[0] || "en"; break;
        case "popular": q = { action: "popular", page: args[0] || 1, limit: args[1] || 10 }; break;
        case "trending": q = { action: "trending", mode: args[0] || "search", page: args[1] || 1, limit: args[2] || 10 }; break;
        case "search": q = { action: "search", q: args.join(" ") || "oak" }; break;
        case "genres": q = { action: "genres", lang: args[0] || "en" }; break;
        case "bygenre": case "genre": q = { action: "byGenre", genre: args[0] || "romance", page: args[1] || 1, limit: args[2] || 20 }; break;
        case "daily": q = { action: "daily", day: args[0] || "all" }; break;
        case "completed": q = { action: "completed", page: args[0] || 1, limit: args[1] || 10 }; break;
        case "new": q = { action: "new", page: args[0] || 1, limit: args[1] || 10 }; break;
        case "detail": q = { action: "detail", id: args[0] || "1255", includeEpisodes: args[1] === "episodes" }; break;
        case "chapters": q = { action: "chapters", id: args[0] || "1255", page: args[1] || 1, limit: args[2] || 20 }; break;
        case "read": q = args[1] ? { action: "read", id: args[0], chapter: args[1] } : { action: "read", episodeId: args[0] || "4782" }; break;
        default: throw new Error(`Command tidak dikenal: ${cmd}`);
      }
      const out = await dispatch(q);
      console.log(JSON.stringify(out, null, 2));
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
  })();
}
