/**
 * Terabox Downloader — langsung dari dm.terabox.app (share/list API)
 * Flow:
 *  1. GET https://dm.terabox.app/sharing/link?surl=<surl> -> extract jsToken (regex fn%28%22(...)%22%29)
 *  2. GET https://dm.terabox.app/share/list?app_id=250528&jsToken=...&shorturl=...&root=1
 *  3. Parse list file (metadata + thumbnail)
 *
 * GET  /api/downloader/terabox?url=https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g
 * POST /api/downloader/terabox  (JSON: { url })
 */

import fs from "fs";

const COOKIE = "ndus=YuLuQdPpeHuiMGEQDXpWDu6K2P4-xInj8YGEzswD";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";
const COOKIE_FILE = new URL("../../data/terabox-cookie.json", import.meta.url).pathname;

function loadCookie() {
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
      if (data?.ndus) return `ndus=${data.ndus}`;
    } catch {}
  }
  return COOKIE;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function cleanFiles(list) {
  return (list || [])
    .filter((f) => f.isdir !== "1")
    .map((f) => ({
      name: f.server_filename || null,
      size: f.size ? Number(f.size) : null,
      size_formatted: f.size ? formatBytes(Number(f.size)) : null,
      md5: f.md5 || null,
      path: f.path || null,
      width: f.width || null,
      height: f.height || null,
      duration: f.duration ? Number(f.duration) : null,
      thumbnails: f.thumbs
        ? {
            small: f.thumbs.url1 || null,
            medium: f.thumbs.url2 || null,
            large: f.thumbs.url3 || null,
            icon: f.thumbs.icon || null,
          }
        : null,
    }));
}

async function getShareList(url) {
  const surl = String(url).split("/s/")[1]?.split(/[?#]/)[0] || String(url).trim();
  const short_url = surl.startsWith("1") ? surl.slice(1) : surl;
  const cookie = loadCookie();

  const first = await fetch(`https://dm.terabox.app/sharing/link?surl=${surl}`, {
    headers: { "User-Agent": UA, Cookie: cookie },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const html = await first.text();

  const match = html.match(/fn%28%22(.*?)%22%29/);
  if (!match) {
    throw new Error("jsToken tidak ditemukan — link tidak valid atau cookie expired");
  }
  const jsToken = match[1];

  const params = new URLSearchParams({
    app_id: "250528",
    jsToken,
    site_referer: "https://www.terabox.app/",
    shorturl: short_url,
    root: "1",
  });

  const api = await fetch(`https://dm.terabox.app/share/list?${params.toString()}`, {
    headers: {
      Host: "dm.terabox.app",
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `https://dm.terabox.app/sharing/link?surl=${short_url}&clearCache=1`,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://dm.terabox.app",
      Cookie: cookie,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });

  const json = await api.json();

  if (json.errno !== 0) {
    throw new Error(`Terabox API error errno=${json.errno} (${json.err_msg || "unknown"})`);
  }

  return {
    url: String(url).trim(),
    title: json.title || null,
    file_count: (json.list || []).length,
    files: cleanFiles(json.list),
  };
}

export default {
  name: "Terabox Downloader",
  description: "Download file dari Terabox — metadata + thumbnail",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL share Terabox (terabox.app/s/..., 1024terabox.com/s/..., terabox.com/s/...)",
      example: "https://terabox.app/s/1HSEb8PZRUE7Z1Tvd3ZtT0g",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || !String(url).trim()) {
        return res.status(400).json({
          status: false,
          message: "URL wajib diisi",
        });
      }

      const result = await getShareList(String(url).trim());

      return res.status(200).json({
        status: true,
        result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message || "Gagal memproses link Terabox",
        timestamp: new Date().toISOString(),
      });
    }
  },
};

// Cookie override — biarkan data/terabox-cookie.json berisi { "ndus": "..." } untuk cookie custom
export function setCookie(ndus) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ ndus }));
}