#!/usr/bin/env node
// tes.js — TranscribeTube CLI (gist ayashiiiyo)
// Usage: node tes.js <youtube-url | video-id | search-query>

// ============ TRANSCRIBE TUBE (gist ayashiiiyo) ============
import dns from "node:dns";
// VPS IPv6 ke upstream timeout — paksa resolve hanya IPv4 untuk fetch di file ini
const _origLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  if (typeof options === "number") options = { family: options };
  options = { ...options, family: 4 };
  return _origLookup.call(dns, hostname, options, callback);
};
export const API_URL = "https://spinnerportugues.com/apis/api_youtube_transcript.php";

const YOUTUBE_REGEXES = [
  /(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i,
  /(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
  /(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
];

function extractId(input) {
  const str = String(input || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  for (const regex of YOUTUBE_REGEXES) {
    const match = str.match(regex);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function resolveId(queryOrUrl) {
  const directId = extractId(queryOrUrl);
  if (directId) return directId;

  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(queryOrUrl)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);

  const html = await res.text();
  const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  if (!match?.[1]) throw new Error(`Video not found for: "${queryOrUrl}"`);
  return match[1];
}

export async function transcript(queryOrUrl) {
  if (!queryOrUrl || typeof queryOrUrl !== "string" || !queryOrUrl.trim()) {
    throw new TypeError("queryOrUrl is required");
  }

  const videoId = await resolveId(queryOrUrl);
  const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const [title, apiRes] = await Promise.all([
    fetch(`https://www.youtube.com/oembed?url=${normalizedUrl}&format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.title || null)
      .catch(() => null),
    fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "okhttp/4.12.0",
      },
      body: JSON.stringify({ url: normalizedUrl }),
    }),
  ]);

  if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);

  const data = await apiRes.json();
  if (data.status !== "success" || !data.transcription) {
    throw new Error(data.transcription || "Transcript unavailable");
  }

  if (data.transcription.startsWith("Erro:")) {
    throw new Error(data.transcription.replace(/\s+/g, " ").trim());
  }

  const text = data.transcription.trim();

  return {
    videoId,
    videoUrl: normalizedUrl,
    title: title || `YouTube Video ${videoId}`,
    transcript: text,
    words: text.split(/\s+/).filter(Boolean).length,
    characters: text.length,
  };
}

async function transcribeMain() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.log("Usage: node tes.js <youtube-url | video-id | search-query>");
    console.log('Contoh: node tes.js https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    process.exitCode = 1;
    return;
  }
  try {
    const r = await transcript(query);
    console.log(JSON.stringify(r, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
    process.exitCode = 1;
  }
}

if (process.argv[2]) transcribeMain();
else { console.log("Usage: node tes.js <youtube-url>"); process.exitCode = 1; }
