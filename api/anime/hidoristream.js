#!/usr/bin/env node
'use strict';

/**
 * © JAMVANHAX0R — FIONY BOT
 * HAPUS CREDIT GAK BIKIN U JAGO DUMBASS. 
 * HARGAI SEBAGAIMANA U MAU DIHARGAI.
 * HIDORISTREAM.JS — HIDORISTREAM SCRAPER FULL MODE BY JH A.K.A DHIKA
 */

import fs from 'node:fs';
import * as cheerio from 'cheerio';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const VERSION = '1.0.0';
const G = {
  base: '',
  ua: '',
  cookie: '',
  timeout: 30000,
  retries: 2,
  delay: 300,
  debug: false,
  json: false,
  cache: false,
  ttl: 600,
  cacheDir: path.join(os.homedir(), '.cache', 'hidoristream-cli'),
  debugDir: path.join(process.cwd(), 'hidoristream-debug'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (...a) => G.debug && console.error('\x1b[90m[dbg]', ...a, '\x1b[0m');
const isTTY = Boolean(process.stdout.isTTY);
const useColor = isTTY && !process.env.NO_COLOR;
const fg256 = (n) => (s) => (useColor ? `\x1b[38;5;${n}m${s}\x1b[39m` : String(s));
const sgr = (on, off) => (s) => (useColor ? `\x1b[${on}m${s}\x1b[${off}m` : String(s));
const bold = sgr(1, 22);
const dim = fg256(245);
const cyan = fg256(51);
const green = fg256(84);
const yellow = fg256(221);
const red = fg256(203);
const pink = fg256(213);
const purple = fg256(141);
const orange = fg256(215);
const blue = fg256(75);
const mint = fg256(121);
const gold = fg256(220);
const chip = (bgc, fgc = 16) => (s) => (useColor ? `\x1b[48;5;${bgc};38;5;${fgc}m ${s} \x1b[0m` : `[${s}]`);
const GRAD = [213, 177, 141, 105, 69, 75, 81, 87];
const gradient = (text, stops = GRAD) => {
  if (!useColor) return String(text);
  const chars = [...String(text)];
  return chars.map((ch, i) => `\x1b[38;5;${stops[Math.floor((i / chars.length) * stops.length)]}m${ch}`).join('') + '\x1b[0m';
};
const QCOL = { '1080p': 213, '720p': 141, '480p': 75, '360p': 84, '240p': 221 };
const qNorm = (q) => (q ? String(q).toLowerCase().replace(/\s+/g, '') : null);
const qBadge = (q) => {
  const n = qNorm(q);
  return (useColor ? `\x1b[48;5;${QCOL[n] || 245};38;5;16m ${n || '-'} \x1b[0m` : `[${n || '-'}]`);
};
const statusTag = (st) => {
  if (!st) return '';
  const s = String(st).toLowerCase();
  if (/ongoing/.test(s)) return green('● ' + st);
  if (/completed/.test(s)) return blue('● ' + st);
  return yellow('● ' + st);
};
const kv = (k, v) => console.log(`${pink(String(k).padEnd(13))} ${v}`);
const heading = (t) => console.log(`\n${pink('◆')} ${bold(t)}`);
const PAL = [213, 177, 141, 105, 75, 81, 87, 121, 156, 221, 215];
const lim = (o, d) => Math.max(1, parseInt(o.limit, 10) || d);

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const stripTags = (s) =>
  decodeEntities(String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const _sd1 = 'e0e9a05fc0d570a42af337';

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function bail() {
  process.stderr.write('\n\x1b[38;5;203m✘ FATAL: segel watermark rusak. Credit asli (author_skrep / kesayangan / header) tidak boleh diubah atau dihapus.\x1b[0m\n');
  process.exit(1);
}

const BANNER_TEXT = 'HIDORISTREAM SCRAPER BY JH A.K.A DHIKA — FIONY BOT';

const _c1 = 'LFAu2R9tuJgL4tlJfsf1eplhBfpXmAgg2IXHH7BSfSWcwFHObiQn6qtuMjya96ii7qJNnzyf4Qgrbvsa4FEoidYIe+OyMhVzA3h';

function unlock(parts, material) {
  verify();
  try {
    const key = crypto.createHash('sha256').update(material).digest();
    const raw = Buffer.from(parts.join(''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return bail();
  }
}

function saveDebug(name, content) {
  try {
    fs.mkdirSync(G.debugDir, { recursive: true });
    const f = path.join(G.debugDir, name);
    fs.writeFileSync(f, content);
    return f;
  } catch {
    return null;
  }
}

const _c2 = 'yunsh77JKI63JN6hbD76bU341WAlQQMU2PHVQH+Z+x8+6SDARlKqlEdwC4H9Or9Kvhiug6Vh+or2x8Oi9SOnSbgfJ4cCEgfXGG/';

let memoC = null;
function creds() {
  return memoC || (memoC = unlock([_c1, _c2, _c3], 'C\u0000' + baseRes.author_skrep));
}
const baseUrl = () => G.base || creds().base;
const abs = (u) => {
  try {
    return new URL(u, baseUrl()).href;
  } catch {
    return u;
  }
};

function normalizeSlug(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Slug/URL kosong.');
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch {}
  s = s.replace(/^\/+|\/+$/g, '');
  if (s.startsWith('anime/')) s = s.slice(6);
  return s.split('/').pop();
}
const detailUrl = (slug) => abs(`/anime/${slug}/`);
const episodeUrl = (slug) => abs(`/${slug}/`);

class CfError extends Error {}
function isChallenge(status, text) {
  return [403, 429, 503].includes(status) && /just a moment|cf-chl|challenge-platform|attention required/i.test(text || '');
}

const _u1 = '__U1__';

let lastReqAt = 0;
async function request(url, o = {}) {
  verify();
  url = String(url);
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const cacheFile = path.join(G.cacheDir, key + '.html');
  const useCache = false; // cache dinonaktifkan
  if (useCache) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - cached.t < G.ttl * 1000) {
        dbg('cache hit', url);
        return { ...cached, fromCache: true };
      }
    } catch {}
  }

  const headers = {
    'user-agent': G.ua || creds().ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'id-ID,id;q=0.9',
    'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'upgrade-insecure-requests': '1',
    referer: o.referer || baseUrl() + '/',
    ...(G.cookie ? { cookie: G.cookie } : {}),
  };

  for (let attempt = 0; ; attempt++) {
    const wait = G.delay - (Date.now() - lastReqAt);
    if (wait > 0) await sleep(wait);
    lastReqAt = Date.now();
    const t0 = Date.now();
    let res, text;
    try {
      res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(G.timeout) });
      text = await res.text();
    } catch (e) {
      dbg('network error', e.cause?.code || e.message);
      if (attempt < G.retries) {
        await sleep(600 * 2 ** attempt);
        continue;
      }
      throw new Error(`Gagal konek ke ${url} (${e.cause?.code || e.message})`);
    }
    dbg(`${res.status} ${url} ${text.length}B ${Date.now() - t0}ms`);
    if (isChallenge(res.status, text)) {
      const f = saveDebug('cloudflare-challenge.html', text);
      throw new CfError(`Kena challenge Cloudflare (bukan error parsing).\n  Coba: --ua "<UA browser lo>", --cookie "cf_clearance=...; ...", atau turunin kecepatan: --delay 1500. ${f ? 'Body disimpan: ' + f : ''}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < G.retries) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const out = { t: Date.now(), status: res.status, url: res.url || url, text };
    if (useCache && res.status === 200) {
      try {
        fs.mkdirSync(G.cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(out));
      } catch {}
    }
    return out;
  }
}

function expectOk(res, what) {
  if (res.status === 404) throw new Error(`${what}: 404 tidak ditemukan.`);
  if (res.status !== 200) throw new Error(`${what}: HTTP ${res.status}`);
}

const _sd2 = 'a83d247ab8ef5383bdbeb1';

function parseCardsEgg(html) {
  const out = [];
  const re = /<article\b[^>]*class="[^"]*\bbs styleegg\b[^"]*"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const blk = m[0];
    const a = /<a\s+href="([^"]+)"[^>]*title="([^"]*)"/.exec(blk);
    if (!a) continue;
    const img = /<noscript><img\s+src="([^"]+)"/.exec(blk);
    const eggTitle = /<div class="eggtitle">([^<]*)<\/div>/.exec(blk);
    const eggType = /<div class="eggtype\s*([^"]*)">([^<]*)<\/div>/.exec(blk);
    const eggEp = /<div class="eggepisode">([^<]*)<\/div>/.exec(blk);
    out.push({
      kind: 'episode',
      slug: normalizeSlug(a[1]),
      title: eggTitle ? decodeEntities(eggTitle[1]).trim() : decodeEntities(a[2]),
      episodeTitle: decodeEntities(a[2]),
      url: abs(a[1]),
      type: eggType ? eggType[2].trim() : null,
      episodeLabel: eggEp ? decodeEntities(eggEp[1]).trim() : null,
      poster: img ? abs(img[1]) : null,
    });
  }
  return out;
}

function parseCardsPlain(html) {
  const out = [];
  const re = /<article\b[^>]*class="[^"]*\bbs\b(?![^"]*styleegg)[^"]*"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const blk = m[0];
    const a = /<a\s+href="([^"]+)"[^>]*title="([^"]*)"/.exec(blk);
    if (!a) continue;
    const img = /<noscript><img\s+src="([^"]+)"/.exec(blk);
    const typez = /class="typez\s+([^"]*)"/.exec(blk);
    const epx = /<span class="epx">([^<]*)<\/span>/.exec(blk);
    out.push({
      kind: 'series',
      slug: normalizeSlug(a[1]),
      title: decodeEntities(a[2]),
      url: abs(a[1]),
      type: typez ? typez[1].trim() : null,
      status: epx ? decodeEntities(epx[1]).trim() : null,
      poster: img ? abs(img[1]) : null,
    });
  }
  return out;
}

function parseCardList(html) {
  return [...parseCardsPlain(html), ...parseCardsEgg(html)];
}

function labelFor(headings, pos) {
  let label = null;
  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].pos < pos) {
      label = headings[i].label;
      break;
    }
  }
  return label;
}

function positionsOf(html, re2) {
  const out = [];
  re2.lastIndex = 0;
  let mm;
  while ((mm = re2.exec(html))) out.push(mm.index);
  return out;
}

function parseHomeSections(html) {
  const headings = [];
  const re = /<h3>([^<]{2,80})<\/h3>/g;
  let m;
  while ((m = re.exec(html))) headings.push({ pos: m.index, label: decodeEntities(m[1]).trim() });

  const eggItems = parseCardsEgg(html);
  const plainItems = parseCardsPlain(html);
  const eggPos = positionsOf(html, /<article\b[^>]*class="[^"]*\bbs styleegg\b[^"]*"/g);
  const plainPos = positionsOf(html, /<article\b[^>]*class="[^"]*\bbs\b(?![^"]*styleegg)[^"]*"/g);

  const bySection = new Map();
  const put = (item, pos) => {
    const key = labelFor(headings, pos) || '(tanpa judul section)';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(item);
  };
  eggItems.forEach((item, i) => put(item, eggPos[i] ?? 0));
  plainItems.forEach((item, i) => put(item, plainPos[i] ?? 0));

  return [...bySection.entries()].map(([label, items]) => ({ label, items }));
}

async function fetchList(pathname, params) {
  const u = new URL(pathname, baseUrl());
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  const res = await request(u.href);
  expectOk(res, u.pathname);
  const cards = parseCardList(res.text);
  if (!cards.length) {
    const f = saveDebug(`list-empty-${u.pathname.replace(/\W+/g, '_')}.txt`, res.text);
    process.stderr.write(yellow(`! 0 kartu terparse dari ${u.pathname}. Respon mentah disimpan: ${f}\n`));
  }
  return { cards, source: u.href };
}

const _c3 = '3Gkhy/1dbpCOAgn8xjiEcqy4JX5YBGpD0nNmEg3IZwF4Z4MSLe7BRS+uUkUtTXXo0/y1C1x8pfo/wRwZ5HazHH5CD83r8RPA==';

function sliceBetween(html, startRe, endRe) {
  const s = startRe.exec(html);
  if (!s) return null;
  const from = s.index + s[0].length;
  endRe.lastIndex = from;
  const e = endRe.exec(html);
  return html.slice(from, e ? e.index : html.length);
}

function parseSpeInfo(html) {
  const seg = sliceBetween(html, /<div class="spe">/, /<div class="genxed">/g);
  if (!seg) return {};
  const info = {};
  const re = /<span[^>]*>\s*<b>([^<:]+):?<\/b>\s*([\s\S]*?)<\/span>/g;
  let m;
  let airedSeen = false;
  while ((m = re.exec(seg))) {
    const k = m[1].trim().toLowerCase();
    const raw = m[2];
    if (k === 'dirilis' && !airedSeen && !/<time/.test(raw)) {
      info.aired = stripTags(raw);
      airedSeen = true;
      continue;
    }
    if (k === 'casts') continue;
    const v = stripTags(raw);
    if (v && !(k in info)) info[k] = v;
  }
  const pub = /<time\s+itemprop="datePublished"[^>]*>([^<]*)<\/time>/.exec(seg);
  const upd = /<time\s+itemprop="dateModified"[^>]*>([^<]*)<\/time>/.exec(seg);
  if (pub) info.postedOn = decodeEntities(pub[1]).trim();
  if (upd) info.updatedOn = decodeEntities(upd[1]).trim();
  const castRe = /<a\s+class="casts"[^>]*>([^<]+)<\/a>/g;
  const casts = [];
  let cm;
  while ((cm = castRe.exec(seg))) casts.push(decodeEntities(cm[1]).trim());
  if (casts.length) info.castsList = casts;
  return info;
}

function parseGenres(html) {
  const seg = sliceBetween(html, /<div class="genxed">/, /<div class="desc">|<\/div>\s*<\/div>\s*<\/div>/g);
  if (!seg) return [];
  const out = [];
  const re = /<a[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(seg))) out.push(decodeEntities(m[1]).trim());
  return out;
}

function parseSynopsis(html) {
  const m = /<div class="desc">\s*([\s\S]*?)\s*<\/div>/.exec(html);
  return m ? stripTags(m[1]) || null : null;
}

function parseEpisodeList(html) {
  const seg = sliceBetween(html, /<div class="eplister">/, /<\/ul>/g);
  if (!seg) return [];
  const items = seg.split(/<li\s+data-index="\d+">/).slice(1);
  return items
    .map((chunk) => {
      const href = /<a\s+href="([^"]+)"/.exec(chunk);
      const num = /<div class="epl-num">([^<]*)<\/div>/.exec(chunk);
      const title = /<div class="epl-title">([^<]*)<\/div>/.exec(chunk);
      const date = /<div class="epl-date">([^<]*)<\/div>/.exec(chunk);
      if (!href) return null;
      return {
        episodeId: normalizeSlug(href[1]),
        url: abs(href[1]),
        number: num ? decodeEntities(num[1]).trim() : null,
        title: title ? decodeEntities(title[1]).trim() : null,
        date: date ? decodeEntities(date[1]).trim() : null,
      };
    })
    .filter(Boolean);
}

const _sd3 = '8bd71897ee96c6f149ab';

function parseDetail(html, slugHint) {
  const titleM = /<h1\s+class="entry-title"[^>]*>([^<]*)<\/h1>/.exec(html);
  const title = titleM ? decodeEntities(titleM[1]).trim() : slugHint;
  const alterM = /<span class="alter">([^<]*)<\/span>/.exec(html);
  const bmcM = /<div class="bmc">([^<]*)<\/div>/.exec(html);
  const posterM = /<div class="thumb"[^>]*>[\s\S]*?<noscript><img\s+src="([^"]+)"/.exec(html);
  const info = parseSpeInfo(html);

  return {
    slug: slugHint,
    url: detailUrl(slugHint),
    title,
    nativeTitle: alterM ? decodeEntities(alterM[1]).trim() || null : null,
    poster: posterM ? abs(posterM[1]) : null,
    status: info['status'] || null,
    type: info['tipe'] || null,
    studio: info['studio'] || null,
    director: info['director'] || null,
    casts: info['castsList'] || [],
    aired: info['aired'] || null,
    season: info['season'] || null,
    postedOn: info['postedOn'] || null,
    updatedOn: info['updatedOn'] || null,
    followers: bmcM ? bmcM[1].trim() : null,
    genres: parseGenres(html),
    synopsis: parseSynopsis(html),
    episodes: parseEpisodeList(html),
  };
}

const detailCache = new Map();
async function fetchDetail(slugOrUrl) {
  const slug = normalizeSlug(slugOrUrl);
  if (detailCache.has(slug)) return detailCache.get(slug);
  const res = await request(detailUrl(slug));
  expectOk(res, `Detail /anime/${slug}/`);
  const d = parseDetail(res.text, slug);
  if (!d.episodes.length && !d.synopsis) {
    const f = saveDebug(`detail-${slug}.html`, res.text);
    process.stderr.write(yellow(`! Parser tidak nemu episode/sinopsis. HTML disimpan: ${f}\n`));
  }
  detailCache.set(slug, d);
  return d;
}

const _u2 = '__U2__';

function decodeB64Html(b64) {
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
function extractSrc(html) {
  if (!html) return null;
  const m = /\bsrc=["']([^"']+)["']/i.exec(html);
  return m ? abs(m[1]) : null;
}

function parseMirrors(html) {
  const seg = sliceBetween(html, /<select class="mirror"/, /<\/select>/g);
  if (!seg) return [];
  const out = [];
  const re = /<option value="([^"]*)"\s+data-index="(\d+)">\s*([^<]*?)\s*<\/option>/g;
  let m;
  while ((m = re.exec(seg))) {
    const [, b64, idx, label] = m;
    if (!b64) continue;
    const decoded = decodeB64Html(b64);
    const embedUrl = extractSrc(decoded);
    out.push({ index: +idx, label: decodeEntities(label).trim(), embedUrl, hasMedia: !!embedUrl, raw: G.debug ? decoded : undefined });
  }
  return out;
}

function parseDefaultEmbed(html) {
  const seg = sliceBetween(html, /<div class="player-embed"[^>]*>/, /<\/div>\s*<\/div>/g);
  return seg ? extractSrc(seg) : null;
}

const HOST_LABEL_HINTS = {
  'teledrive': 'Telegram (butuh app Telegram, bukan link HTTP biasa)',
};
function describeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function parseDownloads(html) {
  const startM = /<div class="mctnx">/.exec(html);
  const seg = startM ? html.slice(startM.index + startM[0].length) : html;
  const groups = [];
  let current = null;
  const re = /<div class="sorattlx"><h3>([^<]*)<\/h3><\/div>|<div class="soraurlx">\s*<strong>([^<]*)<\/strong>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(seg))) {
    if (m[1] !== undefined) {
      current = { title: decodeEntities(m[1]).trim(), qualities: [] };
      groups.push(current);
    } else if (current) {
      const quality = decodeEntities(m[2]).trim();
      const links = [];
      const are = /<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g;
      let am;
      while ((am = are.exec(m[3]))) {
        const url = am[1];
        const label = decodeEntities(am[2]).trim();
        const host = describeHost(url);
        const labelKey = label.toLowerCase();
        links.push({ label, url, host, note: HOST_LABEL_HINTS[labelKey] || null });
      }
      current.qualities.push({ quality, links });
    }
  }
  const flat = groups.flatMap((g) => g.qualities);
  const seenHosts = new Map();
  for (const q of flat)
    for (const l of q.links) {
      if (!l.host) continue;
      if (!seenHosts.has(l.host)) seenHosts.set(l.host, new Set());
      seenHosts.get(l.host).add(l.label.toLowerCase());
    }
  for (const q of flat)
    for (const l of q.links) {
      const labelsForHost = l.host ? seenHosts.get(l.host) : null;
      l.sharedHostWithOtherLabels = !!(labelsForHost && labelsForHost.size > 1);
    }
  return groups;
}

function parseEpisodePage(html, idHint) {
  const titleM = /<h1\s+class="entry-title"[^>]*>([^<]*)<\/h1>/.exec(html);
  const epNumM = /<meta itemprop="episodeNumber" content="([^"]*)">/.exec(html);
  const releasedM = /Dirilis pada <span class="updated">([^<]*)<\/span>/.exec(html);
  const seriesM = /series <a href="([^"]+)">([^<]*)<\/a>/.exec(html);
  const prevM = /<div class="nvs"><a aria-label="prev" href="([^"]+)"/.exec(html);
  const nextM = /<div class="nvs"><a aria-label="next" href="([^"]+)"/.exec(html);
  const ratingM = /<div class="rating">\s*<strong>Rating\s*([\d.]+)<\/strong>/.exec(html);

  return {
    episodeId: idHint,
    url: episodeUrl(idHint),
    title: titleM ? decodeEntities(titleM[1]).trim() : idHint,
    episodeNumber: epNumM ? epNumM[1] : null,
    releasedOn: releasedM ? releasedM[1].trim() : null,
    series: seriesM ? { slug: normalizeSlug(seriesM[1]), url: abs(seriesM[1]), title: decodeEntities(seriesM[2]).trim() } : null,
    seriesRating: ratingM ? parseFloat(ratingM[1]) : null,
    defaultEmbedUrl: parseDefaultEmbed(html),
    mirrors: parseMirrors(html),
    downloads: parseDownloads(html),
    prevEpisode: prevM ? normalizeSlug(prevM[1]) : null,
    nextEpisode: nextM ? normalizeSlug(nextM[1]) : null,
  };
}

const episodeCache = new Map();
async function fetchEpisode(slugOrUrl, referer) {
  const id = normalizeSlug(slugOrUrl);
  if (episodeCache.has(id)) return episodeCache.get(id);
  const res = await request(episodeUrl(id), { referer });
  expectOk(res, `Episode /${id}/`);
  const d = parseEpisodePage(res.text, id);
  if (!d.mirrors.length && !d.defaultEmbedUrl && !d.downloads.length) {
    const f = saveDebug(`episode-${id}.html`, res.text);
    process.stderr.write(yellow(`! Parser tidak nemu video/mirror/download. HTML disimpan: ${f}\n`));
  }
  episodeCache.set(id, d);
  return d;
}

const _u3 = '__U3__';

function verify() {
  // integrity check dinonaktifkan (di-restore dari source asli saat runtime)
}

let srcCache = null;

const baseRes = { status: true, author_skrep: 'JH a.k.a Dhika', kesayangan: 'Fiony Alveria♡', data: {} };
Object.freeze(baseRes.data);
Object.freeze(baseRes);

function wrap(ok, data, extra) {
  verify();
  const out = { status: ok, data: data === undefined ? {} : data, ...(extra || {}) };
  return out;
}
const emit = (ok, data, extra) => console.log(JSON.stringify(wrap(ok, data, extra), null, 2));
function emitErr(message) {
  if (G.json) return emit(false, {}, { message });
  console.log(red('✘ ' + message));
}

function banner() {
  const l1 = BANNER_TEXT;
  const l2 = `✦ ${baseRes.author_skrep}   ${baseRes.kesayangan}`;
  const l3 = `v${VERSION} · native Node.js · zero dependency`;
  const iw = Math.max(...[l1, l2, l3].map((x) => [...x].length)) + 6;
  const row = (plain, colored) => pink('│') + '   ' + colored + ' '.repeat(Math.max(0, iw - 3 - [...plain].length)) + pink('│');
  return [pink('╭' + '─'.repeat(iw) + '╮'), row(l1, gradient(l1)), row(l2, `${gold('✦ ' + baseRes.author_skrep)}   ${pink(baseRes.kesayangan)}`), row(l3, dim(l3)), pink('╰' + '─'.repeat(iw) + '╯')].join('\n');
}
const credit = () => `${dim('────')} ${gradient('✦ ' + baseRes.author_skrep)} ${dim('·')} ${pink(baseRes.kesayangan)} ${dim('────')}`;

const _ck = 2169843389;

function printCards(items, opt) {
  if (opt.json) return emit(true, items);
  if (!items.length) return console.log(yellow('Tidak ada hasil.'));
  items.forEach((a, i) => {
    const bits = [
      a.type ? purple(a.type) : null,
      a.kind === 'series' ? statusTag(a.status) || null : null,
      a.episodeLabel ? cyan(a.episodeLabel) : null,
    ].filter(Boolean).join(dim(' · '));
    console.log(`${dim(String(i + 1).padStart(2) + '.')} ${bold(a.title)}`);
    if (bits) console.log(`    ${bits}`);
    console.log(`    ${dim('↳')} ${cyan(a.slug)} ${dim('(' + a.kind + ')')}\n`);
  });
}

async function cmdHome({ opt }) {
  const res = await request(baseUrl() + '/');
  expectOk(res, '/');
  const sections = parseHomeSections(res.text);
  const wanted = sections.filter((s) => /rilisan terbaru|complete terbaru|terbaru/i.test(s.label));
  const shown = wanted.length ? wanted : sections;
  if (opt.json) return emit(true, shown);
  if (!shown.length) {
    const f = saveDebug('home-empty.html', res.text);
    return emitErr(`Tidak ada section terparse. Dump: ${f}`);
  }
  for (const sec of shown) {
    heading((sec.label || '(tanpa judul)').toUpperCase());
    printCards(sec.items.slice(0, lim(opt, 8)), { json: false });
  }
}

async function cmdSearch({ pos, opt }) {
  const q = pos.join(' ').trim();
  if (!q) throw new Error('Pakai: search <kata>');
  const page = parseInt(opt.page, 10);
  const pathn = page > 1 ? `/page/${page}/` : '/';
  const r = await fetchList(pathn, { s: q });
  if (opt.json) return emit(true, { query: q, page: page || 1, results: r.cards });
  console.log(`${pink('✦')} ${bold(r.cards.length)} ${dim('hasil untuk')} ${bold('"' + q + '"')}\n`);
  printCards(r.cards, opt);
}

async function cmdGenre({ pos, opt }) {
  const slug = pos[0];
  if (!slug) throw new Error('Pakai: genre <genre-slug>  [experimental, belum diverifikasi di live]');
  const page = parseInt(opt.page, 10);
  const base = `/genres/${slug.toLowerCase().replace(/\s+/g, '-')}/`;
  const r = await fetchList(page > 1 ? base + `page/${page}/` : base);
  if (opt.json) return emit(true, r.cards);
  printCards(r.cards, opt);
}

function printEpisodeList(eps, opt) {
  for (const ep of eps.slice(0, opt.limit ? +opt.limit : undefined)) {
    console.log(`${gold(String(ep.number || '?').padStart(5))}  ${(ep.title || '').slice(0, 55).padEnd(55)}  ${dim(ep.date || '')}`);
    console.log(`       ${dim('↳')} ${cyan(ep.episodeId)}`);
  }
}

async function cmdDetail({ pos, opt }) {
  if (!pos[0]) throw new Error('Pakai: detail <slug|url>');
  const d = await fetchDetail(pos[0]);
  if (opt.json) {
    const { episodes, ...rest } = d;
    return emit(true, { ...rest, episodeCount: episodes.length });
  }
  console.log(gradient(d.title));
  if (d.nativeTitle) console.log(dim(d.nativeTitle));
  console.log([d.type ? purple(d.type) : null, statusTag(d.status) || null, d.season ? orange(d.season) : null, d.studio ? orange(d.studio) : null, d.director ? dim('dir. ' + d.director) : null].filter(Boolean).join(dim(' · ')));
  console.log('');
  if (d.followers) kv('Followers', mint(d.followers));
  if (d.aired) kv('Dirilis', d.aired);
  if (d.postedOn) kv('Diposting', d.postedOn);
  if (d.updatedOn) kv('Diperbarui', d.updatedOn);
  if (d.casts.length) kv('Cast', d.casts.slice(0, 6).join(', ') + (d.casts.length > 6 ? dim(` +${d.casts.length - 6} lagi`) : ''));
  if (d.genres.length) kv('Genre', d.genres.map((g, i) => fg256(PAL[i % PAL.length])(g)).join(dim(' · ')));
  if (d.poster) kv('Poster', cyan(d.poster));
  if (d.synopsis) {
    heading('SINOPSIS');
    console.log(d.synopsis);
  }
  heading(`EPISODES (${d.episodes.length})`);
  printEpisodeList(d.episodes, { limit: opt.limit || 10 });
  if (d.episodes.length > (opt.limit || 10)) console.log(dim(`\n  ... +${d.episodes.length - (opt.limit || 10)} lagi (node hidoristream.js episodes ${d.slug} --limit 999)`));
}

async function cmdEpisodes({ pos, opt }) {
  if (!pos[0]) throw new Error('Pakai: episodes <slug|url>');
  const d = await fetchDetail(pos[0]);
  if (opt.json) return emit(true, { slug: d.slug, title: d.title, total: d.episodes.length, episodes: d.episodes });
  console.log(`${gradient(d.title)} ${dim('— ' + d.episodes.length + ' episode')}\n`);
  printEpisodeList(d.episodes, opt);
  console.log(dim(`\nstream: node hidoristream.js stream ${d.episodes[d.episodes.length - 1]?.episodeId || '<episode-id>'}`));
}

function printStream(d) {
  if (d.series) console.log(dim(`series: ${d.series.title} [${d.series.slug}]${d.seriesRating != null ? '  rating: ' + d.seriesRating : ''}`));
  console.log(gradient(d.title));
  console.log([d.episodeNumber ? cyan('Ep ' + d.episodeNumber) : null, d.releasedOn ? dim(d.releasedOn) : null].filter(Boolean).join(dim(' · ')));

  if (d.defaultEmbedUrl) {
    heading('🎬 DEFAULT PLAYER');
    console.log(`  ${cyan(d.defaultEmbedUrl)}`);
  }
  if (d.mirrors.length) {
    heading(`📡 MIRROR (${d.mirrors.length})`);
    for (const m of d.mirrors) {
      if (m.hasMedia) console.log(`  ${bold(m.label)}  ${cyan(m.embedUrl)}`);
      else console.log(`  ${bold(m.label)}  ${red('(tidak ada media — kemungkinan placeholder/iklan/error)')}`);
    }
  }
  if (d.downloads.length) {
    heading('📥 DOWNLOAD');
    for (const grp of d.downloads) {
      for (const q of grp.qualities) {
        console.log(`  ${qBadge(q.quality)} ${dim('(' + q.links.length + ' link)')}`);
        if (!q.links.length) console.log(`    ${dim('(kosong, tidak ada link untuk kualitas ini)')}`);
        q.links.forEach((l) => {
          const warn = l.sharedHostWithOtherLabels ? yellow(' ⚠ host sama dipakai label lain') : '';
          console.log(`    ${cyan(l.label.padEnd(12))} ${dim('→')} ${l.url} ${dim('[' + l.host + ']')}${warn}`);
          if (l.note) console.log(`      ${dim(l.note)}`);
        });
      }
    }
  }
  console.log('');
  if (d.prevEpisode) console.log(dim('  ⏮ Prev: ') + cyan(d.prevEpisode));
  if (d.nextEpisode) console.log(dim('  ⏭ Next: ') + cyan(d.nextEpisode));
}

async function cmdStream({ pos, opt }) {
  const id = pos[0];
  if (!id) throw new Error('Pakai: stream <episode-slug|url>');
  const d = await fetchEpisode(id);
  if (opt.json) return emit(true, d);
  printStream(d);
}

async function cmdProbe({ pos }) {
  const q = pos.join(' ') || 'Ao Ashi';
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      console.log(`${green('✔')} ${name} ${dim(Date.now() - t0 + 'ms')} ${out || ''}`);
      return true;
    } catch (e) {
      console.log(`${red('✘')} ${name}: ${e.message}`);
      return false;
    }
  };
  console.log(gradient('hidoristream probe') + dim(` node ${process.version} · ${baseUrl()}`));

  await step('GET / (homepage)', async () => {
    const r = await request(baseUrl() + '/', { noCache: true });
    const sections = parseHomeSections(r.text);
    return `HTTP ${r.status} · ${sections.length} section (${sections.map((s) => s.label).join(', ')})`;
  });

  let firstSlug;
  await step(`search "${q}"`, async () => {
    const r = await fetchList('/', { s: q });
    if (!r.cards.length) throw new Error('0 hasil');
    firstSlug = r.cards.find((c) => c.kind === 'series')?.slug || r.cards[0].slug;
    return `${r.cards.length} hasil · pertama: ${r.cards[0].title} (${firstSlug})`;
  });

  let firstEp;
  if (firstSlug) {
    await step(`detail ${firstSlug}`, async () => {
      const d = await fetchDetail(firstSlug);
      firstEp = d.episodes[0]?.episodeId;
      return `${d.title} · ${d.type} · ${d.status} · ${d.episodes.length} episode`;
    });
  }
  if (firstEp) {
    await step(`stream ${firstEp}`, async () => {
      const d = await fetchEpisode(firstEp);
      return `${d.mirrors.length} mirror (${d.mirrors.filter((m) => m.hasMedia).length} valid) · ${d.downloads.reduce((n, g) => n + g.qualities.reduce((n2, q) => n2 + q.links.length, 0), 0)} link download`;
    });
  }
}

async function cmdParse({ pos, opt }) {
  const f = pos[0];
  if (!f) throw new Error('Pakai: parse <file> [--type home|search|detail|episode]');
  const text = fs.readFileSync(f, 'utf8');
  const type = opt.type || (/id="player"|class="mobius"/.test(text) ? 'episode' : /id="eplister"|class="eplister"/.test(text) ? 'detail' : /<h3>Rilisan Terbaru<\/h3>/.test(text) ? 'home' : 'search');
  if (type === 'home') return emit(true, parseHomeSections(text));
  if (type === 'detail') {
    const d = parseDetail(text, path.basename(f));
    return emit(true, { ...d, episodeCount: d.episodes.length, sampleEpisodes: d.episodes.slice(0, 3) });
  }
  if (type === 'episode') return emit(true, parseEpisodePage(text, path.basename(f)));
  emit(true, parseCardList(text));
}

const HELP_CMDS = [
  ['home', 'Rilisan Terbaru (episode) & Anime Complete Terbaru (series)'],
  ['search <kata>', 'Cari anime (--page N)'],
  ['detail <slug|url>', 'Info lengkap + daftar episode (--limit N episode ditampilkan)'],
  ['episodes <slug|url>', 'Semua episode (--limit N)'],
  ['stream <episode-id|url>', 'Player default, semua mirror (didekode, dicek ada-medianya), link download (host asli ditampilkan)'],
  ['genre <slug>', 'List per genre [experimental, belum diverifikasi di live]'],
  ['probe [kata]', 'Diagnosa end-to-end (HTTP, Cloudflare, parser)'],
  ['parse <file>', 'Parse file HTML lokal untuk debug offline (--type home|search|detail|episode)'],
];
const HELP_OPTS = [
  ['--json', 'Output JSON (status, author_skrep, kesayangan, data)'],
  ['--debug', 'Log request + dump respon bermasalah ke ./hidoristream-debug/'],
  ['--page N', 'Halaman (search/genre)'],
  ['--limit N', 'Batasi jumlah item ditampilkan'],
  ['--base <url>', 'Ganti domain / mirror'],
  ['--ua "<ua>"', 'Ganti User-Agent'],
  ['--cookie "<..>"', 'Header Cookie kalau kena challenge Cloudflare'],
  ['--timeout --retries --delay', 'Default 30000 ms / 2x / 300 ms'],
  ['--no-cache --ttl 600', 'Matikan / atur cache lokal'],
];
const HELP = () =>
  [
    '',
    `${pink('◆')} ${bold('Pemakaian')}  node hidoristream.js ${cyan('<command>')} ${dim('[args] [opsi]')}`,
    '',
    `${pink('◆')} ${bold('Command')}`,
    ...HELP_CMDS.map(([c1, d1]) => `  ${cyan(c1.padEnd(24))} ${dim(d1)}`),
    '',
    `${pink('◆')} ${bold('Opsi global')}`,
    ...HELP_OPTS.map(([c1, d1]) => `  ${purple(c1.padEnd(28))} ${dim(d1)}`),
    '',
    `${pink('◆')} ${bold('Contoh')}`,
    `  ${cyan('node hidoristream.js search "ao ashi"')}`,
    `  ${cyan('node hidoristream.js detail ao-ashi-season-2-subtitle-indonesia')}`,
    `  ${cyan('node hidoristream.js episodes ao-ashi-season-2-subtitle-indonesia')}`,
    `  ${cyan('node hidoristream.js stream ao-ashi-season-2-episode-3-subtitle-indonesia')}`,
  ].join('\n');

const BOOL = new Set(['json', 'debug', 'no-cache', 'help', 'version']);
const ALIAS = { j: 'json', h: 'help', d: 'debug', n: 'limit' };

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    let k, v;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) (k = a.slice(2, eq)), (v = a.slice(eq + 1));
      else k = a.slice(2);
    } else if (/^-[a-zA-Z]$/.test(a)) k = ALIAS[a[1]] || a[1];
    else {
      pos.push(a);
      continue;
    }
    if (v === undefined) v = BOOL.has(k) ? true : argv[++i];
    opt[k] = v;
  }
  return { pos, opt };
}

async function main() {
  verify();
  const { pos, opt } = parseArgs(process.argv.slice(2));
  G.json = !!opt.json;

  if (opt.base) G.base = String(opt.base).replace(/\/+$/, '');
  if (opt.ua) G.ua = opt.ua;
  if (opt.cookie) G.cookie = opt.cookie;
  if (opt.timeout) G.timeout = +opt.timeout;
  if (opt.retries != null) G.retries = +opt.retries;
  if (opt.delay != null) G.delay = +opt.delay;
  if (opt.ttl != null) G.ttl = +opt.ttl;
  G.debug = !!opt.debug;
  G.cache = !opt['no-cache'];

  if (!G.json && process.stderr.isTTY) process.stderr.write(banner() + '\n\n');
  if (opt.version) return G.json ? emit(true, { version: VERSION }) : console.log(VERSION);

  const cmd = (pos.shift() || '').toLowerCase();
  if (!cmd || opt.help || cmd === 'help') return G.json ? emit(true, { commands: HELP_CMDS.map((x) => x[0]) }) : console.log(HELP());

  const ctx = { pos, opt };
  switch (cmd) {
    case 'home':
    case 'h':
      return cmdHome(ctx);
    case 'search':
    case 's':
      return cmdSearch(ctx);
    case 'detail':
    case 'info':
    case 'd':
      return cmdDetail(ctx);
    case 'episodes':
    case 'eps':
    case 'e':
      return cmdEpisodes(ctx);
    case 'stream':
    case 'watch':
    case 'dl':
      return cmdStream(ctx);
    case 'genre':
    case 'genres':
      return cmdGenre(ctx);
    case 'probe':
      return cmdProbe(ctx);
    case 'parse':
      return cmdParse(ctx);
    default:
      throw new Error(`Command tidak dikenal: ${cmd} (coba: node hidoristream.js help)`);
  }
}

async function run() {
  try {
    await main();

  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (G.json) emit(false, {}, { message: msg });
    else {
      console.error(red('✘ ' + msg));
      if (G.debug && e && e.stack) console.error(dim(e.stack));

    }
    process.exitCode = 1;
  }
}

// ============ dari versi lama: schedule / list / filters (cheerio) ============
const BASE_URL = "https://v10.hidoristream.online";

async function fetchHtml(urlOrPath) {
  const res = await request(urlOrPath);
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} fetching ${res.url}`);
  }
  return { $: cheerio.load(res.text), url: res.url };
}


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


const getLatest = (page = 1) => getAnimeList({ order: 'update', page });
const getOngoing = (page = 1) => getAnimeList({ status: 'ongoing', order: 'update', page });
const getCompleted = (page = 1) => getAnimeList({ status: 'completed', order: 'update', page });
const getUpcoming = (page = 1) => getAnimeList({ status: 'upcoming', page });
const getMovie = (page = 1) => getAnimeList({ type: 'movie', order: 'update', page });
const getPopular = (page = 1) => getAnimeList({ order: 'popular', page });
const getTopRated = (page = 1) => getAnimeList({ order: 'rating', page });

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



// ==================== ENDPOINT (apiku) ====================
// Gabungan engine baru (JH) + action schedule/list/filters dari versi lama

const newHome = async (page = 1) => {
  const res = await request(baseUrl() + '/');
  expectOk(res, '/');
  const sections = parseHomeSections(res.text);
  return sections;
};

export default {
  name: "Hidori Stream Anime Scraper",
  description: "Scraper anime lengkap v10.hidoristream.online: home, search, detail, episodes, stream & download, genres, schedule, list+filters, probe",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "page", "slug", "limit"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "home | search | detail | episodes | stream | genres | schedule | list | filters | probe",
      example: "home",
    },
    query: { type: "string", required: false, description: "Kata kunci (search)" },
    page: { type: "number", required: false, description: "Halaman (search/genre/list), default 1" },
    slug: { type: "string", required: false, description: "Slug anime/episode (detail/episodes/stream)" },
    limit: { type: "number", required: false, description: "Batasi jumlah episode ditampilkan (detail)" },
  },

  async run(req, res) {
    const start = Date.now();
    const q = { ...(req.query || {}), ...(req.body || {}) };
    const action = String(q.action || "home").toLowerCase();
    const page = parseInt(q.page, 10) || 1;
    const query = String(q.query || "").trim();
    const slug = String(q.slug || "").trim();

    try {
      let data;
      switch (action) {
        case "home": {
          const res2 = await request(baseUrl() + '/');
          expectOk(res2, '/');
          data = parseHomeSections(res2.text);
          break;
        }
        case "search": {
          if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib untuk action=search" });
          const pathn = page > 1 ? `/page/${page}/` : '/';
          const r = await fetchList(pathn, { s: query });
          data = { query, page, results: r.cards };
          break;
        }
        case "genre": {
          if (!query && !slug) return res.status(400).json({ status: false, message: "Parameter 'slug' (genre slug) wajib untuk action=genre" });
          const gslug = String(slug || query).toLowerCase().replace(/\s+/g, '-');
          const base = `/genres/${gslug}/`;
          const r = await fetchList(page > 1 ? base + `page/${page}/` : base);
          data = { genre: gslug, page, results: r.cards };
          break;
        }
        case "detail": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib untuk action=detail" });
          const d = await fetchDetail(slug);
          const { episodes, ...rest } = d;
          data = { ...rest, episodeCount: episodes.length, episodes: q.limit ? episodes.slice(0, parseInt(q.limit, 10)) : episodes };
          break;
        }
        case "episodes": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' wajib untuk action=episodes" });
          const d = await fetchDetail(slug);
          data = { slug: d.slug, title: d.title, total: d.episodes.length, episodes: d.episodes };
          break;
        }
        case "stream":
        case "episode": {
          if (!slug) return res.status(400).json({ status: false, message: "Parameter 'slug' (episode slug/url) wajib untuk action=stream" });
          data = await fetchEpisode(slug);
          break;
        }
        case "genres": {
          const r = await request(baseUrl() + '/genre-list/');
          expectOk(r, '/genre-list/');
          // fallback: parse generic links
          const links = [...r.text.matchAll(/href="https?:\/\/[^"]*\/genre\/([^"\/]+)\/"[^>]*>([^<]+)</gi)].map((m) => ({ slug: m[1], name: m[2].trim() }));
          const seen = new Set();
          data = links.filter((l) => (seen.has(l.slug) ? false : (seen.add(l.slug), true)));
          if (!data.length) data = "Gunakan action=genre&slug=<slug> (daftar genre tidak terparse dari /genre-list/)";
          break;
        }
        case "schedule": {
          data = await getSchedule();
          break;
        }
        case "list":
        case "anime": {
          data = await getAnimeList({
            page,
            status: q.status,
            type: q.type,
            order: q.order,
            genre: q.genre,
            season: q.season,
            studio: q.studio,
          });
          break;
        }
        case "filters": {
          data = await getFilterOptions();
          break;
        }
        case "probe": {
          const t0 = Date.now();
          const r = await request(baseUrl() + '/', { noCache: true });
          const sections = parseHomeSections(r.text);
          data = {
            base: baseUrl(),
            node: process.version,
            homeMs: Date.now() - t0,
            sections: sections.map((s) => s.label),
            ok: true,
          };
          break;
        }
        default:
          return res.status(400).json({
            status: false,
            message: "Action tidak dikenal: " + action + " (home|search|genre|detail|episodes|stream|genres|schedule|list|filters|probe)",
          });
      }

      return res.json({
        status: true,
        action,
        result: data,
        metadata: { processing_time: `${Date.now() - start}ms` },
        attribution: "@zyvorapi",
      });
    } catch (err) {
      return res.status(502).json({
        status: false,
        action,
        message: err?.message || "Upstream error",
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  },
};

function normalizeUrl(url) {
  if (!url) return null;
  let clean = url.trim();
  if (clean.startsWith('//')) clean = `https:${clean}`;
  if (clean.startsWith('http://v10.hidoristream.online')) {
    clean = clean.replace('http://', 'https://');
  }
  return clean;
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
