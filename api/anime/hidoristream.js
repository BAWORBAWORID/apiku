#!/usr/bin/env node
/* Hidori Stream
   by: FruatreMaou
   tags: Anime
*/


/**
 * ============================================================================
 * Hidoristream Complete Scraper & Stream/Download Extractor (CommonJS)
 * Source Target: https://v10.hidoristream.online
 * ============================================================================
 *
 * ARSITEKTUR & DESAIN:
 * - CommonJS (CJS) zero external HTTP libraries: Dibuat native di atas Node.js https/http
 *   + zlib (gzip/deflate/br) dengan parsing Cheerio untuk performa cepat & hemat memori.
 * - Lazyload-aware image extraction: Otomatis membaca `data-src` / `<noscript>` untuk
 *   menghindari placeholder SVG base64.
 * - Base64 Mirror Decoder: Mendekode seluruh opsi server video (`select.mirror option`)
 *   yang di-encode Base64 menjadi iframe embed URL, direct `<video><source>` MP4, atau
 *   status ketersediaan server.
 * - Download & Batch Extractor: Mengekstrak link unduhan per resolusi (1080p, 720p, dll.)
 *   beserta nama host (GoogleDrive, AceFile, Mirrored, TeraBox, dll.) baik pada halaman
 *   episode maupun paket BATCH di halaman detail anime.
 *
 * ============================================================================
 * DAFTAR 18 FUNGSI / ENDPOINT LENGKAP:
 * ============================================================================
 * 1.  getHome(page)                     -> Beranda: Featured slider, Rilisan Terbaru, Anime Complete, Ongoing Sidebar, Populer (weekly/monthly/alltime), Blog Terbaru.
 * 2.  search(query, page)               -> Pencarian lengkap berpaginasi (/?s=...).
 * 3.  quickSearch(query)                -> Pencarian cepat AJAX live search (wp-admin/admin-ajax.php).
 * 4.  getAnimeList(options)             -> Direktori /anime/ dengan filter lengkap (genre, season, studio, status, type, sub, order, page).
 * 5.  getFilterOptions()                -> Daftar seluruh opsi filter (95 genre, 15 season, 238 studio, status, type, sub, order).
 * 6.  getListMode()                     -> Daftar lengkap seluruh anime A-Z (/anime/list-mode/).
 * 7.  getLatest(page)                   -> Shortcut rilisan update terbaru.
 * 8.  getOngoing(page)                  -> Shortcut anime ongoing.
 * 9.  getCompleted(page)                -> Shortcut anime completed.
 * 10. getUpcoming(page)                 -> Shortcut anime upcoming / segera tayang.
 * 11. getMovie(page)                    -> Shortcut anime movie.
 * 12. getSchedule()                     -> Jadwal rilis harian (/schedule/) dikelompokkan per hari.
 * 13. getByGenre(slug, page)            -> Daftar anime berdasarkan genre (/genres/<slug>/).
 * 14. getByTaxonomy(type, slug, page)   -> Daftar anime berdasarkan taksonomi (genres, season, studio, type).
 * 15. getDetail(slugOrUrl)              -> Detail lengkap anime: metadata, sinopsis, genre, daftar episode, batch download, rekomendasi.
 * 16. getEpisode(slugOrUrl)             -> Halaman nonton episode: default embed, semua mirror server (decoded Base64), download links, navigasi prev/all/next.
 * 17. getBlog(page)                     -> Daftar artikel blog (/blog/).
 * 18. getBlogDetail(slugOrUrl)          -> Detail artikel blog.
 */

'use strict';

import https from "node:https";
import http from "node:http";
import zlib from "node:zlib";
import { URL } from "node:url";
import * as cheerio from "cheerio";

const BASE_URL = 'https://v10.hidoristream.online';
const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/**
 * HTTP/HTTPS request helper with redirect, decompression, and timeout support.
 */
function request(targetUrl, options = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects for ${targetUrl}`));
  }

  const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`);
  const client = parsed.protocol === 'https:' ? https : http;
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': `${BASE_URL}/`,
    ...options.headers,
  };

  if (options.body && !headers['Content-Length']) {
    headers['Content-Length'] = Buffer.byteLength(options.body);
  }

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        timeout: options.timeout || 20000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, parsed).toString();
          res.resume();
          return resolve(request(nextUrl, options, redirectCount + 1));
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const enc = (res.headers['content-encoding'] || '').toLowerCase();

          const finish = (err, buf) => {
            if (err) return reject(err);
            resolve({
              status: res.statusCode,
              headers: res.headers,
              url: parsed.toString(),
              body: buf.toString('utf8'),
            });
          };

          if (enc === 'gzip') return zlib.gunzip(raw, finish);
          if (enc === 'deflate') return zlib.inflate(raw, finish);
          if (enc === 'br') return zlib.brotliDecompress(raw, finish);
          finish(null, raw);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout: ${targetUrl}`));
    });
    req.on('error', reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchHtml(urlOrPath) {
  const res = await request(urlOrPath);
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} fetching ${res.url}`);
  }
  return { $: cheerio.load(res.body), url: res.url };
}

function normalizeUrl(url) {
  if (!url) return null;
  let clean = url.trim();
  if (clean.startsWith('//')) clean = `https:${clean}`;
  if (clean.startsWith('http://v10.hidoristream.online')) {
    clean = clean.replace('http://', 'https://');
  }
  return clean;
}

function extractSlug(url) {
  if (!url) return null;
  try {
    const pathname = new URL(url, BASE_URL).pathname.replace(/^\/+|\/+$/g, '');
    const parts = pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return url.replace(/^\/+|\/+$/g, '');
  }
}

function resolveAnimeUrl(slugOrUrl) {
  if (!slugOrUrl) throw new Error('Anime slug or URL is required');
  if (slugOrUrl.startsWith('http')) return slugOrUrl;
  const clean = slugOrUrl.replace(/^\/+|\/+$/g, '').replace(/^anime\//, '');
  return `${BASE_URL}/anime/${clean}/`;
}

function resolvePostUrl(slugOrUrl) {
  if (!slugOrUrl) throw new Error('Episode/post slug or URL is required');
  if (slugOrUrl.startsWith('http')) return slugOrUrl;
  const clean = slugOrUrl.replace(/^\/+|\/+$/g, '');
  return `${BASE_URL}/${clean}/`;
}

function parseImgSrc($, container) {
  const img = $(container).find('img').not('noscript img').first();
  const candidates = [
    img.attr('data-src'),
    img.attr('data-lazy-src'),
    img.attr('src'),
  ];
  for (const c of candidates) {
    if (c && !c.startsWith('data:image/svg+xml')) {
      return normalizeUrl(c);
    }
  }
  const noscriptHtml = $(container).find('noscript').first().html();
  if (noscriptHtml) {
    const $ns = cheerio.load(noscriptHtml);
    const nsSrc = $ns('img').attr('src');
    if (nsSrc) return normalizeUrl(nsSrc);
  }
  return null;
}

function parseAnimeCard($, article) {
  const $a = $(article).find('.bsx > a').first();
  const url = normalizeUrl($a.attr('href'));
  const rawTitle = ($a.attr('title') || $(article).find('.tt, .eggtitle').first().text()).trim();
  const seriesTitle = $(article).find('.eggtitle').text().trim() || $(article).find('.tt').clone().children().remove().end().text().trim() || rawTitle;
  const episodeText = $(article).find('.eggepisode, .bt .epx').first().text().trim() || null;
  const epMatch = episodeText ? episodeText.match(/(\d+(?:\.\d+)?)/) : null;
  const type = $(article).find('.eggtype, .typez').first().text().trim() || null;
  const status = $(article).find('.status').first().text().trim() || null;
  const sub = $(article).find('.sb').first().text().trim() || null;
  const isHot = $(article).find('.hotbadge').length > 0;
  const postId = $a.attr('rel') || null;
  const poster = parseImgSrc($, article);

  return {
    postId,
    title: rawTitle,
    seriesTitle: seriesTitle.replace(/\s+/g, ' ').trim(),
    slug: extractSlug(url),
    url,
    poster,
    type,
    status,
    sub,
    episode: episodeText,
    episodeNumber: epMatch ? parseFloat(epMatch[1]) : null,
    isHot,
  };
}

function parsePagination($, currentPage = 1) {
  const nextHref = $('.hpage a.r, .pagination a.next').first().attr('href') || null;
  const prevHref = $('.hpage a.l, .pagination a.prev').first().attr('href') || null;

  let totalPages = null;
  $('.pagination .page-numbers').each((_, el) => {
    const n = parseInt($(el).text().trim(), 10);
    if (!Number.isNaN(n) && (totalPages === null || n > totalPages)) {
      totalPages = n;
    }
  });

  const extractPageNum = (href) => {
    if (!href) return null;
    const m1 = href.match(/\/page\/(\d+)/);
    if (m1) return parseInt(m1[1], 10);
    const m2 = href.match(/[?&]page=(\d+)/);
    if (m2) return parseInt(m2[1], 10);
    return null;
  };

  return {
    currentPage,
    totalPages,
    hasNextPage: Boolean(nextHref),
    hasPrevPage: Boolean(prevHref),
    nextPage: extractPageNum(nextHref) || (nextHref ? currentPage + 1 : null),
    prevPage: extractPageNum(prevHref) || (prevHref && currentPage > 1 ? currentPage - 1 : null),
  };
}

function parseDownloadBoxes($, root = null) {
  const scope = root ? $(root) : $.root();
  const boxes = [];

  scope.find('.soraddlx').each((_, box) => {
    const title = $(box).find('.sorattlx h3, .sorattlx').first().text().trim();
    const qualities = [];

    $(box)
      .find('.soraurlx')
      .each((_, row) => {
        const quality = $(row).find('strong').first().text().trim();
        const links = [];
        $(row)
          .find('a')
          .each((_, a) => {
            const host = $(a).text().trim();
            const href = normalizeUrl($(a).attr('href'));
            if (href) links.push({ host, url: href });
          });
        if (quality || links.length) {
          qualities.push({ quality: quality || 'Unknown', links });
        }
      });

    if (title || qualities.length) {
      boxes.push({ title, qualities });
    }
  });

  return boxes;
}

/**
 * 1. Beranda: Featured slider, Rilisan Terbaru, Anime Complete, Ongoing Sidebar, Populer, Blog.
 */
async function getHome(page = 1) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const url = pageNum > 1 ? `${BASE_URL}/page/${pageNum}/` : `${BASE_URL}/`;
  const { $ } = await fetchHtml(url);

  const featured = [];
  $('.slidtop .slide-item').each((_, el) => {
    const linkEl = $(el).find('.info-left .title a, .poster a').first();
    const itemUrl = normalizeUrl(linkEl.attr('href'));
    const title = linkEl.text().trim();
    const releaseYear = $(el).find('.release-year').text().trim() || null;
    const genres = $(el)
      .find('.extra-category a')
      .map((_, a) => $(a).text().trim())
      .get();
    const synopsis = $(el).find('.excerpt .story').text().trim() || null;
    const status = $(el).find('.cast .director').text().replace(/^Status:\s*/i, '').trim() || null;
    const type = $(el).find('.cast .actor').text().replace(/^Tipe:\s*/i, '').trim() || null;
    const poster = parseImgSrc($, $(el).find('.poster'));

    if (title && itemUrl) {
      featured.push({
        title,
        slug: extractSlug(itemUrl),
        url: itemUrl,
        poster,
        releaseYear,
        status,
        type,
        genres,
        synopsis,
      });
    }
  });

  const latestRelease = [];
  const completedLatest = [];
  const blogLatest = [];

  $('.bixbox').each((_, box) => {
    const heading = $(box).find('.releases h1, .releases h2, .releases h3, h3').first().text().trim().toLowerCase();

    if (heading.includes('rilisan terbaru')) {
      $(box)
        .find('.listupd article')
        .each((_, art) => latestRelease.push(parseAnimeCard($, art)));
    } else if (heading.includes('complete')) {
      $(box)
        .find('.listupd article')
        .each((_, art) => completedLatest.push(parseAnimeCard($, art)));
    } else if (heading.includes('blog')) {
      $(box)
        .find('article')
        .each((_, art) => {
          const a = $(art).find('h2 a, h3 a, a').first();
          const postUrl = normalizeUrl(a.attr('href'));
          blogLatest.push({
            title: a.text().trim() || $(art).find('.tt, h2, h3').first().text().trim(),
            slug: extractSlug(postUrl),
            url: postUrl,
            image: parseImgSrc($, art),
            excerpt: $(art).find('p, .entry-content').first().text().trim() || null,
          });
        });
    }
  });

  const ongoingSidebar = [];
  $('#sidebar .section').each((_, sec) => {
    const h = $(sec).find('.releases h3, h3').first().text().trim().toLowerCase();
    if (h.includes('ongoing')) {
      $(sec)
        .find('li a')
        .each((_, a) => {
          const itemUrl = normalizeUrl($(a).attr('href'));
          const title = $(a).find('.l').text().trim() || $(a).attr('title') || $(a).text().trim();
          const episode = $(a).find('.r').text().trim() || null;
          ongoingSidebar.push({
            title,
            episode,
            slug: extractSlug(itemUrl),
            url: itemUrl,
          });
        });
    }
  });

  const parseWpop = (selector) => {
    const list = [];
    $(selector)
      .find('li')
      .each((_, li) => {
        const rank = parseInt($(li).find('.ctr').text().trim(), 10) || list.length + 1;
        const a = $(li).find('h4 a.series, .leftseries a').first();
        const itemUrl = normalizeUrl(a.attr('href'));
        const genres = $(li)
          .find('.leftseries span a')
          .map((_, g) => $(g).text().trim())
          .get();
        list.push({
          rank,
          postId: a.attr('rel') || null,
          title: a.text().trim(),
          slug: extractSlug(itemUrl),
          url: itemUrl,
          poster: parseImgSrc($, li),
          genres,
        });
      });
    return list;
  };

  const popular = {
    weekly: parseWpop('.wpop-weekly'),
    monthly: parseWpop('.wpop-monthly'),
    alltime: parseWpop('.wpop-alltime'),
  };

  return {
    page: pageNum,
    pagination: parsePagination($, pageNum),
    featured,
    latestRelease,
    completedLatest,
    ongoingSidebar,
    popular,
    blogLatest,
  };
}

/**
 * 2. Pencarian penuh berpaginasi (/?s=query).
 */
async function search(query, page = 1) {
  if (!query || !String(query).trim()) {
    throw new Error('Search query is required');
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const q = encodeURIComponent(String(query).trim());
  const url = pageNum > 1 ? `${BASE_URL}/page/${pageNum}/?s=${q}` : `${BASE_URL}/?s=${q}`;
  const { $ } = await fetchHtml(url);

  const results = [];
  $('.listupd article').each((_, art) => {
    results.push(parseAnimeCard($, art));
  });

  return {
    query: String(query).trim(),
    pagination: parsePagination($, pageNum),
    results,
  };
}

/**
 * 3. Quick Search AJAX (/wp-admin/admin-ajax.php).
 */
async function quickSearch(query) {
  if (!query || !String(query).trim()) {
    throw new Error('Quick search query is required');
  }
  const body = `action=ts_ac_do_search&ts_ac_query=${encodeURIComponent(String(query).trim())}`;
  const res = await request(`${BASE_URL}/wp-admin/admin-ajax.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  });

  const data = JSON.parse(res.body);
  const rawItems = (data && data.anime && data.anime[0] && data.anime[0].all) || [];

  return rawItems.map((item) => ({
    postId: String(item.ID),
    title: item.post_title,
    slug: extractSlug(item.post_link),
    url: normalizeUrl(item.post_link),
    poster: normalizeUrl(item.post_image),
    genres: item.post_genres ? item.post_genres.split(',').map((g) => g.trim()).filter(Boolean) : [],
    type: item.post_type || null,
  }));
}

/**
 * 4. Direktori /anime/ dengan filter & paginasi.
 */
async function getAnimeList(options = {}) {
  const pageNum = Math.max(1, parseInt(options.page, 10) || 1);
  const params = new URLSearchParams();

  if (pageNum > 1) params.set('page', String(pageNum));
  if (options.status !== undefined) params.set('status', options.status);
  if (options.type !== undefined) params.set('type', options.type);
  if (options.sub !== undefined) params.set('sub', options.sub);
  if (options.order !== undefined) params.set('order', options.order);

  const appendMulti = (key, val) => {
    if (!val) return;
    const arr = Array.isArray(val) ? val : String(val).split(',').map((s) => s.trim()).filter(Boolean);
    for (const v of arr) params.append(`${key}[]`, v);
  };

  appendMulti('genre', options.genre);
  appendMulti('season', options.season);
  appendMulti('studio', options.studio);

  const qs = params.toString();
  const url = `${BASE_URL}/anime/${qs ? `?${qs}` : ''}`;
  const { $ } = await fetchHtml(url);

  const results = [];
  $('.listupd article').each((_, art) => {
    results.push(parseAnimeCard($, art));
  });

  return {
    filters: {
      status: options.status || '',
      type: options.type || '',
      sub: options.sub || '',
      order: options.order || '',
      genre: options.genre || [],
      season: options.season || [],
      studio: options.studio || [],
    },
    pagination: parsePagination($, pageNum),
    results,
  };
}

/**
 * 5. Daftar semua opsi filter dari halaman /anime/.
 */
async function getFilterOptions() {
  const { $ } = await fetchHtml(`${BASE_URL}/anime/`);
  const options = {};

  $('.advancedsearch .filter.dropdown').each((_, el) => {
    const rawLabel = $(el).find('button').first().text().trim().replace(/\s+/g, ' ');
    const key = rawLabel.split(' ')[0].toLowerCase();
    const items = [];

    $(el)
      .find('ul li')
      .each((_, li) => {
        const inp = $(li).find('input').first();
        const label = $(li).find('label').text().trim();
        const value = inp.attr('value') ?? '';
        items.push({ label, value });
      });

    options[key] = items;
  });

  return options;
}

/**
 * 6. Daftar lengkap seluruh anime A-Z (/anime/list-mode/).
 */
async function getListMode() {
  const { $ } = await fetchHtml(`${BASE_URL}/anime/list-mode/`);
  const groups = {};
  let total = 0;

  $('.blix').each((_, block) => {
    const letter = $(block).find('span a').first().text().trim() || '#';
    const items = [];
    $(block)
      .find('ul li a')
      .each((_, a) => {
        const url = normalizeUrl($(a).attr('href'));
        const title = $(a).text().trim();
        if (url && title) {
          items.push({
            title,
            slug: extractSlug(url),
            url,
          });
          total += 1;
        }
      });
    groups[letter] = items;
  });

  return { total, groups };
}

/**
 * 7-11. Shortcut kategori populer & full-page crawler.
 */
const getLatest = (page = 1) => getAnimeList({ order: 'update', page });
const getOngoing = (page = 1) => getAnimeList({ status: 'ongoing', order: 'update', page });
const getCompleted = (page = 1) => getAnimeList({ status: 'completed', order: 'update', page });
const getUpcoming = (page = 1) => getAnimeList({ status: 'upcoming', page });
const getMovie = (page = 1) => getAnimeList({ type: 'movie', order: 'update', page });
const getPopular = (page = 1) => getAnimeList({ order: 'popular', page });
const getTopRated = (page = 1) => getAnimeList({ order: 'rating', page });

/**
 * Populer mingguan, bulanan, dan sepanjang masa dari widget sidebar beranda.
 */
async function getPopularWeekly() {
  const home = await getHome(1);
  return home.popular;
}

/**
 * Crawler multi-halaman otomatis untuk mengambil seluruh halaman dari endpoint berpaginasi.
 */
async function scrapeAllPages(fetcherFn, { startPage = 1, maxPages = 50, delayMs = 150 } = {}) {
  const results = [];
  let page = Math.max(1, parseInt(startPage, 10) || 1);
  let pagesScraped = 0;
  let hasNext = true;

  while (hasNext && pagesScraped < maxPages) {
    const data = await fetcherFn(page);
    const items = data.results || data.latestRelease || data.posts || [];
    results.push(...items);
    pagesScraped += 1;

    hasNext = Boolean(data.pagination && data.pagination.hasNextPage && items.length > 0);
    if (hasNext && pagesScraped < maxPages) {
      page = data.pagination.nextPage || page + 1;
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    startPage,
    pagesScraped,
    hasMorePages: hasNext,
    totalItems: results.length,
    results,
  };
}

const getLatestAll = (opts = {}) => scrapeAllPages((p) => getLatest(p), opts);
const getOngoingAll = (opts = {}) => scrapeAllPages((p) => getOngoing(p), opts);
const getCompletedAll = (opts = {}) => scrapeAllPages((p) => getCompleted(p), opts);
const getPopularAll = (opts = {}) => scrapeAllPages((p) => getPopular(p), opts);

/**
 * 12. Jadwal rilis tayang harian (/schedule/).
 */
async function getSchedule() {
  const { $ } = await fetchHtml(`${BASE_URL}/schedule/`);
  const schedule = {};

  $('.schedulepage .bixbox, .bixbox').each((_, box) => {
    const day = $(box).find('.releases h3, h3').first().text().trim();
    const items = [];

    $(box)
      .find('.bsx')
      .each((_, bsx) => {
        const a = $(bsx).find('a').first();
        const url = normalizeUrl(a.attr('href'));
        const title = (a.attr('title') || $(bsx).find('.tt').text()).trim();
        const epx = $(bsx).find('.epx');
        const releaseTime = epx.text().trim() || null;
        const countdownRaw = epx.attr('data-cndwn');
        const episode = $(bsx).find('.sb').text().trim() || null;

        if (url && title) {
          items.push({
            title,
            slug: extractSlug(url),
            url,
            poster: parseImgSrc($, bsx),
            releaseTime,
            countdownSeconds: countdownRaw !== undefined ? parseInt(countdownRaw, 10) : null,
            episode,
          });
        }
      });

    if (day && items.length > 0) {
      schedule[day] = items;
    }
  });

  return schedule;
}

/**
 * 13-14. Taksonomi (genres, season, studio, type).
 */
async function getByTaxonomy(type, slug, page = 1) {
  if (!type || !slug) throw new Error('Taxonomy type and slug are required');
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const cleanType = type.replace(/^\/+|\/+$/g, '');
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '');
  const url =
    pageNum > 1
      ? `${BASE_URL}/${cleanType}/${cleanSlug}/page/${pageNum}/`
      : `${BASE_URL}/${cleanType}/${cleanSlug}/`;
  const { $ } = await fetchHtml(url);

  const results = [];
  $('.listupd article').each((_, art) => {
    results.push(parseAnimeCard($, art));
  });

  return {
    taxonomy: cleanType,
    slug: cleanSlug,
    title: $('.releases h1, .releases h3').first().text().trim() || cleanSlug,
    pagination: parsePagination($, pageNum),
    results,
  };
}

const getByGenre = (genreSlug, page = 1) => getByTaxonomy('genres', genreSlug, page);

/**
 * 15. Detail Anime (/anime/<slug>/).
 */
async function getDetail(slugOrUrl) {
  const targetUrl = resolveAnimeUrl(slugOrUrl);
  const { $, url } = await fetchHtml(targetUrl);

  const title = $('h1.entry-title').first().text().trim();
  const altTitle = $('.alter').first().text().trim() || null;
  const ratingText = $('.rating strong').first().text().replace(/Rating/i, '').trim() || null;
  const poster = parseImgSrc($, '.thumb');
  const synopsis = $('.entry-content[itemprop="description"], .synp .entry-content').first().text().trim() || null;

  const info = {};
  $('.infox .spe span').each((_, span) => {
    const fullText = $(span).text().trim();
    const colonIdx = fullText.indexOf(':');
    if (colonIdx !== -1) {
      const key = fullText.slice(0, colonIdx).trim();
      const val = fullText.slice(colonIdx + 1).trim();
      if (key) info[key] = val;
    }
  });

  const genres = [];
  $('.genxed a').each((_, a) => {
    const gUrl = normalizeUrl($(a).attr('href'));
    genres.push({
      name: $(a).text().trim(),
      slug: extractSlug(gUrl),
      url: gUrl,
    });
  });

  const episodes = [];
  $('.eplister ul li').each((_, li) => {
    const a = $(li).find('a').first();
    const epUrl = normalizeUrl(a.attr('href'));
    const number = $(li).find('.epl-num').text().trim() || null;
    const epTitle = $(li).find('.epl-title').text().trim() || a.text().trim();
    const date = $(li).find('.epl-date').text().trim() || null;

    if (epUrl) {
      episodes.push({
        number,
        title: epTitle,
        date,
        slug: extractSlug(epUrl),
        url: epUrl,
      });
    }
  });

  const batchDownloads = parseDownloadBoxes($);

  const recommendations = [];
  $('.bixbox .listupd article').each((_, art) => {
    recommendations.push(parseAnimeCard($, art));
  });

  return {
    title,
    altTitle,
    slug: extractSlug(url),
    url,
    poster,
    rating: ratingText,
    synopsis,
    info,
    genres,
    totalEpisodes: episodes.length,
    episodes,
    batchDownloads,
    recommendations,
  };
}

/**
 * 16. Halaman Nonton Episode (Stream mirrors + Download links).
 */
async function getEpisode(slugOrUrl) {
  const targetUrl = resolvePostUrl(slugOrUrl);
  const { $, url } = await fetchHtml(targetUrl);

  const title = $('h1.entry-title').first().text().trim();
  const defaultEmbed = normalizeUrl(
    $('#embed_holder iframe, .player-embed iframe').first().attr('src') ||
      $('#embed_holder iframe, .player-embed iframe').first().attr('data-src')
  );

  const servers = [];
  $('select.mirror option').each((_, opt) => {
    const name = $(opt).text().trim();
    const val = $(opt).attr('value');
    if (!val) return;

    let decodedHtml = '';
    try {
      decodedHtml = Buffer.from(val, 'base64').toString('utf8').trim();
    } catch {
      decodedHtml = val;
    }

    const $m = cheerio.load(decodedHtml);
    const iframeSrc = normalizeUrl($m('iframe').attr('src') || $m('iframe').attr('data-src'));
    const videoSrc = normalizeUrl($m('video source').attr('src') || $m('video').attr('src'));

    if (iframeSrc) {
      servers.push({
        name,
        available: true,
        type: 'iframe',
        url: iframeSrc,
      });
    } else if (videoSrc) {
      servers.push({
        name,
        available: true,
        type: 'video',
        url: videoSrc,
      });
    } else {
      const msg = $m.text().trim() || 'Unavailable';
      servers.push({
        name,
        available: !/not available|unavailable|error/i.test(msg),
        type: 'unavailable',
        url: null,
        message: msg,
      });
    }
  });

  const downloads = parseDownloadBoxes($);

  let prev = null;
  let all = null;
  let next = null;
  $('.naveps a').each((_, a) => {
    const href = normalizeUrl($(a).attr('href'));
    const txt = $(a).text().trim().toLowerCase();
    if (!href) return;
    if (txt.includes('prev') || $(a).attr('rel') === 'prev') {
      prev = { title: $(a).text().trim(), slug: extractSlug(href), url: href };
    } else if (txt.includes('next') || $(a).attr('rel') === 'next') {
      next = { title: $(a).text().trim(), slug: extractSlug(href), url: href };
    } else if (txt.includes('semua') || href.includes('/anime/')) {
      all = { title: $(a).text().trim(), slug: extractSlug(href), url: href };
    }
  });

  const seriesLink = $('.headpost a[href*="/anime/"], .detpost a[href*="/anime/"]').first();
  const seriesUrl = normalizeUrl(seriesLink.attr('href')) || (all ? all.url : null);

  return {
    title,
    slug: extractSlug(url),
    url,
    series: seriesUrl
      ? {
          title: seriesLink.text().trim() || null,
          slug: extractSlug(seriesUrl),
          url: seriesUrl,
        }
      : null,
    defaultEmbed,
    servers,
    downloads,
    navigation: { prev, all, next },
  };
}

/**
 * 17. Daftar Artikel Blog (/blog/).
 */
async function getBlog(page = 1) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const url = pageNum > 1 ? `${BASE_URL}/blog/page/${pageNum}/` : `${BASE_URL}/blog/`;
  const { $ } = await fetchHtml(url);

  const posts = [];
  $('article').each((_, art) => {
    const a = $(art).find('h2 a, h3 a, .tt a, a').first();
    const postUrl = normalizeUrl(a.attr('href'));
    const title = a.text().trim() || $(art).find('h2, h3, .tt').first().text().trim();
    if (postUrl && title) {
      posts.push({
        title,
        slug: extractSlug(postUrl),
        url: postUrl,
        image: parseImgSrc($, art),
        excerpt: $(art).find('p, .entry-content').first().text().trim() || null,
      });
    }
  });

  return {
    pagination: parsePagination($, pageNum),
    posts,
  };
}

/**
 * 18. Detail Artikel Blog.
 */
async function getBlogDetail(slugOrUrl) {
  let targetUrl = slugOrUrl;
  if (!slugOrUrl.startsWith('http')) {
    const clean = slugOrUrl.replace(/^\/+|\/+$/g, '').replace(/^blog\//, '');
    targetUrl = `${BASE_URL}/blog/${clean}/`;
  }
  const { $, url } = await fetchHtml(targetUrl);

  return {
    title: $('h1.entry-title').first().text().trim(),
    slug: extractSlug(url),
    url,
    date: $('.updated, .post-date, time').first().text().trim() || null,
    contentText: $('.entry-content').first().text().trim(),
    contentHtml: $('.entry-content').first().html(),
  };
}

// ============================================================================
// CLI RUNNER
// ============================================================================


export default {
  name: "Hidori Stream Anime Scraper",
  description: "Scraper anime lengkap dari v10.hidoristream.online (home, search, anime list, detail, episode stream & download)",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "page", "slug", "status", "type", "order", "genre", "season", "studio"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      description: "Aksi scraper: home, search, list, detail, episode, schedule, genres, quicksearch",
      default: "home"
    },
    query: { type: "string", required: false, description: "Kata kunci pencarian anime" },
    page: { type: "number", required: false, description: "Nomor halaman pagination", default: 1 },
    slug: { type: "string", required: false, description: "Slug anime atau episode (untuk detail/episode)" }
  },

  async run(req, res) {
    const action = (req.query.action || req.body?.action || "home").toLowerCase();
    const query = req.query.query || req.body?.query || "";
    const page = parseInt(req.query.page || req.body?.page || 1, 10);
    const slug = req.query.slug || req.body?.slug || "";

    try {
      let data = null;
      switch (action) {
        case "home":
          data = await getHome(page);
          break;
        case "search":
          if (!query) return res.status(400).json({ status: false, error: "Parameter query diperlukan untuk search" });
          data = await search(query, page);
          break;
        case "quicksearch":
          if (!query) return res.status(400).json({ status: false, error: "Parameter query diperlukan untuk quicksearch" });
          data = await quickSearch(query);
          break;
        case "list":
        case "anime":
          data = await getAnimeList({
            page,
            status: req.query.status || req.body?.status,
            type: req.query.type || req.body?.type,
            order: req.query.order || req.body?.order,
            genre: req.query.genre || req.body?.genre,
            season: req.query.season || req.body?.season,
            studio: req.query.studio || req.body?.studio
          });
          break;
        case "filters":
          data = await getFilterOptions();
          break;
        case "schedule":
          data = await getSchedule();
          break;
        case "detail":
          if (!slug) return res.status(400).json({ status: false, error: "Parameter slug diperlukan untuk detail" });
          data = await getDetail(slug);
          break;
        case "episode":
        case "stream":
          if (!slug) return res.status(400).json({ status: false, error: "Parameter slug (episode url/slug) diperlukan untuk episode" });
          data = await getEpisode(slug);
          break;
        case "blog":
          data = await getBlog(page);
          break;
        default:
          data = await getHome(page);
          break;
      }

      return res.json({
        status: true,
        action,
        result: data,
        attribution: "@zyvorapi"
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        action,
        error: err.message
      });
    }
  }
};
