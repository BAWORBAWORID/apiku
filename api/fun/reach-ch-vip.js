/**
 * Reach CH VIP — WhatsApp Channel Reaction Automation & Auto-Detector
 * Fitur   : 
 *   - Auto Detect Channel: membedakan link postingan vs link profil channel.
 *   - Stalk Channel: membaca info channel jika input adalah link profil channel (nama, followers, deskripsi, avatar).
 *   - Mengirim reaksi emoji ke postingan channel WhatsApp via VIP Queue Solver & Unlimited Auto Account Rotation.
 *   - Multi-Emoji: memisahkan emoji berbeda dan mengirimkan masing-masing reaksinya.
 *   - X-Forwarded-For support & auto IP rotation.
 * 
 * GET  /api/fun/reach-ch-vip?link=<url>&emoji=<emoji>
 * POST /api/fun/reach-ch-vip -d {"link": "...", "emoji": "..."}
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import logger from '../../src/utils/logger.js';

const FIREBASE_API_KEY = "AIzaSyCSxs1ECH_kC-1DNpRbM8h07NNeWfCkSrM";
const BASE_URL = "https://kurezaprojecttt.my.id";
const SESSION_FILE = path.resolve(process.cwd(), 'data/reach_vip_session.json');

const POST_RE = /^https?:\/\/(www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/(\d+)/i;
const CHANNEL_PROFILE_RE = /^https?:\/\/(www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/?$/i;

// Daftar Saluran Terlindungi (Protected Channels)
const PROTECTED_CHANNELS = new Set([
  //'0029Vb8vO7o2f3EEsjefzm0w'
]);

/**
 * Pisahkan emoji yang berbeda (bisa dipisah koma, spasi, atau digabung langsung)
 */
function parseEmojis(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.flatMap(item => parseEmojis(item)))];
  }

  const str = String(raw).trim();
  if (!str) return [];

  // Jika user memisahkan dengan koma atau pipe
  if (str.includes(',') || str.includes('|')) {
    const parts = str.split(/[,|]+/).map(s => s.trim()).filter(Boolean);
    return [...new Set(parts.flatMap(p => parseEmojis(p)))];
  }

  // Jika user memisahkan dengan spasi
  if (str.includes(' ')) {
    const parts = str.split(/\s+/).map(s => s.trim()).filter(Boolean);
    return [...new Set(parts.flatMap(p => parseEmojis(p)))];
  }

  // Jika emoji digabung berurutan (misal "🥶🥵🔥")
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = [...segmenter.segment(str)]
    .map(s => s.segment.trim())
    .filter(Boolean);

  return [...new Set(segments)];
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x2022;/g, "•")
    .replace(/&#(\d+);/g, (_m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    });
}

/**
 * Ekstrak meta tag dari HTML
 */
function extractMeta(html, property) {
  const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i");
  const m1 = html.match(r1);
  if (m1) return m1[1];
  const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i");
  const m2 = html.match(r2);
  if (m2) return m2[1];
  return null;
}

/**
 * Parsing deskripsi dan followers channel
 */
function parseChannelDescription(desc) {
  if (!desc) return { followers: null, followers_raw: null, cleanDescription: "" };
  const clean = decodeHtmlEntities(desc);

  const channelFormat = clean.match(/^Channel\s*•\s*([\d,.KMBkmb]+)\s*followers?\s*•\s*([\s\S]*)$/i);
  if (channelFormat) {
    const rawF = channelFormat[1].trim();
    return {
      followers_raw: `${rawF} followers`,
      followers: parseNumber(rawF),
      cleanDescription: cleanTrailingJoin(channelFormat[2].trim())
    };
  }

  const channelOnly = clean.match(/^Channel\s*•\s*([\d,.KMBkmb]+)\s*followers?\s*$/i);
  if (channelOnly) {
    const rawF = channelOnly[1].trim();
    return {
      followers_raw: `${rawF} followers`,
      followers: parseNumber(rawF),
      cleanDescription: ""
    };
  }

  const followerMatch = clean.match(/([\d,.]+)\s*followers?/i);
  if (followerMatch) {
    const rawF = followerMatch[1].trim();
    const descWithoutFollowers = clean.replace(/^[\s\S]*?\b[\d,.]+\s*followers?\s*•?\s*/i, "").trim();
    return {
      followers_raw: `${rawF} followers`,
      followers: parseNumber(rawF),
      cleanDescription: cleanTrailingJoin(descWithoutFollowers)
    };
  }

  return { followers: null, followers_raw: null, cleanDescription: cleanTrailingJoin(clean) };
}

function cleanTrailingJoin(text) {
  if (!text) return "";
  return text.replace(/\.?\s*Join\s+[\d,.KMBkmb]+\s+followers?\s+(?:to\s+|for\s+).*$/i, "").trim();
}

function parseNumber(text) {
  if (!text) return 0;
  const clean = text.replace(/,/g, "").toLowerCase();
  if (clean.includes("k")) return Math.round(parseFloat(clean) * 1000);
  if (clean.includes("m")) return Math.round(parseFloat(clean) * 1000000);
  const num = parseInt(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Stalk / Membaca informasi profil channel WhatsApp
 */
async function stalkChannelInfo(channelUrl, customIp = null) {
  const match = channelUrl.match(CHANNEL_PROFILE_RE);
  const channelId = match ? match[2] : channelUrl.split('/').pop().split('?')[0];
  const url = `https://www.whatsapp.com/channel/${channelId}`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  if (customIp) {
    headers["X-Forwarded-For"] = customIp;
    headers["X-Real-IP"] = customIp;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Gagal membaca info saluran WhatsApp (HTTP ${res.status})`);
  }

  const html = await res.text();
  const titleMeta = extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || "";
  const avatar = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || null;
  const descMeta = extractMeta(html, "og:description") || extractMeta(html, "twitter:description") || "";
  const { followers, followers_raw, cleanDescription } = parseChannelDescription(descMeta);

  let channelName = titleMeta.replace(/ on WhatsApp$/, "").replace(/ - WhatsApp channel$/, "").trim();
  if (!channelName) channelName = channelId;

  const isVerified = html.includes('verified') || html.includes('Verified');

  return {
    channel_id: channelId,
    name: decodeHtmlEntities(channelName) || channelId,
    avatar: avatar ? decodeHtmlEntities(avatar) : null,
    description: decodeHtmlEntities(cleanDescription) || null,
    followers_raw: followers_raw || null,
    followers: followers || 0,
    verified: isVerified,
    profile_url: url
  };
}

/**
 * Pecahkan captcha aritmatika
 */
function solveCaptcha(question, token) {
  try {
    const parts = token.split('.');
    if (parts[0]) {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
      if (payload.a !== undefined) return String(payload.a);
    }
  } catch {}

  const cleanQ = question
    .replace(/[^0-9+\-*/.]/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');
  return String(Function(`'use strict'; return (${cleanQ})`)());
}

/**
 * Generate akun baru secara otomatis & instan
 */
async function registerFreshAccount() {
  const rand = crypto.randomBytes(4).toString('hex');
  const creds = {
    username: `usr_${rand}`,
    email: `vip_${rand}@gmail.com`,
    password: `P@ss_${crypto.randomBytes(4).toString('hex')}`
  };

  const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password, returnSecureToken: true })
  });

  const signUpData = await signUpRes.json();
  if (!signUpRes.ok || signUpData.error) {
    throw new Error(`Gagal register akun: ${JSON.stringify(signUpData.error || signUpData)}`);
  }

  // Set username
  await fetch(`${BASE_URL}/api/profile`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${signUpData.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username: creds.username })
  });

  try {
    const dir = path.dirname(SESSION_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(creds, null, 2));
  } catch (err) {
    logger.warn(`[REACH-CH-VIP] Gagal menyimpan file session: ${err.message}`);
  }

  return { creds, idToken: signUpData.idToken };
}

/**
 * Dapatkan token yang valid, auto-rotate jika limit habis
 */
async function getActiveToken() {
  let creds = null;
  if (fs.existsSync(SESSION_FILE)) {
    try {
      creds = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch {}
  }

  if (!creds) {
    return await registerFreshAccount();
  }

  // Login akun tersimpan
  const loginRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password, returnSecureToken: true })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || loginData.error) {
    return await registerFreshAccount();
  }

  // Cek limit akun saat ini
  const profileRes = await fetch(`${BASE_URL}/api/profile`, {
    headers: { "Authorization": `Bearer ${loginData.idToken}` }
  });
  const profile = await profileRes.json().catch(() => null);

  if (profile && profile.usage && profile.usage.count >= profile.usage.limit) {
    logger.info(`[REACH-CH-VIP] Kuota akun ${creds.username} habis (${profile.usage.count}/${profile.usage.limit}). Melakukan rotasi akun baru...`);
    return await registerFreshAccount();
  }

  return { creds, idToken: loginData.idToken };
}

/**
 * Bersihkan data creator / author dari respon
 */
function sanitizeResponse(data) {
  if (!data || typeof data !== 'object') return data;
  const copy = Array.isArray(data) ? [...data] : { ...data };
  delete copy.author;
  delete copy.creator;
  delete copy.dev;
  delete copy.developer;
  delete copy.limit_deducted;
  delete copy.limit_remaining;
  if (copy.result && typeof copy.result === 'object') {
    delete copy.result.author;
    delete copy.result.creator;
  }
  return copy;
}

function randomIp() {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `${r()}.${r()}.${r()}.${r()}`;
}

/**
 * Kirim 1 reaksi emoji ke WhatsApp Channel
 */
async function sendSingleReaction(channelUrl, emoji, clientIp = null) {
  const ip = clientIp || randomIp();
  const { idToken } = await getActiveToken();

  // Ambil dan pecahkan captcha
  const captchaRes = await fetch(`${BASE_URL}/api/captcha`, {
    headers: {
      "X-Forwarded-For": ip,
      "X-Real-IP": ip
    }
  });
  const captchaData = await captchaRes.json();
  const captchaAnswer = solveCaptcha(captchaData.question, captchaData.token);

  const rchParams = new URLSearchParams({
    url: channelUrl,
    reaction: emoji,
    captchaToken: captchaData.token,
    captchaAnswer: captchaAnswer
  });

  const res = await fetch(`${BASE_URL}/api/rch?${rchParams.toString()}`, {
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "X-Forwarded-For": ip,
      "X-Real-IP": ip
    }
  });

  let data = await res.json().catch(async () => ({ raw: await res.text() }));
  data = sanitizeResponse(data);

  return {
    emoji,
    ipUsed: ip,
    status: res.status,
    success: res.ok && data?.result?.success === true,
    data
  };
}

export default {
  name: "Reach CH VIP",
  description: "Kirim reaksi emoji otomatis ke postingan WhatsApp Channel via VIP Engine (Auto Detect Channel, Multi-Emoji, Auto Bypass Limit & Auto Solver)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["link", "emoji"],
  paramsSchema: {
    link: {
      type: "string",
      required: true,
      default: "",
      description: "Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/0029Vb8kYQcK5cDFoQ3NAK2x/108) atau link profil channel",
      example: ""
    },
    emoji: {
      type: "string",
      required: false,
      default: "",
      description: "Emoji reaksi, bisa 1 atau beberapa emoji (contoh: 🥶, 🥵, 🔥 atau 🥶🥵🔥)",
      example: "🥶, 🥵"
    },
    wait: {
      type: "boolean",
      required: false,
      default: true,
      description: "Tunggu hasil pemrosesan (default true). Set false untuk background mode."
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const rawLink = String(params.link || params.url || params.channelLink || '').trim();
      const rawEmoji = params.emoji || params.emojis || '';
      const clientIp = params.ip || req?.headers?.['x-forwarded-for'] || req?.ip || randomIp();
      const shouldWait = params.wait !== 'false' && params.wait !== false;

      if (!rawLink) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'link' wajib diisi dengan link WhatsApp Channel."
        });
      }

      // 0. PROTECT: Cek apakah saluran masuk daftar dilindungi (Protected Channel)
      const extractedChannelId = (rawLink.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i) || [])[1];
      if (extractedChannelId && PROTECTED_CHANNELS.has(extractedChannelId)) {
        logger.warn(`[REACH-CH-VIP] Akses ditolak: Saluran ${extractedChannelId} dilindungi.`);
        return res.status(403).json({
          status: false,
          protected: true,
          channel_id: extractedChannelId,
          message: "Saluran ini dilindungi (Protected Channel). Reaksi emoji dan reach dinonaktifkan untuk saluran ini."
        });
      }

      // 1. DETEKSI: Apakah link adalah Link Profil Channel (bukan postingan)?
      if (CHANNEL_PROFILE_RE.test(rawLink)) {
        logger.info(`[REACH-CH-VIP] Link terdeteksi sebagai PROFIL SALURAN: ${rawLink}. Membaca info saluran (Stalk CH)...`);
        
        try {
          const channelData = await stalkChannelInfo(rawLink, clientIp);
          return res.status(200).json({
            status: true,
            detected_type: "channel_profile",
            message: "Tautan terdeteksi sebagai PROFIL SALURAN WhatsApp, bukan link postingan. Reaksi emoji memerlukan link postingan spesifik (format: https://whatsapp.com/channel/<id>/<id_postingan>). Berikut informasi saluran yang terdeteksi:",
            hint: "Silakan buka saluran dan salin tautan postingan spesifik (tekan lama pesan > Bagikan / Salin Tautan) untuk mengirim reaksi emoji.",
            channel: channelData
          });
        } catch (stalkErr) {
          return res.status(400).json({
            status: false,
            detected_type: "channel_profile",
            message: "Tautan adalah profil saluran WhatsApp (bukan link postingan). Reaksi emoji memerlukan link postingan spesifik (format: https://whatsapp.com/channel/<id>/<id_postingan>).",
            error: stalkErr.message
          });
        }
      }

      // 2. DETEKSI: Apakah link adalah Link Postingan Channel yang valid?
      if (!POST_RE.test(rawLink)) {
        return res.status(400).json({
          status: false,
          detected_type: "invalid",
          message: "Format tautan WhatsApp tidak valid. Masukkan link postingan (contoh: https://whatsapp.com/channel/0029Vb8kYQcK5cDFoQ3NAK2x/108) atau link profil channel (contoh: https://whatsapp.com/channel/0029Vb8vO7o2f3EEsjefzm0w)."
        });
      }

      // 3. PROSES REAKSI POSTINGAN:
      const emojis = parseEmojis(rawEmoji);
      if (!emojis.length) {
        return res.status(400).json({
          status: false,
          detected_type: "post",
          message: "Parameter 'emoji' wajib diisi dengan minimal 1 emoji reaksi untuk postingan ini."
        });
      }

      logger.info(`[REACH-CH-VIP] Processing reaction [${emojis.join(', ')}] -> ${rawLink} (IP: ${clientIp}, wait=${shouldWait})`);

      // Mode Asinkron / Latar Belakang jika explicitly wait=false
      if (!shouldWait) {
        (async () => {
          for (const emo of emojis) {
            try {
              const r = await sendSingleReaction(rawLink, emo, clientIp);
              logger.info(`[REACH-CH-VIP] Background [${emo}]: ${r.success ? 'OK' : 'FAIL'}`);
            } catch (err) {
              logger.error(`[REACH-CH-VIP] Background Error [${emo}]: ${err.message}`);
            }
          }
        })();

        return res.status(200).json({
          status: true,
          detected_type: "post",
          message: "Reaksi sedang diproses di antrean latar belakang.",
          result: {
            link: rawLink,
            emojis,
            totalEmojis: emojis.length,
            ipUsed: clientIp,
            mode: "background"
          }
        });
      }

      // Mode Sinkron (Default): Proses dan tunggu hingga selesai
      const results = [];
      for (const emo of emojis) {
        try {
          const out = await sendSingleReaction(rawLink, emo, clientIp);
          results.push(out);
        } catch (err) {
          results.push({
            emoji: emo,
            status: 500,
            success: false,
            error: err.message
          });
        }
      }

      const allSuccess = results.some(r => r.success);

      return res.status(allSuccess ? 200 : 500).json({
        status: allSuccess,
        detected_type: "post",
        message: allSuccess ? "Reaksi VIP berhasil dikirim ke postingan saluran!" : "Gagal memproses reaksi ke postingan saluran.",
        result: {
          link: rawLink,
          emojis,
          totalEmojis: emojis.length,
          details: results
        }
      });

    } catch (err) {
      logger.error(`[REACH-CH-VIP] Internal error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan internal pada server VIP reaction"
      });
    }
  }
};
