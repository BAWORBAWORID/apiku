/**
 * Terabox Downloader V2 — scrape teradownloader.pro
 * API upstream: https://apiwala.teradownloader.pro/web/api/terabox
 * Endpoint: /api/downloader/teraboxv2
 *
 * GET  /api/downloader/teraboxv2?url=<terabox-share-url>&page=1
 * GET  /api/downloader/teraboxv2?url=<url>&dl=1        -> direct download link file #1
 * POST /api/downloader/teraboxv2  (JSON: { url, page, dl })
 */

const API = "https://apiwala.teradownloader.pro/web/api/terabox";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_URL = "https://www.terabox.app/wap/share/filelist?surl=sab4x_EjggLREkDSC616Rw";

async function post(body) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://teradownloader.pro",
      Referer: "https://teradownloader.pro/",
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return res.json();
}

export default {
  name: "Terabox Downloader V2",
  description: "Download file Terabox via teradownloader.pro (dl-worker.teraboxdl.site), support list folder & direct link",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url", "page", "dl"],
  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "Terabox share URL",
      default: DEFAULT_URL,
      example: "https://www.terabox.app/wap/share/filelist?surl=sab4x_EjggLREkDSC616Rw",
    },
    page: { type: "number", required: false, description: "Halaman folder (default 1)" },
    dl: { type: "number", required: false, description: "Index file (mulai 1) untuk ambil direct download link" },
  },

  async run(req, res) {
    const q = { ...req.query, ...req.body };
    const url = String(q.url || DEFAULT_URL).trim();
    const page = parseInt(q.page) || 1;
    const dl = q.dl != null && q.dl !== "" ? parseInt(q.dl) : null;

    if (!url.includes("terabox")) {
      return res.status(400).json({ status: false, error: "URL Terabox tidak valid" });
    }

    try {
      const data = await post({ link: url, dir_path: "", page });
      if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
        return res.status(404).json({ status: false, message: "Tidak ada file / link tidak valid", upstream: data });
      }

      const files = data.data;

      if (dl != null) {
        const f = files[dl - 1];
        if (!f || !f.downloadLink) {
          return res.status(404).json({ status: false, message: "File index tidak ada / tidak punya download link" });
        }
        return res.json({
          status: true,
          name: f.fileName,
          size: f.fileSize,
          size_human: f.fileSizeMB,
          downloadLink: f.downloadLink,
          streamUrl: f.streamUrl || null,
        });
      }

      return res.json({
        status: true,
        source: "teradownloader.pro",
        url,
        page,
        total: files.length,
        files: files.map((f, i) => ({
          no: i + 1,
          name: f.fileName,
          size: f.fileSize,
          size_human: f.fileSizeMB,
          path: f.path,
          isDir: !!f.isDir,
          downloadLink: f.downloadLink || null,
          streamUrl: f.streamUrl || null,
          thumbnail: f.thumbnail || null,
          duration: f.duration || 0,
        })),
      });
    } catch (err) {
      return res.status(500).json({ status: false, error: err?.message || String(err) });
    }
  },
};
