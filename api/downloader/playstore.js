/**
 * Play Store APK Downloader
 * Scrapes metadata from Google Play Store & resolves direct CDN APK download links.
 * 
 * GET /api/downloader/playstore?id=com.whatsapp
 * GET /api/downloader/playstore?url=https://play.google.com/store/apps/details?id=com.whatsapp
 * POST /api/downloader/playstore
 */

import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function cleanInstalls(raw) {
  if (!raw) return null;
  return raw.replace(/^[0-9.,]+\s*star/i, "").trim() || raw.trim();
}

async function scrapePlayStore(packageId) {
  try {
    const playUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&hl=id&gl=ID`;
    const res = await fetch(playUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
      }
    });

    if (!res.ok) return null;
    const html = await res.text();

    const $ = cheerio.load(html);
    const title = $("h1").first().text().trim() || null;
    const developer = $("a[href*=\"/store/apps/developer?id=\"]").first().text().trim() ||
                      $("a[href*=\"/store/apps/dev?id=\"]").first().text().trim() || null;
    let rating = ($("[itemprop=\"starRating\"]").text().trim() || $("div.j2ttFe").text().trim() || "");
    rating = rating.replace(/star/i, "").replace(",", ".").trim() || null;
    const reviews = $("div.EHZ5gh").text().trim() || $("div.g1rdde:contains(\"ulasan\")").text().trim() || null;
    const installs = cleanInstalls($("div.ClM7O").text().trim());
    const description = $("div[data-g-id=\"description\"]").text().trim() || $(".bARER").text().trim() || null;
    let icon = $("img[alt*=\"icon\" i]").attr("src") || $("img[alt=\"Ikon gambar\"]").attr("src") || null;
    if (icon && icon.startsWith("//")) icon = "https:" + icon;

    return { title, developer, rating, reviews, installs, description, icon };
  } catch {
    return null;
  }
}

async function apkDownloader(input) {
  if (!input || typeof input !== "string" || !input.trim()) {
    throw new Error("Parameter input (Google Play URL / Package Name / Keyword) wajib disertakan.");
  }

  const cleanInput = input.trim();
  let packageId = "";

  // 1. Google Play Store URL
  if (cleanInput.includes("play.google.com/store/apps/details")) {
    const match = cleanInput.match(/[?&]id=([a-zA-Z0-9_.]+)/);
    if (match) packageId = match[1];
  } else if (/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(cleanInput)) {
    // 2. Direct Package ID (e.g. com.whatsapp)
    packageId = cleanInput;
  } else {
    // 3. Search query
    const searchUrl = `https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(cleanInput)}/limit=1`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (searchData.datalist?.list && searchData.datalist.list.length > 0) {
      packageId = searchData.datalist.list[0].package;
    } else {
      throw new Error(`Aplikasi dengan kata kunci "${cleanInput}" tidak ditemukan.`);
    }
  }

  if (!packageId) {
    throw new Error("Gagal mengidentifikasi Package ID dari parameter yang diberikan.");
  }

  // Fetch APK binary details from CDN repository
  const cdnUrl = `https://ws75.aptoide.com/api/7/app/get/package_name=${encodeURIComponent(packageId)}`;
  const cdnRes = await fetch(cdnUrl);
  const cdnData = await cdnRes.json();
  const meta = cdnData?.nodes?.meta?.data;

  if (!meta || !meta.file?.path) {
    throw new Error(`Berkas APK untuk package "${packageId}" tidak tersedia untuk diunduh.`);
  }

  // Scrape Play Store metadata concurrently
  const playMeta = await scrapePlayStore(packageId);

  // Versions history
  const versionsList = (cdnData.nodes?.versions?.list || []).slice(0, 5).map(v => ({
    version: v.file?.vername || null,
    versionCode: v.file?.vercode || null,
    size: formatBytes(v.file?.filesize || v.size),
    sizeBytes: v.file?.filesize || v.size,
    md5: v.file?.md5sum || null,
    updatedAt: v.updated || v.modified || null
  }));

  return {
    name: playMeta?.title || meta.name,
    package: meta.package,
    version: meta.file?.vername || null,
    versionCode: meta.file?.vercode || null,
    size: formatBytes(meta.file?.filesize || meta.size),
    sizeBytes: meta.file?.filesize || meta.size,
    updatedAt: meta.modified || meta.updated || null,
    developer: {
      name: playMeta?.developer || meta.developer?.name || null,
      website: meta.developer?.website || null,
      email: meta.developer?.email || null
    },
    stats: {
      rating: playMeta?.rating || (meta.stats?.rating?.avg ? meta.stats.rating.avg.toFixed(1) : null),
      reviews: playMeta?.reviews || null,
      installs: playMeta?.installs || (meta.stats?.downloads ? `${meta.stats.downloads.toLocaleString()}+` : null)
    },
    icon: playMeta?.icon || meta.icon || null,
    graphic: meta.graphic || null,
    download: {
      url: meta.file?.path,
      altUrl: meta.file?.path_alt || null,
      md5: meta.file?.md5sum || null,
      minSdk: meta.file?.hardware?.sdk || null,
      supportedCpu: meta.file?.hardware?.cpus || [],
      securityStatus: meta.file?.malware?.rank || "UNKNOWN",
      sha1: meta.file?.signature?.sha1 || null
    },
    description: playMeta?.description || null,
    screenshots: meta.media?.screenshots?.map(s => s.url) || [],
    versions: versionsList
  };
}

export default {
  name: "Play Store Downloader",
  description: "Download file APK aplikasi Google Play Store dengan metadata lengkap, ukuran file, MD5 hash, dan link direct CDN.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "id", "query"],

  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL aplikasi Google Play Store (contoh: https://play.google.com/store/apps/details?id=com.whatsapp)",
      example: "https://play.google.com/store/apps/details?id=com.whatsapp"
    },
    id: {
      type: "string",
      required: false,
      description: "Package ID aplikasi Google Play Store (contoh: com.whatsapp)",
      example: "com.whatsapp"
    },
    query: {
      type: "string",
      required: false,
      description: "Nama atau kata kunci pencarian aplikasi jika tidak tahu package ID (contoh: WhatsApp Messenger)",
      example: "WhatsApp Messenger"
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const input = params.url || params.id || params.package_id || params.query;

      if (!input || !String(input).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url', 'id', atau 'query' wajib disertakan.",
          timestamp: Date.now()
        });
      }

      const result = await apkDownloader(String(input).trim());

      return res.json({
        status: true,
        result,
        timestamp: Date.now()
      });
    } catch (err) {
      logger.error(`[PlayStore-Downloader] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mengunduh APK Play Store",
        timestamp: Date.now()
      });
    }
  }
};
