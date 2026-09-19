/**
 * All-In-One Downloader v3
 * Download video dari berbagai platform (TikTok, Instagram, YouTube, Facebook, Twitter, dll)
 *
 * GET  /api/downloader/allinonev3?url=https://vt.tiktok.com/xxx
 * POST /api/downloader/allinonev3
 */

const BASE_URL = "https://dl.valore.web.id";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function newSessionId() {
  return "sid_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, b = bytes;
  while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return `${b.toFixed(1)} ${units[i]}`;
}

async function queryDownload(url) {
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/api/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": newSessionId(),
      "User-Agent": UA,
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(60000),
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || `Gagal memproses URL (HTTP ${res.status})`);
  }

  const d = json.data || {};
  const medias = (Array.isArray(d.medias) ? d.medias : Array.isArray(d.formats) ? d.formats : [])
    .map((m) => ({
      quality: m.quality || m.qualityLabel || m.label || m.resolution || "Standard",
      format: (m.format || m.container || m.ext || "media").toLowerCase(),
      size: m.size || m.size_bytes || 0,
      size_formatted: formatSize(m.size || m.size_bytes || 0),
      url: m.url || m.downloadUrl || m.download_url || m.dl || m.data?.url || "",
    }))
    .filter((m) => m.url);

  return {
    platform: d.platform || "other",
    title: d.title || null,
    owner: d.creator || d.owner || null,
    thumbnail: d.thumbnail || d.thumbnailUrl || null,
    duration: d.duration || 0,
    processingTime: json.processingTime || Date.now() - t0,
    medias,
    downloads: medias,
  };
}

export default {
  name: "All-In-One Downloader v3",
  description: "Download video dari berbagai platform (TikTok, Instagram, YouTube, Facebook, Twitter, Pinterest, Reddit, dll) dengan multi-format MP4/MP3.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video yang ingin diunduh (TikTok, Instagram, YouTube, Facebook, dll)",
      example: "https://vt.tiktok.com/ZSxxpjmUV/",
      pattern: "https?:\\/\\/.+",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || !String(url).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const input = String(url).trim();
      if (!/^https?:\/\//i.test(input)) {
        return res.status(400).json({
          status: false,
          message: "URL tidak valid. Gunakan format https://...",
        });
      }

      const result = await queryDownload(input);

      return res.json({
        status: true,
        input,
        ...result,
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendownload",
      });
    }
  },
};