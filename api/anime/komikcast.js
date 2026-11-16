#!/usr/bin/env node
/**
 * ============================================================================
 * Komikcast Scraper & Web Mirroring Engine v3.0 (CommonJS)
 * Source Target: https://komikcast.info
 * ============================================================================
 * 
 * ARSITEKTUR & DESAIN:
 * - CommonJS (CJS) zero external dependencies: Berjalan di Node.js native (fetch & crypto).
 * - Ekstraksi Props Inertia.js (data-page): Mengambil payload JSON murni dari server
 *   Inertia Laravel tanpa overhead scraping regex DOM HTML yang rapuh.
 * - Bersih dari komentar, noise, atau sitemap: Diformat khusus siap konsumsi REST API & Web Mirror.
 * - Reader Super Cepat: Menyediakan direct CDN/R2 Image URLs, dimensi WxH, byte size, & navigasi.
 * - Video Streaming & Downloads: Menyediakan primary direct embed, mirror streams (Filedon, Vidhide,
 *   Mega, Blogger), serta download links berbagai resolusi (360p - 1080p).
 * 
 * ============================================================================
 * DAFTAR 15 JENIS HALAMAN / ENDPOINT LENGKAP:
 * ============================================================================
 * 1.  home()                        -> Beranda: Manga terbaru, populer, trending, anime update.
 * 2.  manga(options)                -> Katalog Manga 330+ halaman + Multi-filter lanjutan.
 * 3.  detail(slug)                  -> Metadata manga, author, artist, studio, genre, sinopsis, & semua chapter.
 * 4.  read(slug, chapterNum)        -> Reader: Direct CDN/R2 image URLs, dimensi WxH, byte size, prev/next.
 * 5.  novel(options)                -> Katalog 1300+ Novel, paginasi, filter sort & genre.
 * 6.  novelDetail(slug)             -> Detail novel & ribuan chapter.
 * 7.  novelRead(slug, chSlug)       -> Teks isi bacaan novel & source link.
 * 8.  anime(options)                -> Katalog 1800+ Anime series, paginasi, filter tipe & status.
 * 9.  movies(options)               -> Katalog Anime Movies.
 * 10. animeDetail(slug)             -> Detail anime, studio, trailer embed, rating, daftar semua episode.
 * 11. animeStream(slug, epNum)      -> Streaming player direct video, mirror embed, download multi-resolusi.
 * 12. search(query, options)        -> Universal search (all/manga/anime/novel) dengan multi-filter atau Instant API.
 * 13. genres()                      -> Master data 133+ genre (id, name, slug).
 * 14. top(options)                  -> Peringkat karya terpopuler (daily/weekly/monthly/all) beserta skor.
 * 15. topBookmark(type)             -> Karya paling banyak di-bookmark pengguna beserta skor.
 * 
 * ============================================================================
 * PANDUAN INTEGRASI WEB MIRROR & REST API (EXPRESS.JS / NEXT.JS)
 * ============================================================================
 * 
 * CONTOH KODE EXPRESS.JS:
 * ```javascript
 * const express = require('express');
 * const Komikcast = require('./komikcast.cjs');
 * const app = express();
 * const kc = new Komikcast();
 * 
 * // 1. Endpoint Beranda (Update manga & anime terkini)
 * app.get('/api/home', async (req, res) => {
 *   try {
 *     res.json(await kc.home());
 *   } catch (err) {
 *     res.status(500).json({ status: false, error: err.message });
 *   }
 * });
 * 
 * // 2. Endpoint Katalog Manga dengan Advanced Filter
 * // Contoh query: /api/manga?type=Manhwa&status=Ongoing&genre=action&minChapters=50&sort=popular&page=1
 * app.get('/api/manga', async (req, res) => {
 *   try {
 *     const data = await kc.manga({
 *       page: req.query.page,
 *       search: req.query.search,
 *       sort: req.query.sort,
 *       type: req.query.type,
 *       status: req.query.status,
 *       genre: req.query.genre,
 *       minChapters: req.query.minChapters
 *     });
 *     res.json(data);
 *   } catch (err) {
 *     res.status(500).json({ status: false, error: err.message });
 *   }
 * });
 * 
 * // 3. Endpoint Detail Manga & Daftar Semua Chapter
 * app.get('/api/manga/:slug', async (req, res) => {
 *   try {
 *     res.json(await kc.detail(req.params.slug));
 *   } catch (err) {
 *     res.status(404).json({ status: false, error: err.message });
 *   }
 * });
 * 
 * // 4. Endpoint Reader Chapter (Daftar semua gambar direct CDN/R2)
 * app.get('/api/manga/:slug/chapter/:num', async (req, res) => {
 *   try {
 *     res.json(await kc.read(req.params.slug, req.params.num));
 *   } catch (err) {
 *     res.status(404).json({ status: false, error: err.message });
 *   }
 * });
 * 
 * // 5. PENTING: IMAGE PROXY (BYPASS HOTLINK PROTECTION CDN KOMIKCAST)
 * // Gambar CDN Komikcast (berkasdrive / voratoon) memblokir request jika referer bukan komikcast.info
 * // Gunakan endpoint ini di web mirror Anda: <img src="/api/proxy-image?url=${encodeURIComponent(img.url)}" />
 * app.get('/api/proxy-image', async (req, res) => {
 *   try {
 *     const targetUrl = req.query.url;
 *     if (!targetUrl) return res.status(400).send('Query parameter "url" diperlukan.');
 * 
 *     const upstream = await fetch(targetUrl, {
 *       headers: Komikcast.MIRROR_HEADERS
 *     });
 * 
 *     if (!upstream.ok) return res.status(upstream.status).send('Gagal memuat gambar dari CDN.');
 * 
 *     res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
 *     res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // Cache 7 hari
 *     const arrayBuffer = await upstream.arrayBuffer();
 *     res.send(Buffer.from(arrayBuffer));
 *   } catch (err) {
 *     res.status(502).send('Proxy error: ' + err.message);
 *   }
 * });
 * 
 * app.listen(3000, () => console.log('Komikcast Mirror API berjalan di port 3000'));
 * ```
 * 
 * ============================================================================
 * CONTOH PENGGUNAAN TERMINAL / CLI:
 * ============================================================================
 * # 1. Cek struktur seluruh jenis halaman & komponen
 * node komikcast.cjs pages
 * 
 * # 2. Dapatkan data homepage
 * node komikcast.cjs home
 * 
 * # 3. Filter Katalog Manga (Contoh: Manhwa Ongoing, genre action, min 50 ch, urut popular)
 * node komikcast.cjs manga -t Manhwa --status Ongoing -g action --min 50 -s popular -p 1
 * 
 * # 4. Detail manga lengkap
 * node komikcast.cjs detail solo-leveling
 * 
 * # 5. Baca chapter (Output JSON semua URL gambar CDN/R2)
 * node komikcast.cjs read solo-leveling 1 -j
 * 
 * # 6. Katalog & Baca Novel
 * node komikcast.cjs novel -p 1
 * node komikcast.cjs novel-detail kekaisaran-industri-sihir
 * node komikcast.cjs novel-read kekaisaran-industri-sihir chapter-64
 * 
 * # 7. Streaming & Download Anime
 * node komikcast.cjs anime-detail hotaru-no-yomeiri
 * node komikcast.cjs anime-stream hotaru-no-yomeiri 6
 * 
 * # 8. Universal Search (Manga / Anime / Novel)
 * node komikcast.cjs search solo -c manga -t Manhwa
 * 
 * # 9. Peringkat Populer & Paling Banyak Dibookmark
 * node komikcast.cjs top manga weekly
 * node komikcast.cjs top-bookmark manga
 * ============================================================================
 */


const BASE_URL = 'https://komikcast.info';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function unescapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

class Komikcast {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || BASE_URL).replace(/\/+$/, '');
    this.ua = options.ua || DEFAULT_UA;
  }

  /**
   * Header yang direkomendasikan saat proxy/mirror gambar CDN agar tidak terblokir
   */
  static get MIRROR_HEADERS() {
    return {
      'User-Agent': DEFAULT_UA,
      'Referer': `${BASE_URL}/`,
      'Origin': BASE_URL
    };
  }

  /**
   * Peta Halaman & Komponen di Komikcast
   */
  static get PAGE_TYPES() {
    return [
      { name: 'Home', path: '/', component: 'Home', description: 'Homepage: Update manga & anime terkini, populer, trending' },
      { name: 'Manga Index', path: '/manga', component: 'Manga/Index', description: 'Katalog Manga dengan paginasi (330+ hal) & advanced filters' },
      { name: 'Manga Detail', path: '/manga/:slug', component: 'Manga/Show', description: 'Detail komik, author, artist, genre, sinopsis, & semua chapter' },
      { name: 'Manga Reader', path: '/manga/:slug/chapter/:num', component: 'Manga/Read', description: 'Reader komik dengan semua direct image URLs (CDN/R2)' },
      { name: 'Novel Index', path: '/novel', component: 'Novel/Index', description: 'Katalog Novel dengan paginasi dan filter' },
      { name: 'Novel Detail', path: '/novel/:slug', component: 'Novel/Show', description: 'Detail novel & list ribuan chapter' },
      { name: 'Novel Reader', path: '/novel/:slug/chapter/:chapterSlug', component: 'Novel/Read', description: 'Pembaca teks/konten chapter novel' },
      { name: 'Anime Explore', path: '/explore', component: 'Explore', description: 'Katalog serial anime dengan paginasi dan filter' },
      { name: 'Anime Movies', path: '/movies', component: 'Movies', description: 'Katalog anime movies dengan filter' },
      { name: 'Anime Detail', path: '/anime/:slug', component: 'Anime/Show', description: 'Detail anime, trailer, studio, skor, dan list episode' },
      { name: 'Anime Player', path: '/anime/:slug/episode/:num', component: 'Anime/Player', description: 'Streaming player, video URL, mirror streams, & download multi-resolusi' },
      { name: 'Global Search', path: '/search?q=:query', component: 'Search/Index', description: 'Pencarian universal multi-kategori (all/manga/anime/novel)' },
      { name: 'Instant API Search', path: '/api/manga/search?q=:query', component: 'API', description: 'Pencarian cepat respons JSON langsung dari server' },
      { name: 'Top Rankings', path: '/top?type=:type&period=:period', component: 'Top', description: 'Peringkat karya terpopuler (daily/weekly/monthly/all)' },
      { name: 'Top Bookmark', path: '/top-bookmark?type=:type', component: 'TopBookmark', description: 'Karya paling banyak di-bookmark pengguna' }
    ];
  }

  /**
   * Helper request untuk mengekstrak data Inertia (data-page) dari HTML
   */
  async requestInertia(path, params = {}) {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== '') {
        if (Array.isArray(val)) {
          val.forEach(v => url.searchParams.append(`${key}[]`, v));
        } else {
          url.searchParams.set(key, val);
        }
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': this.ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id,en-US;q=0.9,en;q=0.8'
      }
    });

    if (!res.ok) {
      throw new Error(`Komikcast request gagal [HTTP ${res.status}]: ${url.toString()}`);
    }

    const html = await res.text();
    const match = html.match(/data-page="([^"]+)"/);
    if (!match) {
      throw new Error(`Gagal mengekstrak data-page dari ${url.toString()}`);
    }

    try {
      const decoded = unescapeHtml(match[1]);
      return JSON.parse(decoded);
    } catch (err) {
      throw new Error(`Gagal parse JSON Inertia: ${err.message}`);
    }
  }

  formatPagination(pObj) {
    if (!pObj) return null;
    return {
      currentPage: pObj.current_page || 1,
      lastPage: pObj.last_page || 1,
      perPage: pObj.per_page || 24,
      total: pObj.total || 0,
      from: pObj.from || 0,
      to: pObj.to || 0,
      hasNextPage: Boolean(pObj.next_page_url),
      hasPrevPage: Boolean(pObj.prev_page_url)
    };
  }

  // ==========================================
  // 1. HOMEPAGE
  // ==========================================
  /**
   * Mengambil data beranda Komikcast lengkap (manga terbaru, populer, trending, anime update)
   * 
   * @returns {Promise<Object>} Object berisi:
   *   - status: boolean
   *   - component: 'Home'
   *   - latestMangaUpdates: Array manga terbaru dengan 3 chapter rilis terakhir
   *   - popularManga: Array komik populer mingguan
   *   - trendingManga: Array komik yang sedang trending
   *   - latestAnimeUpdates: Array update anime terbaru beserta nomor episode
   *   - popularAnime: Object anime populer
   * 
   * @example
   * const kc = new Komikcast();
   * const homeData = await kc.home();
   * console.log(homeData.latestMangaUpdates[0].title);
   */
  async home() {
    const data = await this.requestInertia('/');
    const props = data.props || {};

    const formatManga = (item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      poster: item.poster,
      type: item.type,
      status: item.status,
      rating: item.rating ? parseFloat(item.rating) : null,
      lastChapter: item.last_chapter || null,
      latestChapters: (item.chapters || []).map(ch => ({
        id: ch.id,
        number: ch.chapter_number,
        title: ch.title,
        createdAt: ch.created_at,
        url: `${this.baseUrl}/manga/${item.slug}/chapter/${ch.chapter_number}`
      })),
      url: `${this.baseUrl}/manga/${item.slug}`
    });

    const formatAnime = (item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      poster: item.poster,
      status: item.status,
      rating: item.rating ? parseFloat(item.rating) : null,
      viewsCount: item.views_count,
      latestEpisodes: (item.episodes || []).map(ep => ({
        id: ep.id,
        number: ep.number,
        releaseDate: ep.release_date,
        url: `${this.baseUrl}/anime/${item.slug}/episode/${ep.number}`
      })),
      url: `${this.baseUrl}/anime/${item.slug}`
    });

    return {
      status: true,
      component: data.component,
      latestMangaUpdates: (props.latestMangaUpdates || []).map(formatManga),
      popularManga: (props.popularManga || []).map(formatManga),
      trendingManga: (props.trendingManga || []).map(formatManga),
      latestAnimeUpdates: (props.latestUpdates || []).map(formatAnime),
      popularAnime: props.popular || {}
    };
  }

  // ==========================================
  // 2. MANGA & ADVANCED FILTER
  // ==========================================
  /**
   * Katalog Manga dengan Advanced Multi-Criteria Filter (330+ Halaman)
   * 
   * @param {Object} [filter={}] - Parameter filter pencarian
   * @param {number} [filter.page=1] - Nomor halaman paginasi (1 - 330+)
   * @param {string} [filter.search=""] - Kata kunci pencarian judul komik
   * @param {string} [filter.sort="latest_update"] - Pengurutan: 'latest_update' | 'popular' | 'rating'
   * @param {string} [filter.type=""] - Tipe komik: 'Manga' | 'Manhwa' | 'Manhua'
   * @param {string} [filter.status=""] - Status rilis: 'Ongoing' | 'Completed' | 'Hiatus'
   * @param {string} [filter.genre=""] - Slug genre (misal: 'action', 'isekai', 'romance', dll)
   * @param {number} [filter.minChapters=1] - Filter batas minimum jumlah chapter yang sudah rilis
   * 
   * @returns {Promise<Object>} Object katalog dengan pagination ({ currentPage, lastPage, total, ... }) dan results[]
   * 
   * @example
   * const manhwaOngoing = await kc.manga({
   *   type: 'Manhwa',
   *   status: 'Ongoing',
   *   genre: 'action',
   *   minChapters: 50,
   *   sort: 'popular',
   *   page: 1
   * });
   */
  async manga({
    page = 1,
    search = '',
    sort = 'latest_update',
    type = '',
    status = '',
    genre = '',
    minChapters = 1
  } = {}) {
    const params = {
      page,
      search,
      sort,
      type,
      status,
      genre,
      min_chapters: minChapters
    };

    const data = await this.requestInertia('/manga', params);
    const props = data.props || {};
    const mangas = props.mangas || {};

    const results = (mangas.data || []).map(item => ({
      id: item.id,
      title: item.title,
      alternativeTitles: item.alternative_titles,
      slug: item.slug,
      synopsis: item.synopsis,
      poster: item.poster,
      type: item.type,
      status: item.status,
      author: item.author,
      artist: item.artist,
      studio: item.studio,
      rating: item.rating ? parseFloat(item.rating) : null,
      releaseYear: item.release_year,
      viewsCount: item.views_count,
      genres: (item.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      lastChapter: item.last_chapter || null,
      latestChapters: (item.chapters || []).map(ch => ({
        id: ch.id,
        number: ch.chapter_number,
        title: ch.title,
        createdAt: ch.created_at,
        url: `${this.baseUrl}/manga/${item.slug}/chapter/${ch.chapter_number}`
      })),
      url: `${this.baseUrl}/manga/${item.slug}`
    }));

    return {
      status: true,
      component: data.component,
      pagination: this.formatPagination(mangas),
      filters: props.filters || params,
      results
    };
  }

  /**
   * Detail Manga Lengkap (Metadata, Genres, Author, Rating, & Seluruh List Chapter)
   * Catatan: Data komentar otomatis disaring (stripped) agar bersih untuk web mirror.
   * 
   * @param {string} slug - Slug manga (contoh: 'solo-leveling' atau '/manga/solo-leveling')
   * @returns {Promise<Object>} Metadata komik, firstChapter, relatedMangas, dan daftar semua chapter
   * 
   * @example
   * const detail = await kc.detail('solo-leveling');
   * console.log(`Total Chapters: ${detail.totalChapters}`);
   */
  async detail(slug) {
    if (!slug) throw new Error("Parameter 'slug' manga diperlukan.");
    const cleanSlug = slug.replace(/^\/?(manga\/)?/, '').replace(/\/+$/, '');
    const data = await this.requestInertia(`/manga/${cleanSlug}`);
    const props = data.props || {};
    const m = props.manga;

    if (!m) throw new Error(`Manga "${cleanSlug}" tidak ditemukan.`);

    const chapters = (m.chapters || []).map(ch => ({
      id: ch.id,
      number: ch.chapter_number,
      title: ch.title,
      slug: ch.slug,
      viewsCount: ch.views_count,
      createdAt: ch.created_at,
      url: `${this.baseUrl}/manga/${m.slug}/chapter/${ch.chapter_number}`
    }));

    return {
      status: true,
      component: data.component,
      id: m.id,
      title: m.title,
      alternativeTitles: m.alternative_titles,
      slug: m.slug,
      synopsis: m.synopsis,
      poster: m.poster,
      type: m.type,
      status: m.status,
      author: m.author,
      artist: m.artist,
      studio: m.studio,
      rating: m.rating ? parseFloat(m.rating) : null,
      ratingsCount: m.ratings_count,
      releaseYear: m.release_year,
      viewsCount: m.views_count,
      mangaRank: props.mangaRank || null,
      firstChapter: props.firstChapter ? {
        id: props.firstChapter.id,
        number: props.firstChapter.chapter_number,
        title: props.firstChapter.title,
        url: `${this.baseUrl}/manga/${m.slug}/chapter/${props.firstChapter.chapter_number}`
      } : null,
      genres: (m.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      totalChapters: chapters.length,
      chapters,
      relatedMangas: (props.relatedMangas || []).map(rel => ({
        id: rel.id,
        title: rel.title,
        slug: rel.slug,
        poster: rel.poster,
        type: rel.type,
        rating: rel.rating ? parseFloat(rel.rating) : null,
        url: `${this.baseUrl}/manga/${rel.slug}`
      })),
      url: `${this.baseUrl}/manga/${m.slug}`
    };
  }

  /**
   * Reader Chapter Komik (Daftar semua URL gambar direct CDN/R2 siap mirror)
   * 
   * @param {string} slug - Slug manga (contoh: 'solo-leveling')
   * @param {string|number} chapterNumber - Nomor chapter (contoh: 1 atau '1' atau '179')
   * @returns {Promise<Object>} Object berisi images[] (urutan halaman, direct CDN url, dimensi WxH, bytes),
   *                            serta navigasi chapter sebelumnya & sesudahnya (prev/next).
   * 
   * @example
   * const ch = await kc.read('solo-leveling', 1);
   * console.log(`Ditemukan ${ch.totalImages} gambar.`);
   * ch.images.forEach(img => console.log(`Halaman ${img.page}: ${img.url}`));
   */
  async read(slug, chapterNumber) {
    if (!slug) throw new Error("Parameter 'slug' manga diperlukan.");
    if (chapterNumber === undefined || chapterNumber === null) {
      throw new Error("Parameter 'chapterNumber' diperlukan.");
    }

    const cleanSlug = slug.replace(/^\/?(manga\/)?/, '').replace(/\/+$/, '');
    const cleanChapter = String(chapterNumber).replace(/^chapter-?/i, '');

    const data = await this.requestInertia(`/manga/${cleanSlug}/chapter/${cleanChapter}`);
    const props = data.props || {};
    const chapter = props.chapter;
    const manga = props.manga;

    if (!chapter) throw new Error(`Chapter ${cleanChapter} untuk "${cleanSlug}" tidak ditemukan.`);

    const images = (chapter.images || []).map(img => ({
      order: img.order,
      page: img.order + 1,
      url: img.r2_url || img.image_path,
      r2Url: img.r2_url || null,
      cdnPath: img.image_path || null,
      width: img.width,
      height: img.height,
      bytes: img.r2_bytes || null
    })).sort((a, b) => a.order - b.order);

    return {
      status: true,
      component: data.component,
      manga: {
        id: manga?.id,
        title: manga?.title,
        slug: manga?.slug,
        type: manga?.type,
        poster: manga?.poster,
        url: `${this.baseUrl}/manga/${manga?.slug}`
      },
      chapter: {
        id: chapter.id,
        number: chapter.chapter_number,
        title: chapter.title,
        slug: chapter.slug,
        viewsCount: chapter.views_count,
        createdAt: chapter.created_at,
        url: `${this.baseUrl}/manga/${cleanSlug}/chapter/${chapter.chapter_number}`
      },
      navigation: {
        prev: props.prev ? {
          number: props.prev.chapter_number,
          title: props.prev.title,
          url: `${this.baseUrl}/manga/${cleanSlug}/chapter/${props.prev.chapter_number}`
        } : null,
        next: props.next ? {
          number: props.next.chapter_number,
          title: props.next.title,
          url: `${this.baseUrl}/manga/${cleanSlug}/chapter/${props.next.chapter_number}`
        } : null
      },
      totalImages: images.length,
      images,
      availableChapters: (props.chapters || []).map(ch => ({
        number: ch.chapter_number,
        title: ch.title,
        url: `${this.baseUrl}/manga/${cleanSlug}/chapter/${ch.chapter_number}`
      }))
    };
  }

  // ==========================================
  // 3. NOVELS
  // ==========================================
  /**
   * Katalog Novel Terjemahan (1.300+ Novel, 50+ Halaman)
   * 
   * @param {Object} [filter={}] - Parameter filter pencarian novel
   * @param {number} [filter.page=1] - Nomor halaman (1 - 56+)
   * @param {string} [filter.search=""] - Kata kunci pencarian judul novel
   * @param {string} [filter.sort="latest_update"] - 'latest_update' | 'popular' | 'rating'
   * @param {string} [filter.status=""] - 'Ongoing' | 'Completed'
   * @param {string} [filter.genre=""] - Slug genre novel
   * @returns {Promise<Object>} Object berisi pagination dan results[] novel
   * 
   * @example
   * const novels = await kc.novel({ page: 1, sort: 'popular' });
   * console.log(`Total novel: ${novels.pagination.total}`);
   */
  async novel({
    page = 1,
    search = '',
    sort = 'latest_update',
    status = '',
    genre = ''
  } = {}) {
    const params = { page, search, sort, status, genre };
    const data = await this.requestInertia('/novel', params);
    const props = data.props || {};
    const mangas = props.mangas || {};

    const results = (mangas.data || []).map(item => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      synopsis: item.synopsis,
      poster: item.poster,
      type: 'Novel',
      status: item.status,
      author: item.author,
      artist: item.artist,
      rating: item.rating ? parseFloat(item.rating) : null,
      viewsCount: item.views_count,
      chaptersCount: item.chapters_count || 0,
      firstChapter: item.first_chapter_title ? {
        title: item.first_chapter_title,
        slug: item.first_chapter_slug,
        url: `${this.baseUrl}/novel/${item.slug}/chapter/${item.first_chapter_slug}`
      } : null,
      lastChapter: item.last_chapter || null,
      genres: (item.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      url: `${this.baseUrl}/novel/${item.slug}`
    }));

    return {
      status: true,
      component: data.component,
      pagination: this.formatPagination(mangas),
      filters: props.filters || params,
      results
    };
  }

  /**
   * Detail Novel Lengkap & Daftar Seluruh Chapter Novel
   * 
   * @param {string} slug - Slug novel (contoh: 'kekaisaran-industri-sihir')
   * @returns {Promise<Object>} Metadata novel, firstChapter, relatedNovels, dan daftar chapters[]
   * 
   * @example
   * const detail = await kc.novelDetail('kekaisaran-industri-sihir');
   * console.log(`Judul: ${detail.title}, Total Chapter: ${detail.totalChapters}`);
   */
  async novelDetail(slug) {
    if (!slug) throw new Error("Parameter 'slug' novel diperlukan.");
    const cleanSlug = slug.replace(/^\/?(novel\/)?/, '').replace(/\/+$/, '');
    const data = await this.requestInertia(`/novel/${cleanSlug}`);
    const props = data.props || {};
    const m = props.manga;

    if (!m) throw new Error(`Novel "${cleanSlug}" tidak ditemukan.`);

    return {
      status: true,
      component: data.component,
      id: m.id,
      title: m.title,
      slug: m.slug,
      synopsis: m.synopsis,
      poster: m.poster,
      type: 'Novel',
      status: m.status,
      author: m.author,
      artist: m.artist,
      rating: m.rating ? parseFloat(m.rating) : null,
      ratingsCount: m.ratings_count,
      viewsCount: m.views_count,
      mangaRank: props.mangaRank || null,
      firstChapter: props.firstChapter ? {
        title: props.firstChapter.title,
        slug: props.firstChapter.slug,
        number: props.firstChapter.chapter_number,
        url: `${this.baseUrl}/novel/${m.slug}/chapter/${props.firstChapter.slug}`
      } : null,
      genres: (m.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      totalChapters: (m.chapters || []).length,
      chapters: (m.chapters || []).map(ch => ({
        id: ch.id,
        number: ch.chapter_number,
        position: ch.position,
        title: ch.title,
        slug: ch.slug,
        viewsCount: ch.views_count,
        createdAt: ch.created_at,
        url: `${this.baseUrl}/novel/${m.slug}/chapter/${ch.slug}`
      })),
      relatedNovels: (props.relatedNovels || []).map(rel => ({
        id: rel.id,
        title: rel.title,
        slug: rel.slug,
        poster: rel.poster,
        url: `${this.baseUrl}/novel/${rel.slug}`
      })),
      url: `${this.baseUrl}/novel/${m.slug}`
    };
  }

  /**
   * Pembaca Teks Konten Chapter Novel
   * 
   * @param {string} slug - Slug novel (contoh: 'kekaisaran-industri-sihir')
   * @param {string} chapterSlug - Slug chapter (contoh: 'chapter-64' atau '64')
   * @returns {Promise<Object>} Konten teks bacaan novel, source URL, dan navigasi chapter prev/next
   * 
   * @example
   * const read = await kc.novelRead('kekaisaran-industri-sihir', 'chapter-64');
   * console.log(read.chapter.content);
   */
  async novelRead(slug, chapterSlug) {
    if (!slug) throw new Error("Parameter 'slug' novel diperlukan.");
    if (!chapterSlug) throw new Error("Parameter 'chapterSlug' diperlukan.");

    const cleanSlug = slug.replace(/^\/?(novel\/)?/, '').replace(/\/+$/, '');
    const cleanChSlug = String(chapterSlug).startsWith('chapter-') ? String(chapterSlug) : `chapter-${chapterSlug}`;

    const data = await this.requestInertia(`/novel/${cleanSlug}/chapter/${cleanChSlug}`);
    const props = data.props || {};
    const chapter = props.chapter;
    const manga = props.manga;

    if (!chapter) throw new Error(`Chapter "${cleanChSlug}" untuk novel "${cleanSlug}" tidak ditemukan.`);

    return {
      status: true,
      component: data.component,
      novel: {
        id: manga?.id,
        title: manga?.title,
        slug: manga?.slug,
        poster: manga?.poster,
        url: `${this.baseUrl}/novel/${manga?.slug}`
      },
      chapter: {
        id: chapter.id,
        title: chapter.title,
        slug: chapter.slug,
        number: chapter.chapter_number,
        position: chapter.position,
        viewsCount: chapter.views_count,
        sourceUrl: chapter.source_url || null,
        content: chapter.content || '',
        createdAt: chapter.created_at,
        url: `${this.baseUrl}/novel/${cleanSlug}/chapter/${chapter.slug}`
      },
      navigation: {
        prev: props.prev ? {
          title: props.prev.title,
          slug: props.prev.slug,
          url: `${this.baseUrl}/novel/${cleanSlug}/chapter/${props.prev.slug}`
        } : null,
        next: props.next ? {
          title: props.next.title,
          slug: props.next.slug,
          url: `${this.baseUrl}/novel/${cleanSlug}/chapter/${props.next.slug}`
        } : null
      },
      availableChapters: (props.chapters || []).map(ch => ({
        title: ch.title,
        slug: ch.slug,
        url: `${this.baseUrl}/novel/${cleanSlug}/chapter/${ch.slug}`
      }))
    };
  }

  // ==========================================
  // 4. ANIME & MOVIES
  // ==========================================
  /**
   * Katalog Serial Anime (1.800+ Anime, 75+ Halaman)
   * 
   * @param {Object} [filter={}] - Parameter filter pencarian anime
   * @param {number} [filter.page=1] - Halaman paginasi
   * @param {string} [filter.search=""] - Kata kunci judul anime
   * @param {string} [filter.sort="latest_update"] - 'latest_update' | 'popular' | 'rating'
   * @param {string} [filter.genre=""] - Slug genre anime
   * @param {string} [filter.type=""] - 'TV' | 'OVA' | 'ONA' | 'Special'
   * @param {string} [filter.status=""] - 'Ongoing' | 'Completed'
   * @returns {Promise<Object>} Object katalog dengan pagination dan results[] anime
   * 
   * @example
   * const animeList = await kc.anime({ page: 1, type: 'TV', sort: 'popular' });
   */
  async anime({
    page = 1,
    search = '',
    sort = 'latest_update',
    genre = '',
    type = '',
    status = ''
  } = {}) {
    const params = { page, search, sort, genre, type, status };
    const data = await this.requestInertia('/explore', params);
    const props = data.props || {};
    const animes = props.animes || {};

    const results = (animes.data || []).map(item => ({
      id: item.id,
      title: item.title,
      alternativeTitles: item.alternative_titles,
      slug: item.slug,
      synopsis: item.synopsis,
      poster: item.poster,
      type: item.type,
      status: item.status,
      episodesCount: item.episodes_count,
      rating: item.rating ? parseFloat(item.rating) : null,
      releaseYear: item.release_year,
      studio: item.studio,
      genres: (item.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      url: `${this.baseUrl}/anime/${item.slug}`
    }));

    return {
      status: true,
      component: data.component,
      pagination: this.formatPagination(animes),
      results
    };
  }

  /**
   * Katalog Film Anime (Anime Movies)
   * 
   * @param {Object} [filter={}] - Parameter filter anime movie
   * @param {number} [filter.page=1] - Halaman paginasi
   * @param {string} [filter.search=""] - Kata kunci pencarian movie
   * @param {string} [filter.sort="latest_update"] - 'latest_update' | 'popular' | 'rating'
   * @param {string} [filter.genre=""] - Slug genre
   * @returns {Promise<Object>} Object katalog dengan pagination dan results[] movie
   * 
   * @example
   * const movies = await kc.movies({ page: 1, sort: 'rating' });
   */
  async movies({ page = 1, search = '', sort = 'latest_update', genre = '' } = {}) {
    const params = { page, search, sort, genre };
    const data = await this.requestInertia('/movies', params);
    const props = data.props || {};
    const animes = props.animes || {};

    const results = (animes.data || []).map(item => ({
      id: item.id,
      title: item.title,
      alternativeTitles: item.alternative_titles,
      slug: item.slug,
      synopsis: item.synopsis,
      poster: item.poster,
      type: 'Movie',
      status: item.status,
      rating: item.rating ? parseFloat(item.rating) : null,
      releaseYear: item.release_year,
      studio: item.studio,
      genres: (item.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      url: `${this.baseUrl}/anime/${item.slug}`
    }));

    return {
      status: true,
      component: data.component,
      pagination: this.formatPagination(animes),
      results
    };
  }

  /**
   * Detail Anime Lengkap & Daftar Semua Episode
   * 
   * @param {string} slug - Slug anime (contoh: 'hotaru-no-yomeiri')
   * @returns {Promise<Object>} Metadata anime, studio, trailerUrl, rating, dan daftar episodes[]
   * 
   * @example
   * const anime = await kc.animeDetail('hotaru-no-yomeiri');
   * console.log(`Total Episode: ${anime.totalEpisodes}`);
   */
  async animeDetail(slug) {
    if (!slug) throw new Error("Parameter 'slug' anime diperlukan.");
    const cleanSlug = slug.replace(/^\/?(anime\/)?/, '').replace(/\/+$/, '');
    const data = await this.requestInertia(`/anime/${cleanSlug}`);
    const props = data.props || {};
    const a = props.anime;

    if (!a) throw new Error(`Anime "${cleanSlug}" tidak ditemukan.`);

    return {
      status: true,
      component: data.component,
      id: a.id,
      title: a.title,
      alternativeTitles: a.alternative_titles,
      slug: a.slug,
      synopsis: a.synopsis,
      poster: a.poster,
      type: a.type,
      status: a.status,
      episodesCount: a.episodes_count,
      trailerUrl: a.trailer_url,
      rating: a.rating ? parseFloat(a.rating) : null,
      releaseYear: a.release_year,
      studio: a.studio,
      viewsCount: a.views_count,
      genres: (a.genres || []).map(g => ({ id: g.id, name: g.name, slug: g.slug })),
      totalEpisodes: (a.episodes || []).length,
      episodes: (a.episodes || []).map(ep => ({
        id: ep.id,
        number: ep.number,
        duration: ep.duration,
        releaseDate: ep.release_date,
        createdAt: ep.created_at,
        url: `${this.baseUrl}/anime/${a.slug}/episode/${ep.number}`
      })),
      url: `${this.baseUrl}/anime/${a.slug}`
    };
  }

  /**
   * Streaming Video Player Anime & Link Download Multi-Resolusi
   * 
   * @param {string} slug - Slug anime (contoh: 'hotaru-no-yomeiri')
   * @param {string|number} episodeNumber - Nomor episode (contoh: 6 atau '6')
   * @returns {Promise<Object>} Object berisi primaryVideoUrl, mirrorStreams[] (Filedon, Vidhide, Mega, Blogger),
   *                            downloadUrls[] per resolusi (360p - 1080p), dan navigasi episode
   * 
   * @example
   * const stream = await kc.animeStream('hotaru-no-yomeiri', 6);
   * console.log(`Direct Player: ${stream.episode.primaryVideoUrl}`);
   * stream.episode.downloadUrls.forEach(d => console.log(`[${d.label}] ${d.url}`));
   */
  async animeStream(slug, episodeNumber) {
    if (!slug) throw new Error("Parameter 'slug' anime diperlukan.");
    if (episodeNumber === undefined || episodeNumber === null) {
      throw new Error("Parameter 'episodeNumber' diperlukan.");
    }

    const cleanSlug = slug.replace(/^\/?(anime\/)?/, '').replace(/\/+$/, '');
    const cleanEp = String(episodeNumber).replace(/^episode-?/i, '');

    const data = await this.requestInertia(`/anime/${cleanSlug}/episode/${cleanEp}`);
    const props = data.props || {};
    const ep = props.episode;
    const anime = props.anime;

    if (!ep) throw new Error(`Episode ${cleanEp} untuk anime "${cleanSlug}" tidak ditemukan.`);

    return {
      status: true,
      component: data.component,
      anime: {
        id: anime?.id,
        title: anime?.title,
        slug: anime?.slug,
        poster: anime?.poster,
        url: `${this.baseUrl}/anime/${anime?.slug}`
      },
      episode: {
        id: ep.id,
        number: ep.number,
        title: ep.title,
        primaryVideoUrl: ep.video_url || null,
        mirrorStreams: (ep.mirror_streams || []).map(m => ({
          provider: m.provider,
          quality: m.quality,
          url: m.url || m.stream_url
        })),
        downloadUrls: (ep.download_urls || []).map(d => ({
          label: d.label,
          provider: d.provider,
          url: d.url
        })),
        archivedStreams: ep.archived_streams || [],
        berkasdriveSources: ep.berkasdrive_sources || [],
        url: `${this.baseUrl}/anime/${cleanSlug}/episode/${ep.number}`
      },
      allEpisodes: (props.allEpisodes || []).map(e => ({
        number: e.number,
        url: `${this.baseUrl}/anime/${cleanSlug}/episode/${e.number}`
      }))
    };
  }

  // ==========================================
  // 5. GLOBAL & ADVANCED MULTI-FILTER SEARCH
  // ==========================================
  /**
   * Universal Search Lintas Kategori (All / Manga / Anime / Novel) dengan Filter Multi-Kriteria
   * 
   * @param {string} query - Kata kunci pencarian (contoh: 'solo' atau 'one piece')
   * @param {Object} [options={}] - Opsi filter pencarian
   * @param {string} [options.category="all"] - Kategori target: 'all' | 'manga' | 'anime' | 'novel'
   * @param {string} [options.sort="popular"] - 'popular' | 'latest_update' | 'rating' | 'title'
   * @param {string|string[]} [options.mangaType] - 'Manga' | 'Manhwa' | 'Manhua'
   * @param {string|string[]} [options.mangaStatus] - 'Ongoing' | 'Completed' | 'Hiatus'
   * @param {string|string[]} [options.mangaGenre] - Array slug genre komik
   * @param {number} [options.minChapters=1] - Minimum chapter komik yang sudah rilis
   * @param {string|string[]} [options.animeType] - 'TV' | 'Movie' | 'OVA'
   * @param {string|string[]} [options.animeStatus] - 'Ongoing' | 'Completed'
   * @param {string|string[]} [options.animeGenre] - Array slug genre anime
   * @param {number} [options.page=1] - Nomor halaman paginasi
   * @param {boolean} [options.quick=false] - Jika true, gunakan instant JSON API Komikcast (/api/manga/search?q=)
   * 
   * @returns {Promise<Object>} Hasil pencarian terstruktur beserta informasi paginasi
   * 
   * @example
   * const searchManga = await kc.search('solo', {
   *   category: 'manga',
   *   mangaType: 'Manhwa',
   *   sort: 'popular'
   * });
   */
  async search(query, options = {}) {
    if (!query) throw new Error("Kata kunci 'query' diperlukan.");

    if (options.quick) {
      const res = await fetch(`${this.baseUrl}/api/manga/search?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': this.ua }
      });
      if (res.ok) {
        const json = await res.json();
        return {
          status: true,
          mode: 'quick',
          query,
          total: (json.data || []).length,
          results: (json.data || []).map(item => ({
            id: item.id,
            title: item.title,
            slug: item.slug,
            poster: item.poster,
            type: item.type,
            status: item.status,
            rating: item.rating ? parseFloat(item.rating) : null,
            lastChapter: item.last_chapter || null,
            url: `${this.baseUrl}/manga/${item.slug}`
          }))
        };
      }
    }

    const toArr = (v) => v ? (Array.isArray(v) ? v : [v]) : [];

    const params = {
      q: query,
      category: options.category || 'all',
      sort: options.sort || 'popular',
      page: options.page || 1,
      manga_min_chapters: options.minChapters || 1,
      'manga_type[]': toArr(options.mangaType),
      'manga_status[]': toArr(options.mangaStatus),
      'manga_genre[]': toArr(options.mangaGenre),
      'anime_type[]': toArr(options.animeType),
      'anime_status[]': toArr(options.animeStatus),
      'anime_genre[]': toArr(options.animeGenre)
    };

    const data = await this.requestInertia('/search', params);
    const props = data.props || {};
    const results = props.results || {};

    return {
      status: true,
      component: data.component,
      mode: 'full',
      query: props.query || query,
      category: props.category || options.category || 'all',
      filters: props.filters || {},
      pagination: this.formatPagination(results),
      results: (results.data || []).map(item => ({
        id: item.id,
        title: item.title,
        alternativeTitles: item.alternative_titles,
        slug: item.slug,
        poster: item.poster,
        type: item.type,
        status: item.status,
        rating: item.rating ? parseFloat(item.rating) : null,
        episodesCount: item.episodes_count || null,
        viewsCount: item.views_count,
        url: `${this.baseUrl}/${item.episodes_count ? 'anime' : 'manga'}/${item.slug}`
      }))
    };
  }

  // ==========================================
  // 6. GENRES & TOP RANKINGS
  // ==========================================
  /**
   * Master Data 133+ Genre Lengkap Komikcast (ID, Name, Slug)
   * 
   * @returns {Promise<Object>} Object berisi total genre dan array genres[]
   * 
   * @example
   * const g = await kc.genres();
   * console.log(`Total Genre Tersedia: ${g.total}`);
   */
  async genres() {
    const data = await this.requestInertia('/manga');
    const genres = (data.props && data.props.genres) || [];
    return {
      status: true,
      total: genres.length,
      genres: genres.map(g => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        url: `${this.baseUrl}/manga?genre=${g.slug}`
      }))
    };
  }

  /**
   * Peringkat Karya Terpopuler Berdasarkan Periode Waktu
   * 
   * @param {Object} [options={}]
   * @param {string} [options.type="manga"] - Tipe karya: 'manga' | 'anime'
   * @param {string} [options.period="all"] - Periode waktu: 'daily' | 'weekly' | 'monthly' | 'all'
   * @returns {Promise<Object>} Object berisi type, period, dan items[] terurut berdasarkan skor popularitas
   * 
   * @example
   * const topWeekly = await kc.top({ type: 'manga', period: 'weekly' });
   * console.log(`Rank 1: ${topWeekly.items[0].title} (Score: ${topWeekly.items[0].score})`);
   */
  async top({ type = 'manga', period = 'all' } = {}) {
    const data = await this.requestInertia('/top', { type, period });
    const props = data.props || {};

    return {
      status: true,
      type: props.type || type,
      period: props.period || period,
      items: (props.items || []).map((item, index) => ({
        rank: index + 1,
        id: item.id,
        title: item.title,
        slug: item.slug,
        poster: item.poster,
        type: item.type,
        score: item.score || null,
        status: item.status || null,
        url: `${this.baseUrl}/${type === 'anime' ? 'anime' : 'manga'}/${item.slug}`
      }))
    };
  }

  /**
   * Peringkat Karya Paling Banyak Dibookmark Pengguna
   * 
   * @param {string} [type="manga"] - Tipe karya: 'manga' | 'anime'
   * @returns {Promise<Object>} Object berisi items[] terurut berdasarkan jumlah bookmark (score)
   * 
   * @example
   * const topBookmarks = await kc.topBookmark('manga');
   * console.log(`Most Bookmarked: ${topBookmarks.items[0].title}`);
   */
  async topBookmark(type = 'manga') {
    const data = await this.requestInertia('/top-bookmark', { type });
    const props = data.props || {};

    return {
      status: true,
      type: props.type || type,
      items: (props.items || []).map((item, index) => ({
        rank: index + 1,
        id: item.id,
        title: item.title,
        slug: item.slug,
        poster: item.poster,
        type: item.type,
        score: item.score || item.bookmarks_count || null,
        status: item.status || null,
        url: `${this.baseUrl}/${type === 'anime' ? 'anime' : 'manga'}/${item.slug}`
      }))
    };
  }
}

// ==========================================
// CLI HANDLER
// ==========================================

const kc = new Komikcast();

export default {
  name: "Komikcast",
  description: "Baca komik (Manga, Manhwa, Manhua), novel, dan streaming anime lengkap dengan daftar chapter, direct reader images, serta link download video.",
  category: "Anime",
  methods: ["GET", "POST"],
  params: [
    "action",
    "query",
    "slug",
    "chapter",
    "episode",
    "page",
    "type",
    "status",
    "genre",
    "sort",
    "category",
    "minChapters",
    "period"
  ],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      enum: [
        "home",
        "manga",
        "detail",
        "read",
        "anime",
        "movies",
        "anime-detail",
        "anime-stream",
        "novel",
        "novel-detail",
        "novel-read",
        "search",
        "genres",
        "top",
        "top-bookmark"
      ],
      description: "Aksi data yang ingin diambil"
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian judul (action=search/manga/anime/novel)"
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug judul komik, anime, atau novel (action=detail, read, anime-detail, anime-stream, dll)"
    },
    chapter: {
      type: "string",
      required: false,
      description: "Nomor atau slug chapter komik / novel (action=read / novel-read)"
    },
    episode: {
      type: "string",
      required: false,
      description: "Nomor episode anime (action=anime-stream)"
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Nomor halaman paginasi"
    },
    type: {
      type: "string",
      required: false,
      description: "Tipe karya (Manga, Manhwa, Manhua, TV, Movie)"
    },
    status: {
      type: "string",
      required: false,
      description: "Status rilis (Ongoing, Completed, Hiatus)"
    },
    genre: {
      type: "string",
      required: false,
      description: "Slug genre (contoh: action, isekai, romance)"
    },
    sort: {
      type: "string",
      required: false,
      enum: ["latest_update", "popular", "rating", "title"],
      default: "latest_update",
      description: "Urutan data"
    },
    category: {
      type: "string",
      required: false,
      enum: ["all", "manga", "anime", "novel"],
      default: "all",
      description: "Kategori pencarian (action=search)"
    },
    period: {
      type: "string",
      required: false,
      enum: ["daily", "weekly", "monthly", "all"],
      default: "all",
      description: "Periode waktu pemeringkatan (action=top)"
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = String(params.action || "").trim().toLowerCase();

      if (!action) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' wajib diisi: home, manga, detail, read, anime, movies, anime-detail, anime-stream, novel, novel-detail, novel-read, search, genres, top, top-bookmark"
        });
      }

      const page = parseInt(params.page) || 1;
      const targetSlug = params.slug || params.id || params.query;
      const ch = params.chapter || params.ch;
      const ep = params.episode || params.ep;

      let result;

      switch (action) {
        case "home":
        case "latest":
          result = await kc.home();
          break;

        case "manga":
        case "list":
          result = await kc.manga({
            page,
            search: params.query || params.search || "",
            sort: params.sort || "latest_update",
            type: params.type || "",
            status: params.status || "",
            genre: params.genre || "",
            minChapters: parseInt(params.minChapters) || 1
          });
          break;

        case "detail":
        case "manga-detail":
          if (!targetSlug) {
            return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi untuk action=detail" });
          }
          result = await kc.detail(targetSlug);
          break;

        case "read":
        case "manga-read":
          if (!targetSlug || ch === undefined || ch === null || ch === "") {
            return res.status(400).json({ status: false, message: "Parameter 'slug' dan 'chapter' wajib diisi untuk action=read" });
          }
          result = await kc.read(targetSlug, ch);
          break;

        case "novel":
          result = await kc.novel({
            page,
            search: params.query || params.search || "",
            sort: params.sort || "latest_update",
            status: params.status || "",
            genre: params.genre || ""
          });
          break;

        case "novel-detail":
          if (!targetSlug) {
            return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi untuk action=novel-detail" });
          }
          result = await kc.novelDetail(targetSlug);
          break;

        case "novel-read":
          if (!targetSlug || !ch) {
            return res.status(400).json({ status: false, message: "Parameter 'slug' dan 'chapter' wajib diisi untuk action=novel-read" });
          }
          result = await kc.novelRead(targetSlug, ch);
          break;

        case "anime":
          result = await kc.anime({
            page,
            search: params.query || params.search || "",
            sort: params.sort || "latest_update",
            genre: params.genre || "",
            type: params.type || "",
            status: params.status || ""
          });
          break;

        case "movies":
          result = await kc.movies({
            page,
            search: params.query || params.search || "",
            sort: params.sort || "latest_update",
            genre: params.genre || ""
          });
          break;

        case "anime-detail":
          if (!targetSlug) {
            return res.status(400).json({ status: false, message: "Parameter 'slug' wajib diisi untuk action=anime-detail" });
          }
          result = await kc.animeDetail(targetSlug);
          break;

        case "anime-stream":
          if (!targetSlug || ep === undefined || ep === null || ep === "") {
            return res.status(400).json({ status: false, message: "Parameter 'slug' dan 'episode' wajib diisi untuk action=anime-stream" });
          }
          result = await kc.animeStream(targetSlug, ep);
          break;

        case "search":
          if (!params.query) {
            return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk action=search" });
          }
          result = await kc.search(params.query, {
            category: params.category || "all",
            sort: params.sort || "popular",
            page,
            mangaType: params.type,
            mangaStatus: params.status,
            mangaGenre: params.genre,
            minChapters: parseInt(params.minChapters) || 1,
            animeType: params.type,
            animeStatus: params.status,
            animeGenre: params.genre,
            quick: params.quick === "true" || params.quick === true
          });
          break;

        case "genres":
          result = await kc.genres();
          break;

        case "top":
          result = await kc.top({
            type: params.type || "manga",
            period: params.period || "all"
          });
          break;

        case "top-bookmark":
          result = await kc.topBookmark(params.type || "manga");
          break;

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
      return res.status(500).json({
        status: false,
        message: err.message || "Internal Server Error"
      });
    }
  }
};
