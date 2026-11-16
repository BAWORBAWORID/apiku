/* Animeindo
   by: FruatreMaou
   tags: Anime
*/

/**
 * animeindo.cjs - Complete AnimeIndo (animeindo.cloud) Scraper & API Client
 * CommonJS Module - ZERO External Dependencies (Pure Node.js built-ins)
 * 
 * Lengkap Seluruh Halaman:
 *  1.  home()                          - Halaman Beranda (Hero, Ongoing, Recent Episodes, Completed, Schedule, Genres)
 *  2.  ongoing(page)                   - Halaman Ongoing Anime Lengkap + Paginasi (/anime-indo/ongoing/:page)
 *  3.  completed(page)                 - Halaman Completed Anime Lengkap + Paginasi (/anime-indo/completed/:page)
 *  4.  daftarAnime() / animeList()     - Direktori Indeks A-Z Seluruh Anime (/anime-indo/daftar-anime)
 *  5.  schedule() / jadwal()           - Jadwal Rilis Mingguan (/anime-indo/jadwal)
 *  6.  detail(slugOrUrl)               - Halaman Detail Anime Lengkap (/anime-indo/:slug)
 *  7.  episode(epSlug, animeSlug)      - Halaman Nonton / Watch Episode (/nonton/:slug)
 *                                        * Primary Iframe Embed URL & Tag HTML
 *                                        * Server Player List (Embed, External, Edge)
 *                                        * Direct Video MP4 extraction (odcdn / googlevideo)
 *                                        * Download Mirrors (360p, 480p, 720p, 1080p, MP4, MKV)
 *  8.  search(query)                   - Pencarian Global (/api/search/global)
 *  9.  trending()                      - Daftar Keyword & Anime Trending
 *  10. genres()                        - Daftar Seluruh Genre Anime
 *  11. byGenre(genreSlug)              - Halaman Anime Berdasarkan Genre (/anime-indo/genre/:slug)
 *  12. season(season, year)            - Halaman Anime Musiman (/season/:season/:year)
 *  13. seasonMonth(month, year)        - Halaman Anime Rilis Bulanan (/anime-terbaru-:month-:year)
 *  14. donghua(page)                   - Halaman Ongoing Donghua (/ongoing-donghua)
 *  15. donghuaDetail(slug)             - Halaman Detail / Watch Donghua (/ongoing-donghua/:slug)
 *  16. movies(page)                    - Halaman Movie Sub Indo (/movie-sub-indo)
 *  17. movieDetail(slug)               - Halaman Detail / Watch Movie (/movie-sub-indo/:slug)
 *  18. manga()                         - Halaman Beranda Manga Sub Indo (/manga-indo)
 *  19. mangaList()                     - Halaman Daftar Lengkap Manga (/manga-indo/list)
 *  20. mangaDetail(idOrSlug)           - Halaman Detail Manga (/manga-indo/:id)
 *  21. mangaChapter(chapterId)         - Halaman Baca Chapter Manga (/manga-indo/read/:ch)
 *  22. wallpapers(page)                - Halaman Wallpaper Anime (/wallpaper)
 *  23. wallpaperDetail(id)             - Halaman Detail Wallpaper (/wallpaper/detail/:id)
 *  24. articles()                      - Halaman Berita & Artikel Anime (/articles)
 *  25. articleDetail(slug)             - Halaman Detail Artikel Anime (/articles/:slug)
 *  26. resolveMirror(url)              - Helper Resolver link.desustream.com -> destination file host
 */

import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { URL } from 'node:url';

const BASE_URL = 'https://animeindo.cloud';
const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * Native HTTP/HTTPS request with gzip/deflate/br decompression & redirect handling
 */
function request(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
    const parsed = new URL(fullUrl);
    const client = parsed.protocol === 'http:' ? http : https;

    const headers = {
      'User-Agent': options.userAgent || DEFAULT_UA,
      'Accept': options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': options.referer || BASE_URL,
      ...(options.headers || {})
    };

    const req = client.request(parsed, {
      method: options.method || 'GET',
      headers,
      agent: false,
      timeout: options.timeout || 35000,
    }, (res) => {
      // Auto follow redirects (kecuali jika redirect: false)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && options.redirect !== false) {
        const nextUrl = new URL(res.headers.location, fullUrl).toString();
        const redirectCount = (options._redirectCount || 0) + 1;
        if (redirectCount > 8) return reject(new Error('Terlalu banyak redirect'));
        return resolve(request(nextUrl, { ...options, _redirectCount: redirectCount }));
      }

      let stream = res;
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'br') {
        stream = res.pipe(zlib.createBrotliDecompress());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        const bodyStr = bodyBuffer.toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: bodyStr,
          raw: bodyBuffer,
          url: fullUrl
        });
      });
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout (' + fullUrl + ')'));
    });

    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

/**
 * Unflattens Nuxt 3 devalue JSON array into clean nested JS objects
 */
function unflattenNuxtData(data) {
  if (!Array.isArray(data)) return data;
  const cache = new Map();

  function resolve(val) {
    if (typeof val === 'number') {
      if (val < 0 || val >= data.length) return val;
      if (cache.has(val)) return cache.get(val);

      const rawVal = data[val];
      if (rawVal === null || typeof rawVal !== 'object') {
        return rawVal;
      }

      if (Array.isArray(rawVal)) {
        if (rawVal.length === 2 && typeof rawVal[0] === 'string' && ['ShallowReactive', 'Reactive', 'Ref'].includes(rawVal[0])) {
          return resolve(rawVal[1]);
        }
        if (rawVal.length === 2 && rawVal[0] === 'Set' && Array.isArray(rawVal[1])) {
          return new Set(rawVal[1].map(resolve));
        }
        const res = [];
        cache.set(val, res);
        for (const item of rawVal) {
          res.push(resolve(item));
        }
        return res;
      } else {
        const res = {};
        cache.set(val, res);
        for (const [k, v] of Object.entries(rawVal)) {
          res[k] = resolve(v);
        }
        return res;
      }
    }
    return val;
  }

  return resolve(0);
}

/**
 * Extract Nuxt 3 hydration data from HTML response
 */
function extractNuxtData(html) {
  const match = html.match(/<script type=["']application\/json["'][^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]);
    return unflattenNuxtData(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Normalizes image url (handles /img?u=... and /manga-indo/img/... proxy wrappers)
 */
function formatImageUrl(thumb) {
  if (!thumb) return '';
  if (thumb.includes('?u=')) {
    try {
      const u = new URL(thumb.startsWith('http') ? thumb : 'https://dummy.com' + thumb);
      const raw = u.searchParams.get('u');
      if (raw) return decodeURIComponent(raw);
    } catch (_) {}
  }
  if (thumb.startsWith('//')) return 'https:' + thumb;
  if (thumb.startsWith('/')) return BASE_URL + thumb;
  return thumb;
}

class AnimeIndo {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || BASE_URL;
    this.userAgent = options.userAgent || DEFAULT_UA;
    this.timeout = options.timeout || 35000;
  }

  async _fetch(url, opts = {}) {
    return request(url, {
      userAgent: this.userAgent,
      timeout: this.timeout,
      ...opts,
    });
  }

  async _getNuxtPage(path, referer = BASE_URL) {
    const res = await this._fetch(path, {
      referer,
      headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
    });

    if (res.statusCode >= 400) {
      throw new Error(`Gagal memuat halaman ${path} (HTTP ${res.statusCode})`);
    }

    const nuxt = extractNuxtData(res.data);
    if (!nuxt || !nuxt.data) {
      throw new Error(`Gagal mengekstrak data Nuxt dari halaman ${path}`);
    }

    return nuxt.data;
  }

  /**
   * 1. Halaman Beranda (Home)
   */
  async home() {
    const pageData = await this._getNuxtPage('/');
    const homeRoot = pageData['page-home-root']?.data || {};

    const ongoing = (homeRoot.ongoing || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      watch_url: `${this.baseUrl}/nonton/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode,
      day: item.day || '',
      date: item.date || item.date_rel || '',
      view_count: item.view_count || 0,
      is_adult: Boolean(item.is_adult)
    }));

    const recent_episodes = (homeRoot.recent_episodes || []).map(item => ({
      title: item.title,
      ep_title: item.ep_title || '',
      anime_slug: item.anime_slug,
      ep_slug: item.ep_slug,
      ep_number: item.ep_number,
      url: `${this.baseUrl}/nonton/${item.anime_slug}/${item.ep_slug}`,
      anime_url: `${this.baseUrl}/anime-indo/${item.anime_slug}`,
      thumb: formatImageUrl(item.thumb),
      day: item.day || '',
      date: item.date || '',
      date_rel: item.date_rel || '',
      view_count: item.view_count || 0,
      is_adult: Boolean(item.is_adult)
    }));

    const completed = (homeRoot.completed || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode || '',
      score: item.score || '',
      is_adult: Boolean(item.is_adult)
    }));

    const hero_items = (homeRoot.hero_items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      watch_url: `${this.baseUrl}/nonton/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode,
      date: item.date,
      description: item.description,
      status: item.status,
      is_adult: Boolean(item.is_adult)
    }));

    const genres = (homeRoot.genre_list || homeRoot.genres || []).map(g => ({
      name: typeof g === 'string' ? g : g.name || g.genre,
      slug: typeof g === 'string' ? g.toLowerCase().replace(/\s+/g, '-') : g.slug,
      url: `${this.baseUrl}/anime-indo/genre/${typeof g === 'string' ? g.toLowerCase().replace(/\s+/g, '-') : g.slug}`
    }));

    return {
      success: true,
      hero_items,
      recent_episodes,
      ongoing,
      completed,
      schedule: homeRoot.schedule || {},
      genres,
      anime_list_index: homeRoot.anime_list || {}
    };
  }

  /**
   * 2. Halaman Ongoing Anime Lengkap (dengan Paginasi)
   * @param {number|string} [page=1]
   */
  async ongoing(page = 1) {
    const path = page > 1 ? `/anime-indo/ongoing/${page}` : '/anime-indo/ongoing/1';
    const pageData = await this._getNuxtPage(path);
    const key = Object.keys(pageData).find(k => k.startsWith('indo-ongoing-') || k.startsWith('ongoing-'));
    const d = (key && pageData[key]?.data) || {};

    const items = (d.items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      watch_url: `${this.baseUrl}/nonton/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode || '',
      day: item.day || '',
      date: item.date || item.date_rel || '',
      view_count: item.view_count || 0,
      is_adult: Boolean(item.is_adult)
    }));

    return {
      success: true,
      current_page: Number(page),
      total: items.length,
      page_info: d.page_info || null,
      items
    };
  }

  /**
   * 3. Halaman Completed Anime Lengkap (dengan Paginasi)
   * @param {number|string} [page=1]
   */
  async completed(page = 1) {
    const path = page > 1 ? `/anime-indo/completed/${page}` : '/anime-indo/completed/1';
    const pageData = await this._getNuxtPage(path);
    const key = Object.keys(pageData).find(k => k.startsWith('indo-completed-') || k.startsWith('completed-'));
    const d = (key && pageData[key]?.data) || {};

    const items = (d.items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode || '',
      score: item.score || item.day || '',
      date: item.date || item.date_rel || '',
      genres: item.genre || [],
      view_count: item.view_count || 0,
      is_adult: Boolean(item.is_adult)
    }));

    return {
      success: true,
      current_page: Number(page),
      total: items.length,
      page_info: d.page_info || null,
      items
    };
  }

  /**
   * 4. Halaman Direktori Seluruh Anime A-Z (/anime-indo/daftar-anime)
   */
  async daftarAnime() {
    const pageData = await this._getNuxtPage('/anime-indo/daftar-anime');
    const d = Object.values(pageData)[0]?.data || {};

    const animeList = (d.anime_list || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      watch_url: `${this.baseUrl}/nonton/${item.slug}`,
      status: item.status || '',
      is_adult: Boolean(item.is_adult)
    }));

    return {
      success: true,
      total: animeList.length,
      grouped: d.anime_list_grouped || {},
      items: animeList
    };
  }

  /**
   * Alias daftarAnime()
   */
  async animeList() {
    return this.daftarAnime();
  }

  /**
   * 5. Halaman Jadwal Rilis Lengkap (/anime-indo/jadwal)
   */
  async schedule() {
    const pageData = await this._getNuxtPage('/anime-indo/jadwal');
    const key = Object.keys(pageData).find(k => k.startsWith('jadwal') || k.startsWith('indo-jadwal'));
    const d = (key && pageData[key]?.data) || {};
    return {
      success: true,
      schedule: d.schedule || (await this.home()).schedule
    };
  }

  async jadwal() {
    return this.schedule();
  }

  /**
   * 6. Halaman Detail Anime (/anime-indo/:slug)
   */
  async detail(slugOrUrl) {
    const slug = slugOrUrl.replace(/^https?:\/\/[^/]+\/(anime-indo\/|nonton\/)?/, '').replace(/\/+$/, '');
    // Fix: pakai API JSON langsung (halaman HTML hanya SSR ringkas, data di-fetch client-side)
    const res = await this._fetch(`/api/anime-indo/detail/${slug}`, {
      headers: { 'Accept': 'application/json, text/plain, */*' }
    });
    if (res.statusCode >= 400) throw new Error(`Anime '${slug}' tidak ditemukan (HTTP ${res.statusCode})`);
    let json;
    try { json = JSON.parse(res.data); } catch (err) { throw new Error('Respons detail bukan JSON valid'); }
    const d = json.data || {};
    const anime = d.anime || {};

    const episodes = (d.episodes || []).map(ep => ({
      number: ep.number,
      title: ep.title,
      slug: ep.slug,
      url: `${this.baseUrl}/nonton/${slug}/${ep.slug}`
    }));

    return {
      success: true,
      title: anime.title || anime.name || '',
      japanese_title: anime.japanese_title || anime.jname || anime.japanese || '',
      synonyms: anime.synonyms || [],
      slug,
      url: `${this.baseUrl}/anime-indo/${slug}`,
      watch_url: `${this.baseUrl}/nonton/${slug}`,
      poster: formatImageUrl(anime.poster || anime.image || anime.thumb),
      banner: formatImageUrl(anime.banner),
      synopsis: anime.synopsis || anime.description || '',
      genres: anime.genres || anime.genre || [],
      status: anime.status || '',
      score: anime.score || anime.rating || '',
      type: anime.anime_type || anime.format || anime.stats?.type || 'TV',
      duration: anime.duration ? `${anime.duration} Min` : '',
      total_episodes: anime.total_episodes || anime.totalEpisodes || anime.episodes || null,
      released_episodes: anime.released_episodes || episodes.length,
      season: anime.premiered || (anime.season ? `${anime.season} ${anime.season_year || anime.seasonYear || ''}`.trim() : ''),
      studio: anime.studio || (anime.studios && anime.studios[0]?.name) || '',
      producer: anime.producer || '',
      aired_start: anime.aired_start || '',
      aired_end: anime.aired_end || '',
      anilist_id: anime.anilistId || anime.anilist_id || null,
      mal_id: anime.malId || null,
      first_episode: (anime.first_episode_slug || d.first_episode) ? {
        number: episodes.length ? episodes[episodes.length - 1].number : '',
        title: '',
        slug: anime.first_episode_slug || d.first_episode?.slug || '',
        url: `${this.baseUrl}/nonton/${slug}/${anime.first_episode_slug || d.first_episode?.slug || ''}`
      } : null,
      next_episode_schedule: anime.next_episode_schedule || d.next_episode_schedule || null,
      related_animes: (anime.relatedAnimes || []).map(r => ({
        id: r.id,
        title: r.title || r.name,
        poster: formatImageUrl(r.poster || r.image),
        format: r.format,
        relation: r.relation
      })),
      recommended_animes: (anime.recommendedAnimes || []).map(r => ({
        id: r.id,
        title: r.title || r.name,
        poster: formatImageUrl(r.poster || r.image),
        format: r.format,
        score: r.averageScore,
        episodes: r.episodes
      })),
      episodes
    };
  }

  /**
   * 7. Halaman Watch / Episode Streaming, Iframes & Downloads
   */
  async episode(epSlugOrUrl, animeSlug = '', opts = {}) {
    let cleanEp = epSlugOrUrl.replace(/^https?:\/\/[^/]+\/(nonton\/([^/]+\/)?)?/, '').replace(/\/+$/, '');
    if (cleanEp.includes('/')) {
      const parts = cleanEp.split('/');
      animeSlug = parts[0];
      cleanEp = parts[1];
    }

    const refererUrl = animeSlug ? `${this.baseUrl}/nonton/${animeSlug}` : `${this.baseUrl}/nonton/${cleanEp}`;
    const sourcesUrl = `${this.baseUrl}/api/anime-indo/sources/${cleanEp}`;

    const res = await this._fetch(sourcesUrl, {
      referer: refererUrl,
      headers: { 'Accept': 'application/json, text/plain, */*' }
    });

    if (res.statusCode >= 400) {
      throw new Error(`Gagal mengambil sources untuk episode ${cleanEp} (HTTP ${res.statusCode})`);
    }

    let json;
    try {
      json = JSON.parse(res.data);
    } catch (err) {
      throw new Error('Respons sources bukan JSON valid');
    }

    const sources = json.sources || [];
    const resolutions = json.resolutions || [];

    let primaryIframeUrl = '';
    const embedPlayer = sources.find(s => s.type === 'iframe_embed');
    const externalPlayer = sources.find(s => s.type === 'external_player');
    const edgeResolver = sources.find(s => s.type === 'edge_resolve');

    if (embedPlayer && embedPlayer.url) {
      if (embedPlayer.url.startsWith('http')) {
        primaryIframeUrl = embedPlayer.url;
      } else if (embedPlayer.url.startsWith('/desustream-proxy?url=')) {
        const rawParam = embedPlayer.url.replace('/desustream-proxy?url=', '');
        try {
          primaryIframeUrl = decodeURIComponent(rawParam);
        } catch (_) {
          primaryIframeUrl = externalPlayer ? externalPlayer.url : (this.baseUrl + embedPlayer.url);
        }
      } else {
        primaryIframeUrl = this.baseUrl + embedPlayer.url;
      }
    } else if (externalPlayer && externalPlayer.url) {
      primaryIframeUrl = externalPlayer.url;
    }

    const iframeHtml = primaryIframeUrl 
      ? `<iframe src="${primaryIframeUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`
      : '';

    let directStream = null;
    if (opts.resolveDirect && edgeResolver && edgeResolver.url) {
      try {
        const edgeRes = await this._fetch(edgeResolver.url, { timeout: 10000 });
        if (edgeRes.statusCode === 200) {
          const edgeData = JSON.parse(edgeRes.data);
          if (edgeData.mp4) {
            directStream = { type: 'mp4', url: edgeData.mp4, headers: {} };
          } else if (edgeData.embed && edgeData.embed.includes('blogger.com')) {
            directStream = { type: 'blogger', embed: edgeData.embed, note: 'Requires Referer: https://www.blogger.com/' };
          }
        }
      } catch (_) {}
    }

    const downloadMirrors = resolutions.map(resGroup => ({
      format: resGroup.format,
      resolution: resGroup.resolution,
      label: resGroup.label,
      size: resGroup.size,
      mirrors: (resGroup.mirrors || []).map(m => ({
        label: m.label,
        url: m.url,
        type: m.type
      }))
    }));

    return {
      success: true,
      episode_slug: cleanEp,
      anime_slug: animeSlug || null,
      iframe: {
        url: primaryIframeUrl,
        html: iframeHtml,
        external_url: externalPlayer ? externalPlayer.url : primaryIframeUrl
      },
      servers: sources.map(s => ({
        label: s.label,
        type: s.type,
        url: s.url.startsWith('http') ? s.url : `${this.baseUrl}${s.url}`,
        raw_url: s.url
      })),
      direct_stream: directStream,
      downloads: downloadMirrors
    };
  }

  async watch(epSlugOrUrl, animeSlug = '', opts = {}) {
    return this.episode(epSlugOrUrl, animeSlug, opts);
  }

  /**
   * 8. Halaman Pencarian Global (/search & /api/search/global)
   */
  async search(query) {
    if (!query) throw new Error('Query pencarian tidak boleh kosong');
    const searchUrl = `/api/search/global?q=${encodeURIComponent(query)}`;
    const res = await this._fetch(searchUrl, {
      referer: `${this.baseUrl}/search?q=${encodeURIComponent(query)}`,
      headers: { 'Accept': 'application/json, text/plain, */*' }
    });

    if (res.statusCode >= 400) {
      throw new Error(`Pencarian gagal (HTTP ${res.statusCode})`);
    }

    const json = JSON.parse(res.data);
    const sections = json.sections || [];

    const formatItems = (items) => (items || []).map(item => ({
      title: item.title,
      subtitle: item.subtitle || '',
      cover: formatImageUrl(item.cover),
      badge: item.badge || '',
      meta: item.meta || '',
      rating: item.rating || null,
      url: item.url ? (item.url.startsWith('http') ? item.url : `${this.baseUrl}${item.url}`) : '',
      slug: item.url ? item.url.split('/').filter(Boolean).pop() : '',
      is_adult: Boolean(item.is_adult)
    }));

    const result = {
      success: true,
      query: json.query || query,
      total: json.total || 0,
      took_ms: json.took_ms || 0,
      anime_sub_indo: [],
      anime_sub_en: [],
      movie_sub_indo: [],
      donghua: [],
      manga_sub_indo: [],
      wallpapers: []
    };

    for (const sec of sections) {
      const items = formatItems(sec.items);
      if (sec.key === 'anime_id') result.anime_sub_indo = items;
      else if (sec.key === 'anime_en') result.anime_sub_en = items;
      else if (sec.key === 'movie_indo') result.movie_sub_indo = items;
      else if (sec.key === 'donghua') result.donghua = items;
      else if (sec.key === 'manga_id') result.manga_sub_indo = items;
      else if (sec.key === 'wallpaper') result.wallpapers = items;
    }

    return result;
  }

  /**
   * 9. Trending Searches
   */
  async trending() {
    const res = await this._fetch('/api/search/trending', {
      referer: `${this.baseUrl}/search`,
      headers: { 'Accept': 'application/json, text/plain, */*' }
    });
    if (res.statusCode >= 400) return [];
    try {
      const json = JSON.parse(res.data);
      return json.trending || [];
    } catch (_) {
      return [];
    }
  }

  /**
   * 10. Daftar Semua Genre
   */
  async genres() {
    const h = await this.home();
    return h.genres;
  }

  /**
   * 11. Halaman Anime Berdasarkan Genre (/anime-indo/genre/:slug)
   */
  async byGenre(genreSlug) {
    const cleanGenre = genreSlug.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    const path = `/anime-indo/genre/${cleanGenre}`;
    const pageData = await this._getNuxtPage(path);

    const key = Object.keys(pageData).find(k => k.startsWith('indo-genre-'));
    const d = (key && pageData[key]?.data) || {};

    const items = (d.items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode || '',
      date: item.date || item.date_rel || '',
      view_count: item.view_count || 0,
      is_adult: Boolean(item.is_adult)
    }));

    return {
      success: true,
      genre: d.genre || genreSlug,
      genre_slug: cleanGenre,
      total: items.length,
      items
    };
  }

  /**
   * 12. Halaman Anime Musiman (/season/:season/:year)
   * @param {string} seasonName - 'winter', 'spring', 'summer', 'fall'
   * @param {number|string} year - misal 2024, 2025, 2026
   */
  async season(seasonName = 'fall', year = 2026) {
    const path = `/season/${seasonName.toLowerCase()}/${year}`;
    const pageData = await this._getNuxtPage(path);
    const key = Object.keys(pageData).find(k => k.startsWith('season-'));
    const d = (key && pageData[key]?.data) || {};

    const items = (d.items || d.animes || []).map(item => ({
      title: item.title || item.name,
      slug: item.slug || (item.url ? item.url.split('/').pop() : ''),
      url: item.url ? (item.url.startsWith('http') ? item.url : `${this.baseUrl}${item.url}`) : '',
      poster: formatImageUrl(item.poster || item.image),
      score: item.score || item.averageScore || '',
      genres: item.genres || item.genre || [],
      format: item.format || 'TV'
    }));

    return {
      success: true,
      season: seasonName,
      year: Number(year),
      total: items.length,
      items
    };
  }

  /**
   * 13. Halaman Anime Rilis Bulanan (/anime-terbaru-:month-:year)
   * @param {string} month - 'januari', 'februari', dst
   * @param {number|string} year - 2024, 2025, 2026
   */
  async seasonMonth(month = 'november', year = 2026) {
    const path = `/anime-terbaru-${month.toLowerCase()}-${year}`;
    const pageData = await this._getNuxtPage(path);
    const key = Object.keys(pageData).find(k => k.startsWith('anime-terbaru-'));
    const d = (key && pageData[key]?.data) || {};

    const items = (d.items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/anime-indo/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      episode: item.episode || '',
      day: item.day || '',
      date: item.date || ''
    }));

    return {
      success: true,
      month,
      year: Number(year),
      total: items.length,
      items
    };
  }

  /**
   * 14. Halaman Ongoing Donghua (/ongoing-donghua atau /ongoing-donghua/page/:page)
   * @param {number|string} [page=1]
   */
  async donghua(page = 1) {
    const path = page > 1 ? `/ongoing-donghua/page/${page}` : '/ongoing-donghua';
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};

    const items = (d.items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/ongoing-donghua/${item.slug}`,
      poster: formatImageUrl(item.poster || item.thumb),
      genres: item.genres || [],
      episode_count: item.episode_count || null,
      rating: item.rating || null,
      studio: item.studio || '',
      view_count: item.view_count || 0,
      uploaded_at: item.uploaded_at || '',
      is_adult: Boolean(item.is_adult)
    }));

    return {
      success: true,
      current_page: Number(page),
      total: d.total || items.length,
      pagination: d.pagination || null,
      hero_banner: d.hero_banner || null,
      genre_list: d.genre_list || [],
      items
    };
  }

  /**
   * 15. Halaman Detail & Nonton Donghua (/ongoing-donghua/:slug)
   * Mengambil info lengkap donghua, Iframe player embed, dan HLS m3u8 stream
   * @param {string} slugOrUrl - Slug donghua (contoh: 'da-wang-rao-ming-3')
   */
  async donghuaDetail(slugOrUrl) {
    const slug = slugOrUrl.replace(/^https?:\/\/[^/]+\/(ongoing-donghua\/)?/, '').replace(/\/+$/, '');
    const path = `/ongoing-donghua/${slug}`;
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};
    const item = d.item || {};

    const playerUrl = item.player_url || '';
    const iframeHtml = playerUrl 
      ? `<iframe src="${playerUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`
      : '';

    return {
      success: true,
      slug: item.slug || slug,
      title: item.title || '',
      alternate_title: item.alternate_title || '',
      poster: formatImageUrl(item.poster),
      genres: item.genres || [],
      rating: item.rating || '',
      rating_count: item.rating_count || 0,
      episode_count: item.episode_count || 1,
      status: item.status || 'Ongoing',
      studio: item.studio || '',
      synopsis: item.synopsis || '',
      view_count: item.view_count || 0,
      iframe: {
        url: playerUrl,
        html: iframeHtml
      },
      stream_hls: item.manifest_proxy ? `${this.baseUrl}${item.manifest_proxy}` : '',
      related: (d.related || []).map(r => ({
        title: r.title,
        slug: r.slug,
        poster: formatImageUrl(r.poster),
        genres: r.genres || [],
        rating: r.rating || '',
        url: `${this.baseUrl}/ongoing-donghua/${r.slug}`
      }))
    };
  }

  /**
   * 16. Halaman Movie Sub Indo (/movie-sub-indo atau /movie-sub-indo/page/:page)
   * @param {number|string} [page=1]
   */
  async movies(page = 1) {
    const path = page > 1 ? `/movie-sub-indo/page/${page}` : '/movie-sub-indo';
    const pageData = await this._getNuxtPage(path);
    const key = Object.keys(pageData).find(k => k.startsWith('movie-indo-list') || k.startsWith('movie-list'));
    const d = (key && pageData[key]?.data) || {};

    const items = (d.movies || d.items || []).map(item => ({
      title: item.title,
      slug: item.slug,
      url: `${this.baseUrl}/movie-sub-indo/${item.slug}`,
      thumb: formatImageUrl(item.thumb),
      rating: item.rating || null,
      is_adult: Boolean(item.is_adult)
    }));

    return {
      success: true,
      current_page: Number(page),
      total: d.total || items.length,
      items
    };
  }

  /**
   * 17. Halaman Detail / Watch Movie Sub Indo (/movie-sub-indo/:slug)
   */
  async movieDetail(slugOrUrl) {
    const slug = slugOrUrl.replace(/^https?:\/\/[^/]+\/(movie-sub-indo\/)?/, '').replace(/\/+$/, '');
    const path = `/movie-sub-indo/${slug}`;
    const pageData = await this._getNuxtPage(path);
    const key = Object.keys(pageData).find(k => k.startsWith('movie-'));
    const d = (key && pageData[key]?.data) || {};

    return {
      success: true,
      slug,
      title: d.title || '',
      synopsis: d.synopsis || d.description || '',
      poster: formatImageUrl(d.poster || d.thumb || d.image),
      rating: d.rating || '',
      duration: d.duration || '',
      genres: d.genres || d.genre || [],
      iframe_url: d.iframe_url || d.embed_url || '',
      downloads: d.downloads || d.resolutions || []
    };
  }

  /**
   * 18. Halaman Manga Sub Indo Utama (/manga-indo)
   */
  async manga() {
    const pageData = await this._getNuxtPage('/manga-indo');
    const d = Object.values(pageData)[0]?.data || {};

    const formatManga = (list) => (list || []).map(item => ({
      id: item.uuid || item.manga_id || item.id,
      title: item.title,
      slug: item.uuid || item.manga_id || item.id,
      cover: formatImageUrl(item.cover || item.thumb),
      type: item.type || 'Manga',
      genres: item.genres || [],
      latest_chapter: item.latest_chapter || item.chapter || '',
      description: item.description || '',
      is_adult: Boolean(item.is_adult),
      url: `${this.baseUrl}/manga-indo/${item.uuid || item.manga_id || item.id}`
    }));

    return {
      success: true,
      latest: formatManga(d.latest),
      popular: formatManga(d.popular),
      top_daily: formatManga(d.top_daily),
      genres: d.genres || []
    };
  }

  /**
   * 19. Halaman Pencarian Manga Sub Indo (/manga-indo/search?q=...)
   * @param {string} query - Kata kunci
   * @param {Object} [options] - Filter tambahan (genre_ids, sort, status)
   */
  async mangaSearch(query = '', options = {}) {
    let path = `/manga-indo/search?q=${encodeURIComponent(query)}`;
    if (options.genre_ids) path += `&genre_ids=${encodeURIComponent(options.genre_ids)}`;
    if (options.page) path += `&page=${options.page}`;

    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};

    const items = (d.items || d.results || []).map(item => ({
      id: item.uuid || item.manga_id || item.id,
      title: item.title,
      slug: item.uuid || item.manga_id || item.id,
      cover: formatImageUrl(item.cover || item.thumb),
      type: item.type || '',
      genres: item.genres || [],
      latest_chapter: item.latest_chapter || item.chapter || '',
      rating: item.user_rate || item.rating || null,
      url: `${this.baseUrl}/manga-indo/${item.uuid || item.manga_id || item.id}`
    }));

    return {
      success: true,
      query: d.query || query,
      total_pages: d.total_pages || 1,
      total: items.length,
      genres: d.genres || [],
      items
    };
  }

  /**
   * 20. Halaman Daftar Lengkap Manga (/manga-indo/list)
   */
  async mangaList() {
    const pageData = await this._getNuxtPage('/manga-indo/list');
    const d = Object.values(pageData)[0]?.data || {};

    const items = (d.items || []).map(item => ({
      id: item.id || item.uuid,
      title: item.title,
      cover: formatImageUrl(item.cover),
      status: item.status || '',
      type: item.type || '',
      url: `${this.baseUrl}/manga-indo/${item.id || item.uuid}`
    }));

    return {
      success: true,
      total: items.length,
      items
    };
  }

  /**
   * 21. Halaman Detail Manga & Daftar Seluruh Chapter (/manga-indo/:id)
   * @param {string} idOrSlug - UUID / slug manga (contoh: 'third-rate-martial-family-becomes-the-best-under-heaven')
   */
  async mangaDetail(idOrSlug) {
    const id = idOrSlug.replace(/^https?:\/\/[^/]+\/(manga-indo\/)?/, '').replace(/\/+$/, '');
    const path = `/manga-indo/${id}`;
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};
    const m = d.manga || d;

    const chapters = (d.chapters || []).map(ch => ({
      id: ch.uuid || ch.id,
      chapter: ch.number || ch.chapter || '',
      title: ch.display_title || ch.title || `Chapter ${ch.number || ch.chapter}`,
      date: ch.created_at || ch.date || '',
      read_url: `${this.baseUrl}/manga-indo/read/${ch.uuid || ch.id}`
    }));

    return {
      success: true,
      id,
      title: m.title || '',
      alternative_title: m.alternative_title || m.alt_title || '',
      cover: formatImageUrl(m.cover || m.thumb),
      synopsis: m.description || m.synopsis || '',
      genres: d.genres || m.genres || [],
      authors: d.authors || [],
      artists: d.artists || [],
      status: d.status_label || m.status || '',
      type: d.format_name || m.type || 'Manga',
      view_count: d.view_count || m.view_count || 0,
      total_chapters: chapters.length,
      chapters
    };
  }

  /**
   * 22. Halaman Baca Chapter Manga (/manga-indo/read/:ch)
   * Mengambil seluruh gambar lembar halaman chapter beresolusi penuh
   * @param {string} chapterId - UUID chapter manga
   */
  async mangaChapter(chapterId) {
    const cleanCh = chapterId.replace(/^https?:\/\/[^/]+\/(manga-indo\/read\/)?/, '').replace(/\/+$/, '');
    const path = `/manga-indo/read/${cleanCh}`;
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};
    const ch = d.chapter || {};
    const mg = d.manga || {};

    const rawImages = d.images || d.pages || [];
    const images = rawImages.map(img => formatImageUrl(typeof img === 'string' ? img : (img.url || img.src)));

    const chNum = ch.number || ch.chapter_number || (cleanCh.match(/chapter-(\d+)/) || [])[1] || '';
    const chTitle = ch.title || ch.display_title || (chNum ? `Chapter ${chNum}` : cleanCh);

    return {
      success: true,
      chapter_id: cleanCh,
      chapter_number: chNum,
      chapter_title: chTitle,
      manga_id: mg.uuid || mg.id || (d.manga_id || ''),
      manga_title: mg.title || (d.manga_title || ''),
      prev_chapter_id: d.prev_chapter_id || null,
      next_chapter_id: d.next_chapter_id || null,
      total_pages: images.length,
      pages: images
    };
  }

  /**
   * 22. Halaman Wallpaper Anime (/wallpaper)
   * @param {number|string} [page=1]
   */
  async wallpapers(page = 1) {
    const path = page > 1 ? `/wallpaper?page=${page}` : '/wallpaper';
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};

    const items = (d.wallpapers || d.items || []).map(wp => ({
      id: wp.id,
      title: wp.name || wp.title || '',
      thumbnail: formatImageUrl(wp.thumbnail || wp.thumb || wp.cover),
      full_image_url: wp.full_image_url || wp.full_image_proxy || '',
      resolution: wp.resolution_tier || (wp.width && wp.height ? `${wp.width}x${wp.height}` : wp.resolution) || '',
      width: wp.width,
      height: wp.height,
      tags: wp.tags || [],
      view_count: wp.view_count || 0,
      url: `${this.baseUrl}/wallpaper/detail/${wp.id}`
    }));

    return {
      success: true,
      current_page: Number(page),
      total: items.length,
      wallpaper_of_day: d.wallpaper_of_day || null,
      items
    };
  }

  /**
   * 23. Halaman Detail Wallpaper (/wallpaper/detail/:id)
   * @param {string|number} id - ID wallpaper
   */
  async wallpaperDetail(id) {
    const path = `/wallpaper/detail/${id}`;
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};

    return {
      success: true,
      id,
      title: d.title || '',
      image_url: formatImageUrl(d.image || d.url || d.download_url || d.full_image_url),
      thumbnail: formatImageUrl(d.thumb || d.cover || d.thumbnail),
      resolution: d.resolution || '',
      tags: d.tags || [],
      downloads: d.downloads || []
    };
  }

  /**
   * 24. Halaman Berita & Artikel Anime (/articles)
   */
  async articles() {
    const pageData = await this._getNuxtPage('/articles');
    const d = Object.values(pageData)[0]?.data || {};

    const items = (d.items || d.articles || []).map(art => ({
      title: art.title,
      slug: art.slug,
      excerpt: art.excerpt || art.description || '',
      thumb: formatImageUrl(art.thumb || art.cover || art.image),
      author: art.author || '',
      category: art.category || '',
      date: art.published_at || art.date || '',
      url: `${this.baseUrl}/articles/${art.slug}`
    }));

    return {
      success: true,
      total: items.length,
      items
    };
  }

  /**
   * 25. Halaman Detail Artikel (/articles/:slug)
   * @param {string} slugOrUrl - Slug artikel (misal: 'rekomendasi-anime-isekai-terbaik')
   */
  async articleDetail(slugOrUrl) {
    const slug = slugOrUrl.replace(/^https?:\/\/[^/]+\/(articles\/)?/, '').replace(/\/+$/, '');
    const path = `/articles/${slug}`;
    const pageData = await this._getNuxtPage(path);
    const d = Object.values(pageData)[0]?.data || {};

    return {
      success: true,
      slug,
      title: d.title || '',
      cover: formatImageUrl(d.cover || d.image || d.thumb),
      date: d.date || '',
      author: d.author || '',
      content_html: d.content || d.body || '',
      tags: d.tags || []
    };
  }

  /**
   * 26. Helper: Resolve link.desustream.com ke direct file host link (Filedon, Pdrain, Acefile, Mega, dll)
   * @param {string} mirrorUrl - URL link.desustream.com/?id=...
   */
  async resolveMirror(mirrorUrl) {
    const res = await request(mirrorUrl, { redirect: false });
    return res.headers.location || mirrorUrl;
  }
}

// ══════════════════════════════════════════
// APIKU ENDPOINT WRAPPER
// ══════════════════════════════════════════

const scraper = new AnimeIndo();

const ACTIONS = {
  "home": "Halaman beranda (ongoing, recent, completed, genres, schedule)",
  "ongoing": "Daftar ongoing anime + paginasi (param: page)",
  "completed": "Daftar completed anime + paginasi (param: page)",
  "daftar-anime": "Direktori seluruh anime A-Z",
  "jadwal": "Jadwal rilis mingguan",
  "detail": "Detail anime lengkap (param: slug)",
  "episode": "Watch episode: iframe, servers, download mirrors (param: ep_slug, anime_slug)",
  "search": "Pencarian global / kategori: anime, donghua, manga, wallpaper (param: query)",
  "trending": "Keyword trending",
  "genres": "Daftar semua genre",
  "by-genre": "Anime per genre (param: genre)",
  "season": "Anime musiman (param: season, year)",
  "season-month": "Anime rilis bulanan (param: month, year)",
  "donghua": "Ongoing donghua + paginasi (param: page)",
  "donghua-detail": "Detail donghua + iframe + HLS (param: slug)",
  "movies": "Daftar movie sub indo + paginasi (param: page)",
  "movie-detail": "Detail movie sub indo (param: slug)",
  "manga": "Manga home (latest, popular, top_daily)",
  "manga-search": "Pencarian manga (param: query)",
  "manga-list": "Daftar seluruh manga",
  "manga-detail": "Detail manga + chapter list (param: id)",
  "manga-chapter": "Halaman chapter manga (param: chapter_id)",
  "wallpapers": "Wallpaper anime + paginasi (param: page)",
  "wallpaper-detail": "Detail wallpaper (param: id)",
  "articles": "Berita artikel anime",
  "article-detail": "Detail artikel (param: slug)",
  "resolve-mirror": "Resolve link.desustream.com ke direct file host (param: url)"
};

export default {
  name: "AnimeIndo",
  description: "AnimeIndo (animeindo.cloud) scraper — anime, donghua, movie, manga, wallpaper, article",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Action to perform",
      example: "home",
      enum: Object.keys(ACTIONS)
    },
    page: { type: "number", required: false, description: "Pagination (ongoing/completed/donghua/movies/wallpapers)", example: 1 },
    slug: { type: "string", required: false, description: "Anime/donghua/movie/article slug atau URL", example: "one-piece" },
    ep_slug: { type: "string", required: false, description: "Episode slug (action=episode)", example: "episode-1" },
    anime_slug: { type: "string", required: false, description: "Anime slug (action=episode)", example: "one-piece" },
    query: { type: "string", required: false, description: "Kata kunci pencarian (action=search/manga-search)", example: "naruto" },
    genre: { type: "string", required: false, description: "Genre slug (action=by-genre)", example: "action" },
    season: { type: "string", required: false, description: "Musim (action=season): winter/spring/summer/fall", example: "fall" },
    year: { type: "number", required: false, description: "Tahun (action=season)", example: 2026 },
    month: { type: "string", required: false, description: "Bulan (action=season-month)", example: "november" },
    id: { type: "string", required: false, description: "ID manga/wallpaper", example: "12345" },
    chapter_id: { type: "string", required: false, description: "Chapter UUID (action=manga-chapter)", example: "uuid-chapter" },
    url: { type: "string", required: false, description: "URL mirror (action=resolve-mirror)" }
  },

  async run(req, res) {
    const p = { ...req.query, ...req.body };
    const { action, page = 1, slug, ep_slug, anime_slug, query, genre, season = "fall", year = 2026, month = "november", id, chapter_id, url } = p;

    if (!action) {
      return res.status(400).json({ status: false, message: "Parameter 'action' wajib diisi", available_actions: ACTIONS });
    }

    try {
      let result;
      switch (action) {
        case "home": result = await scraper.home(); break;
        case "ongoing": result = await scraper.ongoing(page); break;
        case "completed": result = await scraper.completed(page); break;
        case "daftar-anime": result = await scraper.daftarAnime(); break;
        case "jadwal": case "schedule": result = await scraper.schedule(); break;
        case "detail": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi" });
          result = await scraper.detail(slug);
          break;
        }
        case "episode": case "watch": {
          if (!ep_slug) return res.status(400).json({ status: false, message: "Parameter 'ep_slug' wajib diisi" });
          result = await scraper.episode(ep_slug, anime_slug || "");
          break;
        }
        case "search": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi" });
          result = await scraper.search(query);
          break;
        }
        case "trending": result = await scraper.trending(); break;
        case "genres": result = await scraper.genres(); break;
        case "by-genre": {
          if (!genre) return res.status(400).json({ status: false, message: "Parameter 'genre' wajib diisi" });
          result = await scraper.byGenre(genre);
          break;
        }
        case "season": result = await scraper.season(season, year); break;
        case "season-month": result = await scraper.seasonMonth(month, year); break;
        case "donghua": result = await scraper.donghua(page); break;
        case "donghua-detail": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi" });
          result = await scraper.donghuaDetail(slug);
          break;
        }
        case "movies": result = await scraper.movies(page); break;
        case "movie-detail": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi" });
          result = await scraper.movieDetail(slug);
          break;
        }
        case "manga": result = await scraper.manga(); break;
        case "manga-search": result = await scraper.mangaSearch(query || ""); break;
        case "manga-list": result = await scraper.mangaList(); break;
        case "manga-detail": {
          if (!id && !slug) return res.status(400).json({ status: false, message: "Parameter 'id' (atau 'slug') wajib diisi" });
          result = await scraper.mangaDetail(id || slug);
          break;
        }
        case "manga-chapter": {
          if (!chapter_id && !id) return res.status(400).json({ status: false, message: "Parameter 'chapter_id' wajib diisi" });
          result = await scraper.mangaChapter(chapter_id || id);
          break;
        }
        case "wallpapers": result = await scraper.wallpapers(page); break;
        case "wallpaper-detail": {
          if (!id) return res.status(400).json({ status: false, message: "Parameter 'id' wajib diisi" });
          result = await scraper.wallpaperDetail(id);
          break;
        }
        case "articles": result = await scraper.articles(); break;
        case "article-detail": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi" });
          result = await scraper.articleDetail(slug);
          break;
        }
        case "resolve-mirror": {
          if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
          result = { success: true, direct_url: await scraper.resolveMirror(url) };
          break;
        }
        default:
          return res.status(400).json({ status: false, message: `Action '${action}' tidak valid`, available_actions: Object.keys(ACTIONS) });
      }
      return res.json({ status: true, action, result });
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || "Internal server error" });
    }
  }
};
