import logger from "../../src/utils/logger.js";

/**
 * TikTok Downloader v7 — mesin tiktokdownloaderr.id
 * diuji 2026-11-08: metadata + 3 link (noWm/wm/audio) sukses, --save OK
 */

const BASE_URL = "https://tiktokdownloaderr.id";
const ENDPOINT = `${BASE_URL}/api/downloader.php`;
const TIMEOUT_MS = 25000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/id`,
  Accept: "application/json, text/plain, */*",
};

/** Resolve short link (vt/vm.tiktok.com) ke URL canonical. */
async function resolveTikTokUrl(rawUrl) {
  try {
    const head = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": HEADERS["User-Agent"] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return head.url || rawUrl;
  } catch {
    return rawUrl;
  }
}

/** Scrape metadata + stream unduhan dari tiktokdownloaderr.id */
async function scrapeTikTok(url) {
  const targetUrl = await resolveTikTokUrl(url.trim());
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({ url: targetUrl }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Upstream HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.message || "Gagal mengekstrak link TikTok.");
  }

  return {
    title: data.title || "",
    author: data.author || "",
    duration: data.duration || 0,
    cover: data.cover || "",
    musicTitle: data.music_title || "",
    downloads: {
      noWatermark: data.video_nowm
        ? { url: data.video_nowm, filename: data.filename_nowm || null }
        : null,
      watermark: data.video_wm
        ? { url: data.video_wm, filename: data.filename_wm || null }
        : null,
      audio: data.audio
        ? { url: data.audio, filename: data.filename_audio || null }
        : null,
    },
  };
}

export default {
  name: "TikTok Downloader v7",
  description:
    "TikTok downloader via tiktokdownloaderr.id: metadata lengkap + link video no-watermark, watermark, dan audio MP3",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description:
        "TikTok URL (vt.tiktok.com, www.tiktok.com/@user/video/123, dll)",
      default: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
      example: "https://vt.tiktok.com/ZSxxxxxx/",
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi" });
    }
    if (!/^https?:\/\/(www\.|vt\.|vm\.)?tiktok\.com\//i.test(url.trim())) {
      return res.status(400).json({ status: false, error: "Bukan link TikTok yang valid" });
    }

    try {
      const info = await scrapeTikTok(url);
      return res.json({ status: true, result: info });
    } catch (err) {
      logger.error(`[TikTok v7] Error: ${err.message}`);
      return res.status(500).json({ status: false, error: err.message });
    }
  },
};