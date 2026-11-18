/**
 * MP3Juices Downloader API
 * Search & download YouTube media as MP3/MP4 via mp3juices/flvto.
 *
 * GET/POST /api/downloader/mp3juices?query=<keyword|youtube-url>&type=mp3|mp4
 */

const BASE_URL = "https://www-mp3juices.com";
const SEARCH_API = "https://test.flvto.online/search/";
const CONVERTER_API = "https://ht.flvto.online/converter";
const SUGGEST_API = "https://suggestqueries.google.com/complete/search";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
};

export function extractVideoId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  const patterns = [
    /(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function suggest(query) {
  if (!query?.trim()) return [];
  try {
    const url = `${SUGGEST_API}?hl=en&ds=yt&client=youtube&hjson=t&cp=1&q=${encodeURIComponent(query.trim())}`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data?.[1])) {
      return data[1].map((item) => (Array.isArray(item) ? item[0] : item)).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

export async function search(query) {
  if (!query?.trim()) throw new Error("Search query is required");

  const trimmed = query.trim();
  const videoId = extractVideoId(trimmed);
  const searchQuery = videoId || trimmed;

  const res = await fetch(`${SEARCH_API}?q=${encodeURIComponent(searchQuery)}`, {
    headers: {
      ...DEFAULT_HEADERS,
      Origin: BASE_URL,
      Referer: `${BASE_URL}/converter`,
    },
  });

  if (!res.ok) {
    throw new Error(`Search failed with status ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const items = data?.items || [];

  return items.map((item) => ({
    id: item.id,
    title: item.title,
    duration: item.duration || "0:00",
    viewCount: item.viewCount || "0",
    thumbnail: item.thumbMedium || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${item.id}`,
  }));
}

export async function convert(idOrUrl, fileType = "mp3") {
  const videoId = extractVideoId(idOrUrl);
  if (!videoId) throw new Error("Invalid YouTube Video ID or URL");

  const type = String(fileType).toLowerCase() === "mp4" ? "mp4" : "mp3";

  const res = await fetch(CONVERTER_API, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/json",
      Origin: "https://ht.flvto.online",
      Referer: `https://ht.flvto.online/button?url=https://www.youtube.com/watch?v=${videoId}&fileType=${type}`,
    },
    body: JSON.stringify({ id: videoId, fileType: type }),
  });

  if (!res.ok) {
    throw new Error(`Conversion request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  if (type === "mp3") {
    if (data.status !== "ok" && data.msg !== "success") {
      throw new Error(data.msg || data.error || "Failed to convert audio");
    }
    return {
      status: true,
      id: videoId,
      type: "mp3",
      title: data.title,
      duration: data.duration,
      filesize: data.filesize,
      downloadUrl: data.link,
      progress: data.progress,
      raw: data,
    };
  }

  if (data.status !== "success" || !Array.isArray(data.formats)) {
    throw new Error(data.msg || data.error || "Failed to fetch video formats");
  }
  const bestFormat = data.formats.find((f) => f.qualityLabel === "720p") || data.formats[0];
  return {
    status: true,
    id: videoId,
    type: "mp4",
    title: data.title,
    formats: data.formats.map((f) => ({
      quality: f.qualityLabel || f.quality,
      itag: f.itag,
      mimeType: f.mimeType,
      url: f.url,
    })),
    downloadUrl: bestFormat?.url || null,
    raw: data,
  };
}

export async function download(queryOrUrl, fileType = "mp3") {
  if (!queryOrUrl?.trim()) throw new Error("Input URL or query is required");

  let videoId = extractVideoId(queryOrUrl);
  let meta = null;

  if (!videoId) {
    const results = await search(queryOrUrl);
    if (!results.length) throw new Error("No search results found");
    meta = results[0];
    videoId = meta.id;
  }

  const result = await convert(videoId, fileType);
  if (meta) {
    result.searchMeta = meta;
  }
  return result;
}

export default {
  name: "MP3Juices Downloader",
  description:
    "Search & download YouTube audio/video (MP3/MP4) via MP3Juices/FLVTO engine",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["query", "type"],
  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian, URL YouTube, atau video ID",
      example: "never gonna give you up",
    },
    type: {
      type: "string",
      required: false,
      description: "Format output (mp3 atau mp4)",
      example: "mp3",
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...(req.query || {}), ...(req.body || {}) };
      const query = String(
        params.query || params.q || params.url || params.search || ""
      ).trim();
      const type = String(params.type || params.format || "mp3")
        .trim()
        .toLowerCase() === "mp4"
        ? "mp4"
        : "mp3";

      if (!query) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' (atau 'url'/'q') wajib diisi",
        });
      }

      const result = await download(query, type);
      const { raw, ...clean } = result;

      return res.json({
        status: true,
        creator: "Kadokun",
        query,
        type,
        result: clean,
        metadata: { processing_time: `${Date.now() - startTime}ms` },
      });
    } catch (error) {
      return res.status(502).json({
        status: false,
        message: error?.message || "Service unavailable",
        metadata: { processing_time: `${Date.now() - startTime}ms` },
      });
    }
  },
};
