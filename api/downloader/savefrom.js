/**
 * SaveFrom Downloader — engine ringan (no Puppeteer)
 * Backend : savefrom.co.id → api-wh.savefrom.co.id/api/convert
 * Flow    : signature diambil dari js/link.chunk.js (sha256(sf_url+ts+SECRET)),
 *           SECRET diekstrak runtime via decoder chunk-nya sendiri (node:vm).
 * Support : TikTok, YouTube, Facebook, Instagram, dst (multi-platform).
 * Params  : url (wajib), type (vidio/audio, wajib)
 */
import fs from "fs";
import vm from "node:vm";
import crypto from "node:crypto";
import logger from "../../src/utils/logger.js";

const CHUNK_URL = "https://savefrom.co.id/js/link.chunk.js?ch=e86847080530eb66.js";
const CHUNK_CACHE = "/tmp/savefrom-link-chunk.js";
const APP_URL = "https://savefrom.co.id/js/app.js?id=96052dac5cd653fff24c90fa6af00adc";
const API = "https://api-wh.savefrom.co.id/api/convert";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Posisi string SECRET di dalam link.chunk.js (index + key decoder)
const SECRET_PARTS = [
  [0x2b5, "(uFc"], [0x3be, "pkRS"], [0x254, "z9pS"], [0x342, "[Ft4"],
  [0x482, "%cV["], [0x453, "vf2#"], [0x2f5, "DkoM"], [0x1c0, "zR*("],
  [0x26a, "OdW0"],
];
// Konstanta build _ts: 0x164b742b2c7 + 0x10e909f8727 + -0x21ca66de*0x63d
const TS_CONST = 0x164b742b2c7 + 0x10e909f8727 + -0x21ca66de * 0x63d;

let cachedSecret = null;

async function getChunkCode() {
  if (fs.existsSync(CHUNK_CACHE) && fs.statSync(CHUNK_CACHE).size > 10000) {
    const t = fs.readFileSync(CHUNK_CACHE, "utf8");
    if (!t.startsWith("<!doctype")) return t;
  }
  let res = await fetch(CHUNK_URL, { headers: { "User-Agent": UA } });
  let text = res.ok ? await res.text() : "";
  if (!res.ok || text.startsWith("<!doctype")) {
    // hash chunk bisa berubah — derive ulang dari app.js
    const app = await (await fetch(APP_URL, { headers: { "User-Agent": UA } })).text();
    const hash = (app.match(/\{54:"([0-9a-f]{16})"/) || [])[1];
    if (!hash) throw new Error("Gagal menemukan hash chunk di app.js");
    res = await fetch(`https://savefrom.co.id/js/link.chunk.js?ch=${hash}.js`, { headers: { "User-Agent": UA } });
    text = await res.text();
    if (text.startsWith("<!doctype")) throw new Error("Chunk baru invalid");
  }
  fs.writeFileSync(CHUNK_CACHE, text);
  return text;
}

function extractSecret(chunkCode) {
  // Jalankan hanya bagian decoder (string array + rotasi) — bagian self-defense
  // yang butuh browser globals dilewati.
  const cut = chunkCode.indexOf("var a0_0x72bceb");
  if (cut === -1) throw new Error("Struktur chunk berubah (decoder tidak ditemukan)");
  const prefix = chunkCode.slice(0, cut);
  const ctx = vm.createContext({ Date, Math, String, parseInt, RegExp, Array, decodeURIComponent });
  vm.runInContext(prefix, ctx, { timeout: 10000 });
  const parts = SECRET_PARTS.map(([idx, key]) => {
    const val = vm.runInContext(`a0_0x2a8ba8(${idx}, ${JSON.stringify(key)})`, ctx, { timeout: 5000 });
    if (typeof val !== "string") throw new Error(`Decode gagal untuk index ${idx}`);
    return val;
  });
  return (
    parts[0] + parts[1] + parts[2] + parts[3] + parts[4] +
    "56d2d" + parts[5] + parts[6] + "592a5" + parts[7] + "ffa08" + parts[8] + "68e5"
  );
}

async function getSecret() {
  if (cachedSecret) return cachedSecret;
  const chunk = await getChunkCode();
  cachedSecret = extractSecret(chunk);
  return cachedSecret;
}

async function savefromScrape(targetUrl) {
  const secret = await getSecret();
  const ts = Date.now();
  const sig = crypto.createHash("sha256").update(`${targetUrl}${ts}${secret}`).digest("hex");
  const body = new URLSearchParams({
    sf_url: targetUrl,
    ts: String(ts),
    _ts: String(TS_CONST),
    _tsc: "0",
    _s: sig,
  });

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Origin: "https://savefrom.co.id",
      Referer: "https://savefrom.co.id/",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/plain, */*",
    },
    body: body.toString(),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("Respons upstream bukan JSON"); }

  if (json.code && String(json.code).includes("invalid_request")) {
    cachedSecret = null; // reset cache — secret mungkin sudah berubah
    throw new Error("Signature ditolak upstream");
  }
  if (json.success === false || json.message) {
    throw new Error(json.message || "Upstream error");
  }
  if (!json.url || !json.url.length) {
    throw new Error("Tidak ada media ditemukan untuk URL ini");
  }

  return (json.url || []).map((u) => {
    const format = (u.type || u.ext || "unknown").toLowerCase();
    const isAudio = ["mp3", "aac", "wav", "ogg", "m4a"].includes(format);
    return {
      quality: u.subname || (isAudio ? "audio" : format),
      format,
      type: isAudio ? "audio" : "video",
      url: u.url,
      is_audio: isAudio,
    };
  });
}

export default {
  name: "SaveFrom Downloader",
  description: "Download media from TikTok, YouTube, FB, IG, etc (fast, no browser)",
  category: "Downloader",
  methods: ["GET", "POST"],

  params: ["url", "type"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "Media URL (TikTok, YouTube, FB, IG, etc)",
      example: "https://vt.tiktok.com/ZSqktDNGM/"
    },
    type: {
      type: "string",
      required: true,
      enum: ["vidio", "audio"],
      description: "Tipe hasil unduhan (vidio atau audio)"
    }
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      let url, type;
      if (req.method === "GET") {
        url = req.query.url;
        type = req.query.type;
      } else {
        url = req.body?.url;
        type = req.body?.type;
      }

      if (!url || typeof url !== "string") {
        return res.status(400).json({ status: false, message: "Parameter 'url' is required" });
      }
      if (!type || typeof type !== "string") {
        return res.status(400).json({ status: false, message: "Parameter 'type' is required" });
      }

      const normalizedType = type.trim().toLowerCase() === "vidio" ? "video" : type.trim().toLowerCase();
      if (!["video", "audio"].includes(normalizedType)) {
        return res.status(400).json({ status: false, message: "Parameter 'type' must be either 'vidio' or 'audio'" });
      }

      url = url.trim();
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ status: false, message: "URL tidak valid" });
      }

      const allMedia = await savefromScrape(url);
      const finalData = allMedia.filter((item) => item.type === normalizedType);
      if (!finalData.length) {
        return res.status(404).json({ status: false, message: `Tidak ada media tipe '${normalizedType}' untuk URL ini` });
      }

      return res.json({
        status: true,
        data: finalData,
        duration: `${Date.now() - startTime}ms`
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[SAVEFROM API] Error: ${error.message}`);
      return res.status(500).json({
        status: false,
        message: error.message,
        duration: `${duration}ms`
      });
    }
  }
};
