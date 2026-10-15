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

const AKUNLAMA_API = "https://akunlama.com/api";

const ADJECTIVES = [
  "sleepy", "fluffy", "sneaky", "bouncy", "fuzzy", "lazy", "happy", "silly", "clever", "tiny",
  "giant", "swift", "calm", "wild", "gentle", "brave", "quiet", "loud", "smooth", "rough",
  "bright", "dark", "warm", "cool", "playful", "curious", "mischievous", "adorable", "charming",
  "witty", "jolly", "cheerful", "mighty", "magical", "sparkling", "glowing", "shiny", "mysterious",
  "ancient", "cosmic", "electric", "golden", "silver", "purple", "emerald", "crimson", "azure",
  "violet", "dancing", "singing", "jumping", "flying", "swimming", "running", "climbing", "sliding",
  "smiling", "laughing", "giggling", "whispering", "dreaming", "wondering", "exploring", "discovering",
  "cozy", "snuggly", "cuddly", "tender", "sweet", "sour", "spicy", "minty", "fresh",
  "crispy", "soft", "silky", "velvet", "cotton", "wooly", "feathery", "stormy", "sunny",
  "cloudy", "misty", "frosty", "snowy", "rainy", "windy", "peppy", "zippy", "snappy",
  "perky", "quirky", "funky", "groovy", "trendy"
];

const NOUNS = [
  "kitten", "cat", "tiger", "lion", "panda", "fox", "wolf", "bear", "rabbit", "mouse",
  "bird", "fish", "frog", "bee", "butterfly", "owl", "penguin", "dolphin", "whale", "shark",
  "octopus", "spider", "ant", "dog", "hamster", "guinea", "ferret", "hedgehog", "chinchilla",
  "squirrel", "raccoon", "otter", "seal", "walrus", "elephant", "giraffe", "zebra", "hippo",
  "rhino", "monkey", "koala", "kangaroo", "sloth", "alpaca", "llama", "sheep", "goat",
  "pig", "duck", "goose", "swan", "flamingo", "parrot", "peacock", "robin", "sparrow",
  "eagle", "hawk", "falcon", "hummingbird", "woodpecker", "toucan", "pelican", "crane", "turtle",
  "lizard", "snake", "gecko", "iguana", "chameleon", "salamander", "newt", "salmon", "tuna",
  "cod", "bass", "trout", "pike", "carp", "goldfish", "starfish", "seahorse", "jellyfish",
  "coral", "anemone", "urchin", "crab", "lobster", "snail", "slug", "worm", "caterpillar",
  "ladybug", "firefly", "dragonfly", "cricket", "unicorn", "dragon", "phoenix", "griffin", "pegasus",
  "fairy", "wizard", "knight", "ninja", "pirate", "robot", "alien", "ghost", "vampire",
  "witch", "angel", "cookie", "muffin", "cupcake", "donut", "pretzel", "bagel", "waffle",
  "pancake", "pizza", "taco", "burger", "sandwich", "soup", "salad", "pasta", "noodle",
  "coffee", "tea", "cocoa", "juice", "soda", "smoothie", "milkshake", "lemonade", "star",
  "moon", "sun", "planet", "comet", "meteor", "galaxy", "nebula", "cloud", "rainbow",
  "lightning", "thunder", "breeze", "storm", "snowflake", "raindrop", "mountain", "valley", "river",
  "ocean", "lake", "forest", "desert", "island", "castle", "tower", "bridge", "garden",
  "park", "beach", "cave", "waterfall"
];

/**
 * Buat alamat email sementara dari akunlama.com
 */
function generateAkunlamaEmail() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 999) + 1;
  const recipient = `${adj}-${noun}-${num}`;
  return {
    recipient,
    email: `${recipient}@akunlama.com`,
    adj,
    noun,
    num
  };
}

function generateRandomUsername(adj, noun, num) {
  let candidate = `${adj}_${noun}_${num}`.toLowerCase();
  if (candidate.length > 20) {
    candidate = `${adj}_${noun}`.slice(0, 20).toLowerCase();
  }
  if (candidate.length < 3) {
    candidate = `user_${Math.floor(Math.random() * 89999 + 10000)}`;
  }
  return candidate;
}

/**
 * Polling dan baca OTP dari akunlama.com
 */
async function fetchAkunlamaOtp(recipient, maxAttempts = 25, delayMs = 2000) {
  logger.info(`[REACH-CH-VIP] Menunggu email OTP masuk di akunlama.com (${recipient})...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, delayMs));
    try {
      const res = await fetch(`${AKUNLAMA_API}/list?recipient=${encodeURIComponent(recipient)}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });
      
      if (!res.ok) continue;
      const list = await res.json();
      
      if (Array.isArray(list) && list.length > 0) {
        const item = list[0];
        const preview = item.preview || '';
        const subject = item?.message?.headers?.subject || '';
        
        let otpMatch = preview.match(/\b(\d{6})\b/) || subject.match(/\b(\d{6})\b/);
        
        if (!otpMatch && item.storage?.region && item.storage?.key) {
          try {
            const htmlRes = await fetch(`${AKUNLAMA_API}/getHtml?region=${item.storage.region}&key=${item.storage.key}`);
            const html = await htmlRes.text();
            otpMatch = html.match(/\b(\d{6})\b/);
          } catch {}
        }
        
        if (otpMatch) {
          const otp = otpMatch[1];
          logger.info(`[REACH-CH-VIP] OTP berhasil didapatkan: ${otp}`);
          return otp;
        }
      }
    } catch (err) {
      logger.warn(`[REACH-CH-VIP] Polling attempt ${attempt} error: ${err.message}`);
    }
  }
  
  throw new Error(`Timeout: Tidak ada OTP masuk ke ${recipient}@akunlama.com.`);
}

/**
 * Registrasi akun baru otomatis menggunakan Akunlama.com + Verifikasi OTP
 */
async function registerFreshAccount() {
  const { recipient, email, adj, noun, num } = generateAkunlamaEmail();
  const password = `P@ss_${crypto.randomBytes(4).toString('hex')}`;
  const username = generateRandomUsername(adj, noun, num);

  logger.info(`[REACH-CH-VIP] Registrasi akun baru via Akunlama: ${email} (username: ${username})`);

  // 1. Kirim OTP
  const sendRes = await fetch(`${BASE_URL}/api/otp?action=send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  const sendData = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok || !sendData.ok) {
    throw new Error(`Gagal mengirim OTP: ${sendData.error || 'HTTP ' + sendRes.status}`);
  }

  // 2. Ambil OTP dari Akunlama
  const otp = await fetchAkunlamaOtp(recipient);

  // 3. Verifikasi OTP
  const verifRes = await fetch(`${BASE_URL}/api/otp?action=verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp })
  });
  const verifData = await verifRes.json().catch(() => ({}));
  if (!verifRes.ok || !verifData.ok) {
    throw new Error(`Verifikasi OTP gagal: ${verifData.error || 'HTTP ' + verifRes.status}`);
  }

  // 4. Buat Akun Firebase
  const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const signUpData = await signUpRes.json();
  if (!signUpRes.ok || signUpData.error) {
    throw new Error(`Gagal membuat akun Firebase: ${JSON.stringify(signUpData.error || signUpData)}`);
  }

  // 5. Simpan Username
  await fetch(`${BASE_URL}/api/profile`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${signUpData.idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username })
  });

  const creds = { username, email, password };
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
 * Dapatkan token yang valid, auto-rotate jika limit habis atau dibanned
 */
async function getActiveToken() {
  let creds = null;
  if (fs.existsSync(SESSION_FILE)) {
    try {
      creds = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    } catch {}
  }

  if (!creds || !creds.email || !creds.password || creds.password === '...') {
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

  // Cek limit & status akun saat ini
  const profileRes = await fetch(`${BASE_URL}/api/profile`, {
    headers: { "Authorization": `Bearer ${loginData.idToken}` }
  });
  const profile = await profileRes.json().catch(() => null);

  if (profile?.error) {
    logger.warn(`[REACH-CH-VIP] Akun bermasalah (${profile.error}). Melakukan rotasi akun baru...`);
    return await registerFreshAccount();
  }

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
