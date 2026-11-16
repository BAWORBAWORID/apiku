import logger from "../../src/utils/logger.js";

/**
 * All Media Downloader — via allmediadl.com
 * Platform: TikTok, Instagram, Facebook, YouTube, Twitter/X,
 *           Dailymotion, Twitch, SoundCloud
 *
 * Alur API upstream:
 *   POST /api/download           { url, client }            -> buat job
 *   GET  /api/jobs?client=...    -> polling status
 *   POST /api/choose             { job_id, format_id, client } -> pilih format
 *   GET  /api/file/<id>?client=... -> URL unduh final
 */

const BASE = "https://allmediadl.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clientId = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : "c" + Date.now() + Math.random().toString(16).slice(2);

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.detail || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(25000),
  });
  return res.json();
};

/** Poll sampai job mencapai salah satu status terminal. */
async function waitJob(client, jobId, url, terminalStatuses) {
  let job = null;
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    let jobs;
    try {
      jobs = (await get(`/api/jobs?client=${encodeURIComponent(client)}`)).jobs || [];
    } catch {
      jobs = [];
    }
    job = jobId ? jobs.find((j) => j.id === jobId) : jobs.find((j) => j.url === url) || jobs[0];
    if (job && terminalStatuses.includes(job.status)) break;
  }
  return job;
}

async function scrapeAllMedia(url) {
  const client = clientId();

  // 1) submit URL -> buat job
  await post("/api/download", { url, client });

  // 2) tunggu sampai awaiting_choice / done / failed
  let job = await waitJob(client, null, url, ["awaiting_choice", "done", "failed"]);
  if (!job) throw new Error("Job tidak muncul (timeout)");

  // 3) kalau butuh pilih format, auto-pick pertama
  if (job.status === "awaiting_choice") {
    const fmts = job.formats || [];
    if (!fmts.length) throw new Error("Tidak ada format yang bisa dipilih");
    const pick = fmts[0];
    await post("/api/choose", { job_id: job.id, format_id: pick.id, client });
    job = await waitJob(client, job.id, url, ["done", "failed"]);
    if (!job) throw new Error("Job tidak selesai (timeout)");
  }

  if (job.status !== "done") {
    throw new Error(job.error || `Job gagal (status: ${job.status})`);
  }

  return {
    title: job.title || "",
    platform: job.platform || "",
    uploader: job.uploader || "",
    duration: job.duration || 0,
    size: job.size || 0,
    height: job.height || 0,
    filename: job.filename || "",
    thumbnail: job.thumbnail
      ? `${BASE}/api/thumb/${job.id}?client=${encodeURIComponent(client)}`
      : "",
    download: `${BASE}/api/file/${job.id}?client=${encodeURIComponent(client)}`,
  };
}

export default {
  name: "All Media Downloader",
  description:
    "All-media downloader via allmediadl.com: TikTok, Instagram, Facebook, YouTube, Twitter/X, Dailymotion, Twitch, SoundCloud. Tanpa watermark, gratis.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description:
        "URL video/audio (TikTok, Instagram, Facebook, YouTube, Twitter/X, Dailymotion, Twitch, SoundCloud)",
      default: "https://vt.tiktok.com/ZSbm6fY8P/",
      example: "https://www.tiktok.com/@user/video/123456789",
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };

    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi" });
    }
    if (!/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ status: false, error: "URL harus diawali http:// atau https://" });
    }

    try {
      const info = await scrapeAllMedia(url.trim());
      return res.json({ status: true, result: info });
    } catch (err) {
      logger.error(`[AllMedia] Error: ${err.message}`);
      return res.status(500).json({ status: false, error: err.message });
    }
  },
};
