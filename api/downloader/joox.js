/**
 * Joox Downloader — search, metadata, lyrics, stream, download
 * Base: https://www.joox.com (via scraper logic dari tes.js)
 *
 * GET  /api/downloader/joox?action=search&query=lagu+galau&region=id
 * GET  /api/downloader/joox?action=metadata&id=<songId>
 * GET  /api/downloader/joox?action=lyrics&id=<songId>
 * GET  /api/downloader/joox?action=stream&query=<songId|judul>   → streaming audio m4a
 * GET  /api/downloader/joox?action=download&query=<songId|judul> → audio + lyrics (base64)
 */

const BASE_URL = "https://www.joox.com";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const CDN_HOSTS = [
  "https://id.stream.music.joox.com/",
  "https://hk.stream.music.joox.com/",
  "https://my.stream.music.joox.com/",
  "https://th.stream.music.joox.com/",
  "https://stream.music.joox.com/",
];

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Failed to parse Next.js state from response");
  return JSON.parse(match[1]);
}

async function jooxSearch(keyword, region = "id") {
  const url = `${BASE_URL}/${region}/search/${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Search request failed with status: ${res.status}`);
  const html = await res.text();
  const nextData = extractNextData(html);
  const items = nextData.props?.pageProps?.searchSections?.songs?.item_list || [];
  return items
    .map((item) => {
      const song = item.song?.[0]?.song_info;
      if (!song) return null;
      return {
        id: song.id,
        name: song.name,
        singer: (song.singer_list || []).map((s) => s.name).join(", "),
        album: song.album?.name || "",
        duration: song.interval || 0,
      };
    })
    .filter(Boolean);
}

async function jooxMetadata(songId, region = "id") {
  const url = `${BASE_URL}/${region}/single/${encodeURIComponent(songId)}`;
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Metadata request failed with status: ${res.status}`);
  const html = await res.text();
  const nextData = extractNextData(html);
  const info = nextData.props?.pageProps?.singleInfo;
  if (!info) throw new Error(`No track metadata found for id: ${songId}`);
  return {
    id: info.id || songId,
    mid: info.songmid,
    title: info.title || info.msong,
    artist: info.msinger,
    artists: (info.artistList || []).map((artist) => ({ id: artist.id, name: artist.name })),
    album: {
      id: info.malbumid,
      name: info.albumName || info.malbum,
    },
    duration: info.minterval,
    publicTime: info.publicTime,
    cover: info.imgSrc,
  };
}

async function jooxLyrics(songId, region = "id") {
  const url = `${BASE_URL}/${region}/single/${encodeURIComponent(songId)}`;
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) throw new Error(`Lyrics request failed with status: ${res.status}`);
  const html = await res.text();
  const nextData = extractNextData(html);
  const rawBase64 = nextData.props?.pageProps?.singleLyric;
  if (!rawBase64) return [];
  const decoded = Buffer.from(rawBase64, "base64").toString("utf-8");
  const lines = decoded.split(/\r?\n/).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2}(?:\.\d+)?)\](.*)$/);
    if (match) {
      parsed.push({
        time: parseInt(match[1], 10) * 60 + parseFloat(match[2]),
        text: match[3].trim(),
      });
    }
  }
  return parsed;
}

async function jooxStreamUrl(queryOrIdOrMid, region = "id") {
  let mid = queryOrIdOrMid;
  if (!/^[a-zA-Z0-9]{14}$/.test(mid)) {
    const meta = await jooxMetadata(queryOrIdOrMid, region);
    mid = meta.mid;
  }
  for (const host of CDN_HOSTS) {
    const candidate = `${host}C100${mid}.m4a`;
    try {
      const head = await fetch(candidate, { method: "HEAD", headers: DEFAULT_HEADERS });
      if (head.ok && head.headers.get("content-type")?.includes("audio")) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return `${CDN_HOSTS[0]}C100${mid}.m4a`;
}

async function resolveSongId(queryOrId, region = "id") {
  if (/[+/=]/.test(queryOrId) || /^[A-Za-z0-9+/=]{20,}$/.test(queryOrId)) {
    return queryOrId;
  }
  const results = await jooxSearch(queryOrId, region);
  if (!results.length) throw new Error(`No song found for: ${queryOrId}`);
  return results[0].id;
}
export default {
  name: "Joox Downloader",
  description:
    "Cari, info, lirik, streaming, dan download lagu dari Joox. Support streaming audio langsung (m4a) dan download lengkap dengan lirik.",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["action", "query", "id", "region"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "search",
      enum: ["search", "metadata", "lyrics", "stream", "download"],
      description:
        "Aksi: search (default), metadata, lyrics, stream (audio streaming), download (audio base64 + lyrics)",
    },
    query: {
      type: "string",
      required: false,
      description: "Judul lagu (untuk search/stream/download) atau songId",
      example: "lagu galau",
    },
    id: {
      type: "string",
      required: false,
      description: "Song ID Joox (untuk metadata/lyrics/stream/download)",
      example: "AMzdtZ93dUHuwr2kiKwkZA==",
    },
    region: {
      type: "string",
      required: false,
      default: "id",
      enum: ["id", "hk", "my", "th"],
      description: "Region Joox",
    },
  },

  async run(req, res) {
    const { action, query, id, region } = { ...req.query, ...req.body };
    const reg = ["id", "hk", "my", "th"].includes(region) ? region : "id";
    const act = String(action || "search").toLowerCase();

    try {
      // ---------- SEARCH ----------
      if (act === "search") {
        const q = query || id;
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action search",
          });
        }
        const results = await jooxSearch(q, reg);
        return res.json({
          status: true,
          action: "search",
          query: q,
          region: reg,
          total: results.length,
          result: results,
        });
      }

      // ---------- METADATA ----------
      if (act === "metadata") {
        const songId = id || query;
        if (!songId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'query' wajib diisi untuk action metadata",
          });
        }
        const resolved = await resolveSongId(songId, reg);
        const meta = await jooxMetadata(resolved, reg);
        return res.json({
          status: true,
          action: "metadata",
          region: reg,
          result: meta,
        });
      }

      // ---------- LYRICS ----------
      if (act === "lyrics") {
        const songId = id || query;
        if (!songId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'query' wajib diisi untuk action lyrics",
          });
        }
        const resolved = await resolveSongId(songId, reg);
        const lyrics = await jooxLyrics(resolved, reg);
        return res.json({
          status: true,
          action: "lyrics",
          region: reg,
          total: lyrics.length,
          result: lyrics,
        });
      }

      // ---------- STREAM ----------
      if (act === "stream") {
        const songId = id || query;
        if (!songId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'query' wajib diisi untuk action stream",
          });
        }
        const resolved = await resolveSongId(songId, reg);
        const meta = await jooxMetadata(resolved, reg);
        const streamUrl = await jooxStreamUrl(resolved, reg);

        const upstream = await fetch(streamUrl, { headers: DEFAULT_HEADERS });
        if (!upstream.ok) {
          return res.status(502).json({
            status: false,
            message: `Upstream audio failed with status ${upstream.status}`,
          });
        }

        res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/mp4");
        const len = upstream.headers.get("content-length");
        if (len) res.setHeader("Content-Length", len);
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${(meta.title || "joox").replace(/[^\w\s-]/g, "")}.m4a"`
        );
        res.setHeader("X-Stream-Url", streamUrl);
        res.setHeader("X-Song-Name", meta.title || "");

        const reader = upstream.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        };
        pump().catch((e) => {
          console.error("joox stream error:", e.message);
          if (!res.headersSent) {
            res.status(500).json({ status: false, message: "Stream failed" });
          } else {
            res.end();
          }
        });
        req.on("close", () => reader.cancel().catch(() => {}));
        return;
      }

      // ---------- DOWNLOAD ----------
      if (act === "download") {
        const songId = id || query;
        if (!songId) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id' atau 'query' wajib diisi untuk action download",
          });
        }
        const resolved = await resolveSongId(songId, reg);
        const meta = await jooxMetadata(resolved, reg);
        const lyrics = await jooxLyrics(resolved, reg).catch(() => []);
        const streamUrl = await jooxStreamUrl(resolved, reg);

        const audioRes = await fetch(streamUrl, { headers: DEFAULT_HEADERS });
        if (!audioRes.ok) {
          return res.status(502).json({
            status: false,
            message: `Audio download failed with status ${audioRes.status}`,
          });
        }
        const buf = Buffer.from(await audioRes.arrayBuffer());

        return res.json({
          status: true,
          action: "download",
          region: reg,
          result: {
            metadata: meta,
            lyrics,
            lyrics_count: lyrics.length,
            streamUrl,
            audio_base64: buf.toString("base64"),
            audio_size: buf.length,
          },
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action tidak dikenal: ${act}. Gunakan: search, metadata, lyrics, stream, download`,
      });
    } catch (err) {
      console.error("joox error:", err.message);
      return res.status(500).json({
        status: false,
        message: err.message || "Joox scraper gagal",
      });
    }
  },
};
