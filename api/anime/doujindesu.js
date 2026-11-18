/**
 * Doujindesu Scraper & PDF Compiler API
 * Target: doujin.desu.xxx (official active mirror of doujindesu.tv)
 *
 * Actions: latest | popular | search | detail | chapter | pdf
 * GET/POST /api/anime/doujindesu?action=<action>&query=<...>
 */

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const BASE_URL = "https://doujin.desu.xxx";
const API_URL = `${BASE_URL}/api`;
const APP_SECRET = "dfdf72051dbfdc7d76889ebd31324e74";
const SALT = "doujindesu-scrapers-cannot-read-this-super-secret-salt-2026-v2";
const HOUR_MS = 3600000;

const DEFAULT_HEADERS = {
  "x-app-secret": APP_SECRET,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Referer: `${BASE_URL}/`,
  Accept: "application/json, text/plain, */*",
};

function toSigned32(x) {
  let y = BigInt(x) & 0xffffffffn;
  if (y >= 0x80000000n) y -= 0x100000000n;
  return Number(y);
}

function generateKey(e) {
  const t = `${SALT}_${e}`;
  let a = 0;
  for (let i = 0; i < t.length; i++) {
    a = (a << 5) - a + t.charCodeAt(i);
    a = toSigned32(a);
  }
  let l = BigInt(a !== 0 ? Math.abs(a) : 123456789);
  let res = "";
  for (let i = 0; i < 32; i++) {
    l = (l * 1664525n + 1013904223n) % 4294967296n;
    res += String.fromCharCode(33 + Number(l % 93n));
  }
  return res;
}

function getActiveKeys() {
  const now = Date.now();
  const t = Math.floor(now / HOUR_MS);
  return [generateKey(t), generateKey(t - 1), generateKey(t + 1)];
}

function xorDecrypt(encryptedHex, key) {
  const bytes = [];
  for (let i = 0; i < encryptedHex.length; i += 2) {
    bytes.push(parseInt(encryptedHex.slice(i, i + 2), 16));
  }
  let d = 42;
  const keyLen = key.length;
  let res = "";
  for (let idx = 0; idx < bytes.length; idx++) {
    const byteVal = bytes[idx];
    const keyChar = key.charCodeAt(idx % keyLen);
    const k = byteVal ^ keyChar ^ (idx * 13) ^ d;
    res += String.fromCharCode(k & 0xff);
    d = (d + byteVal) % 256;
  }
  return res;
}

export function decrypt(encryptedHex) {
  if (!encryptedHex || typeof encryptedHex !== "string") return null;
  for (const key of getActiveKeys()) {
    try {
      const decoded = xorDecrypt(encryptedHex, key);
      const unescaped = decodeURIComponent(decoded);
      return JSON.parse(unescaped);
    } catch {}
  }
  return null;
}

async function requestApi(endpoint, params = {}) {
  const url = new URL(
    endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`
  );
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`Request API gagal (HTTP ${res.status}): ${res.statusText}`);
  }

  const json = await res.json().catch(() => null);
  if (!json) throw new Error("Gagal parse respons API");
  const enc = json._enc_resp_ || json.encrypted;
  if (enc) {
    const decrypted = decrypt(enc);
    if (!decrypted) throw new Error("Gagal mendekripsi payload dari server Doujindesu");
    return decrypted;
  }
  return json;
}

export function extractSlug(input) {
  if (!input) return null;
  const m = String(input).match(/doujin\.desu\.xxx\/manga\/([a-z0-9-]+)/i);
  if (m) return m[1];
  const plain = String(input).trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(plain) ? plain : null;
}

export function extractChapterId(input) {
  if (!input) return null;
  const uuid = String(input).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return uuid ? uuid[0] : null;
}

function formatMangaItem(item) {
  const genres = item.manga_genres?.map((g) => g.genres?.name).filter(Boolean) || [];
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    cover: item.cover_url?.startsWith("/") ? `${BASE_URL}${item.cover_url}` : item.cover_url,
    status: item.status,
    type: item.type,
    rating: item.rating,
    views: item.views,
    chapterCount: item.chapter_count || item._count?.chapters || item.chapters?.length || 0,
    latestChapter: item.chapters?.[0]?.chapter_number ?? null,
    genres,
    url: `${BASE_URL}/manga/${item.slug}`,
    createdAt: item.created_at,
  };
}

export async function latest({ page = 1, limit = 24, sort = "latest_chapter" } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const offset = (p - 1) * limit;
  const data = await requestApi("/manga", { limit, offset, sort });
  const items = Array.isArray(data) ? data.map(formatMangaItem) : [];
  return { page: p, limit, total: items.length, data: items };
}

export async function popular({ page = 1, limit = 24 } = {}) {
  const data = await requestApi("mangas", { page, limit, sort: "popular" });
  const items = (data?.data || data?.items || []).map(formatMangaItem);
  return { page, limit, total: data?.total ?? items.length, data: items };
}

export async function search(
  query,
  { page = 1, limit = 24, sort = "latest_chapter", type = "", status = "" } = {}
) {
  if (!query?.trim()) throw new Error("Query pencarian wajib diisi");
  const p = Math.max(1, parseInt(page, 10) || 1);
  const offset = (p - 1) * limit;
  const params = { search: query.trim(), limit, offset, sort };
  if (type) params.type = type;
  if (status) params.status = status;
  const data = await requestApi("/manga", params);
  const items = Array.isArray(data) ? data.map(formatMangaItem) : [];
  return { query, page: p, limit, total: items.length, data: items };
}

export async function detail(slugOrUrl) {
  const slug = extractSlug(slugOrUrl);
  if (!slug) throw new Error("Slug atau URL manga tidak valid");
  const data = await requestApi(`/manga/${slug}`);
  if (!data || !data.title) throw new Error("Data manga tidak ditemukan");

  const genres = data.manga_genres?.map((g) => g.genres?.name).filter(Boolean) || [];
  const chapters = (data.chapters || []).map((ch) => ({
    id: ch.id,
    chapterNumber: ch.chapter_number,
    title: ch.title || `Chapter ${ch.chapter_number}`,
    url: `${BASE_URL}/reader/${ch.id}`,
    createdAt: ch.created_at,
    views: ch.views || 0,
  }));
  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    id: data.id,
    title: data.title,
    altTitles: data.alt_titles ? data.alt_titles.split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [],
    slug: data.slug,
    cover: data.cover_url?.startsWith("/") ? `${BASE_URL}${data.cover_url}` : data.cover_url,
    author: data.author || data.users?.username || "Unknown",
    status: data.status,
    type: data.type,
    rating: data.rating,
    views: data.views,
    synopsis: (data.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    genres,
    totalChapters: chapters.length,
    chapters,
    url: `${BASE_URL}/manga/${data.slug}`,
  };
}

export async function getChapter(chapterIdOrUrl) {
  const chapterId = extractChapterId(chapterIdOrUrl);
  if (!chapterId) throw new Error("Chapter ID (UUID) tidak valid");
  const data = await requestApi(`/chapters/${chapterId}`);
  const pages = data.content_urls || [];
  return {
    chapterId,
    mangaSlug: data.manga_slug || null,
    pagesCount: pages.length,
    pages,
  };
}

export async function createPdf(imageUrls, { maxPages = 80, onProgress = null } = {}) {
  if (!Array.isArray(imageUrls) || !imageUrls.length) {
    throw new Error("Tidak ada URL gambar untuk dikompilasi");
  }

  const targetUrls = imageUrls.slice(0, maxPages);
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < targetUrls.length; i++) {
    try {
      const imgRes = await fetch(targetUrls[i], {
        headers: {
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
          Referer: `${BASE_URL}/`,
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);

      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      const jpegBuffer = await sharp(imgBuf)
        .jpeg({ quality: 88 })
        .toBuffer()
        .catch(() => imgBuf);

      const image = await pdfDoc.embedJpg(jpegBuffer);
      const { width, height } = image.scale(1);
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });

      if (typeof onProgress === "function") onProgress(i + 1, targetUrls.length);
    } catch (err) {
      // skip halaman gagal
    }
  }

  if (pdfDoc.getPageCount() === 0) {
    throw new Error("Gagal mengunduh satupun halaman gambar untuk disusun menjadi PDF");
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export default {
  name: "Doujindesu Scraper",
  description:
    "Scrape doujin.desu.xxx: latest, popular, search, detail manga, chapter reader, dan compile chapter menjadi PDF",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "page", "limit", "slug", "chapter"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "latest | popular | search | detail | chapter | pdf",
      example: "latest",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci (untuk action=search)",
      example: "harem",
    },
    page: {
      type: "string",
      required: false,
      description: "Halaman (untuk latest/popular/search), default 1",
    },
    limit: {
      type: "string",
      required: false,
      description: "Jumlah item, default 24",
    },
    slug: {
      type: "string",
      required: false,
      description: "Slug/URL manga (untuk action=detail)",
    },
    chapter: {
      type: "string",
      required: false,
      description: "Chapter ID UUID (untuk action=chapter/pdf)",
    },
  },

  async run(req, res) {
    const start = Date.now();
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const action = String(params.action || params.mode || "latest").toLowerCase();

    try {
      if (action === "latest" || action === "popular") {
        const page = parseInt(params.page, 10) || 1;
        const limit = Math.min(parseInt(params.limit, 10) || 24, 50);
        const data =
          action === "latest"
            ? await latest({ page, limit })
            : await popular({ page, limit });
        return res.json({
          status: true,
          action,
          ...data,
          metadata: { processing_time: `${Date.now() - start}ms` },
        });
      }

      if (action === "search") {
        const page = parseInt(params.page, 10) || 1;
        const limit = Math.min(parseInt(params.limit, 10) || 24, 50);
        const data = await search(params.query || params.q || "", { page, limit });
        return res.json({
          status: true,
          action,
          ...data,
          metadata: { processing_time: `${Date.now() - start}ms` },
        });
      }

      if (action === "detail") {
        const data = await detail(params.slug || params.query || params.url || "");
        return res.json({
          status: true,
          action,
          result: data,
          metadata: { processing_time: `${Date.now() - start}ms` },
        });
      }

      if (action === "chapter") {
        const data = await getChapter(params.chapter || params.id || params.url || "");
        return res.json({
          status: true,
          action,
          result: data,
          metadata: { processing_time: `${Date.now() - start}ms` },
        });
      }

      if (action === "pdf") {
        const maxPages = Math.min(parseInt(params.maxPages || params.limit, 10) || 80, 120);
        const ch = await getChapter(params.chapter || params.id || params.url || "");
        const urls = ch.pages || [];
        if (!urls.length) throw new Error("Tidak ada gambar pada chapter ini");

        const pdfBuffer = await createPdf(urls, { maxPages });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="doujindesu-${ch.chapterId}.pdf"`
        );
        res.setHeader("Content-Length", pdfBuffer.length);
        return res.end(pdfBuffer);
      }

      return res.status(400).json({
        status: false,
        message: `Action tidak dikenal: ${action}. Gunakan latest | popular | search | detail | chapter | pdf`,
      });
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: err?.message || "Service unavailable",
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  },
};
