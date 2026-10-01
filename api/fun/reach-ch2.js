/**
 * Reach CH v2 — WhatsApp Channel Reaction via ALDOXD REACTION
 * Provider : aldomarketid.my.id (ALDOXD REACTION)
 * Fitur    : Auto register akun (+5 koin) -> auto daily check-in (+1 koin) -> kirim reaction
 * Biaya    : 1 koin per request reaction
 * Pool     : api/fun/assets/aldo-account.json
 *
 * Alur upstream:
 *   1. POST /api/login        { action:'register', name, password, ref } -> +5 koin + apiKey
 *   2. POST /api/checkin      { id }                                     -> +1 koin (sekali/hari)
 *   3. POST /api/whatsapp/reactch?apikey=KEY  { url, reaction }          -> -1 koin / request
 *
 * Catatan hasil tes (2026-09-28):
 *   - Register / checkin / get-user / feed : OK
 *   - Kirim reaction                       : upstream balas HTTP 522
 *     ("Reaction gagal (coin tidak dipotong)") untuk SEMUA url, bukan cuma url tertentu.
 *     Validasi server (400/401) normal, jadi indikasi kuat pengirim reaction (WA engine) sedang down.
 */

import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../src/utils/logger.js';

export const BASE_URL = 'https://aldomarketid.my.id';

/** Biaya 1 coin per request reaction. */
export const REACT_COST = 1;
/** Jeda minimal antar reaction per akun (detik). */
export const COOLDOWN_SECONDS = 20;
/** Maksimal emoji per request. */
export const MAX_EMOJIS = 5;
/** Batas akun yang disimpan di pool. */
export const POOL_LIMIT = 20;
/** File pool akun. */
export const POOL_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'assets/aldo-account.json');

/** Emoji yang disediakan UI ALDOXD REACTION. */
export const ALLOWED_EMOJIS = [
  '👍', '❤️', '🔥', '😂', '😮', '😢', '🙏', '👏', '🎉', '💯', '😍', '🤝', '🚀',
  '⭐', '💪', '😎', '🤩', '💖', '✨', '🏆', '👑', '💣', '🌟', '🫡', '❤️‍🔥',
];

const API_KEY_HEADER = 'X-API-Key';
const CHANNEL_URL_RE = /^https?:\/\/(www\.)?whatsapp\.com\/channel\/[^/]+\/\d+/i;

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
};

const http = axios.create({ baseURL: BASE_URL, headers: DEFAULT_HEADERS, timeout: 40000 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomString(length = 5) {
  return crypto.randomBytes(8).toString('hex').slice(0, length);
}

/** Buat kredensial acak (username unik + password kuat). */
export function autoCredentials(prefix = 'aldo') {
  return {
    name: `${prefix}_${randomString(5)}`,
    password: `Pass#${randomString(4).toUpperCase()}!${Math.floor(Math.random() * 90 + 10)}`,
  };
}

/** Request wrapper: selalu balikin { ok, httpStatus, data, error } tanpa throw. */
async function httpRequest(method, url, { data, params, headers, timeout } = {}) {
  try {
    const res = await http.request({ method, url, data, params, headers, timeout });
    return { ok: true, httpStatus: res.status, data: res.data, error: null };
  } catch (err) {
    const resp = err.response;
    return {
      ok: false,
      httpStatus: resp?.status || 0,
      data: resp?.data ?? null,
      error: resp?.data?.message || err.message,
    };
  }
}

function isDuplicateName(message = '') {
  return /sudah|digunakan|terdaftar|exists|taken|terpakai/i.test(String(message));
}

/* ------------------------------------------------------------------ *
 * Emoji helpers
 * ------------------------------------------------------------------ */

/** Normalisasi emoji: string dipisah koma atau gabungan grapheme, maks 5. */
export function normalizeEmojis(emojis) {
  let list;
  if (Array.isArray(emojis)) {
    list = emojis.map((e) => String(e).trim()).filter(Boolean);
  } else {
    const raw = String(emojis ?? '').trim();
    if (!raw) list = [];
    else if (raw.includes(',')) list = raw.split(',').map((e) => e.trim()).filter(Boolean);
    else {
      const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
      list = [...segmenter.segment(raw)]
        .map((s) => s.segment)
        .filter((s) => s.trim() && s !== ' ');
    }
  }

  const clean = [...new Set(list)].slice(0, MAX_EMOJIS);
  const finalList = clean.length ? clean : ['👍'];
  return { list: finalList, csv: finalList.join(',') };
}

/* ------------------------------------------------------------------ *
 * Account pool (api/fun/assets/aldo-account.json)
 * ------------------------------------------------------------------ */

export function loadAccountPool() {
  try {
    const parsed = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccountPool(list) {
  try {
    fs.mkdirSync(path.dirname(POOL_FILE), { recursive: true });
    fs.writeFileSync(POOL_FILE, JSON.stringify(list.slice(-POOL_LIMIT), null, 2));
  } catch (err) {
    logger.error(`[REACH-CH2] Gagal simpan pool: ${err.message}`);
  }
}

/** Simpan/update akun di pool (upsert by id). */
export function rememberAccount(account = {}) {
  if (!account?.id) return [];
  const list = loadAccountPool();
  const idx = list.findIndex((a) => a.id === account.id);
  const entry = {
    id: account.id,
    name: account.name || null,
    password: account.password || null,
    apiKey: account.apiKey || null,
    coin: account.points ?? account.coin ?? null,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  saveAccountPool(list);
  return list;
}

/** Ambil akun dari pool yang masih punya koin. */
export function pickAccount({ minCoin = REACT_COST } = {}) {
  const list = loadAccountPool();
  for (let i = list.length - 1; i >= 0; i--) {
    const acc = list[i];
    if (acc?.id && (acc.coin ?? 0) >= minCoin) return acc;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 1. AUTO REGISTER
 * ------------------------------------------------------------------ */

/**
 * Registrasi akun baru (auto-generate kalau name/password tidak diisi).
 * Retry otomatis kalau username bentrok.
 */
export async function registerAccount(options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 3;
  let last = null;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const generated = autoCredentials(options.prefix);
    const name = attempt === 1 && options.name ? options.name : generated.name;
    const password = attempt === 1 && options.password ? options.password : generated.password;
    const ref = options.ref || undefined;

    const res = await httpRequest('post', '/api/login', {
      data: { action: 'register', name, password, ...(ref ? { ref } : {}) },
    });

    const payload = res.data;
    if (payload?.status && payload?.data) {
      const user = {
        id: payload.data.id,
        name: payload.data.name,
        password,
        ref: ref || null,
        points: payload.data.points ?? 5,
        apiKey: payload.data.apiKey || null,
      };
      if (options.remember !== false) rememberAccount({ ...user, coin: user.points });
      return {
        status: true,
        httpStatus: res.httpStatus,
        message: payload.message || 'Registrasi berhasil',
        user,
      };
    }

    last = {
      status: false,
      httpStatus: res.httpStatus,
      message: payload?.message || res.error || 'Registrasi gagal',
      raw: payload ?? res.error,
    };

    if (!isDuplicateName(last.message)) break;
  }

  return last;
}

/* ------------------------------------------------------------------ *
 * 2. USER / COIN
 * ------------------------------------------------------------------ */

/** Detail user + koin + apiKey. */
export async function getUser(userId) {
  if (!userId) return { status: false, message: "Parameter 'userId' wajib diisi" };

  const res = await httpRequest('get', '/api/get-user', { params: { id: userId }, timeout: 20000 });
  const payload = res.data;

  if (payload?.status && payload?.data) {
    const d = payload.data;
    return {
      status: true,
      httpStatus: res.httpStatus,
      user: {
        id: d.id,
        name: d.name,
        email: d.email ?? null,
        points: d.points ?? 0,
        apiKey: d.apiKey || null,
        totalReacts: d.totalReacts || 0,
        reactsToday: d.reactsToday || 0,
        checkInStreak: d.checkInStreak || 0,
        lastCheckIn: d.lastCheckIn ? new Date(d.lastCheckIn).toISOString() : null,
        checkedInToday: Boolean(d.checkedInToday),
        referralCount: d.referralCount || 0,
        favEmojis: d.favEmojis || {},
        device: d.device ?? null,
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      },
    };
  }

  return {
    status: false,
    httpStatus: res.httpStatus,
    message: payload?.message || res.error || 'Gagal mengambil data user',
    raw: payload ?? res.error,
  };
}

/** Alias ringkas cek koin. */
export async function checkCoin(userId) {
  const result = await getUser(userId);
  if (!result.status) return result;
  const u = result.user;
  return {
    status: true,
    id: u.id,
    name: u.name,
    coin: u.points,
    points: u.points,
    apiKey: u.apiKey,
    checkedInToday: u.checkedInToday,
    totalReacts: u.totalReacts,
    reactsToday: u.reactsToday,
  };
}

/** Klaim daily check-in (+1 koin). */
export async function claimCheckIn(userId) {
  if (!userId) return { status: false, message: "Parameter 'userId' wajib diisi" };

  const res = await httpRequest('post', '/api/checkin', { data: { id: userId }, timeout: 20000 });
  const payload = res.data;

  return {
    status: Boolean(payload?.status),
    httpStatus: res.httpStatus,
    message: payload?.message || res.error || 'Check-in processed',
    data: payload?.data || null,
  };
}

/** Login akun yang sudah ada. */
export async function loginAccount(credentials = {}) {
  const { name, password } = credentials;
  if (!name || !password) return { status: false, message: 'Username dan password wajib diisi' };

  const res = await httpRequest('post', '/api/login', { data: { name, password } });
  const payload = res.data;

  if (payload?.status && payload?.data) {
    return {
      status: true,
      httpStatus: res.httpStatus,
      message: payload.message || 'Login berhasil',
      user: payload.data,
    };
  }

  return {
    status: false,
    httpStatus: res.httpStatus,
    message: payload?.message || res.error || 'Login gagal',
    raw: payload ?? res.error,
  };
}

/** Live feed reaction terbaru (publik) — cek service sehat atau tidak. */
export async function getFeed() {
  const res = await httpRequest('get', '/api/feed', { timeout: 20000 });
  const feed = res.data?.data?.feed;
  if (!Array.isArray(feed)) {
    return { status: false, httpStatus: res.httpStatus, message: res.error || 'Feed tidak tersedia' };
  }
  return {
    status: true,
    total: feed.length,
    lastSuccess: feed.length ? new Date(Math.max(...feed.map((f) => f.at))).toISOString() : null,
    feed,
  };
}

/** Info + status API key (GET reactch). */
export async function getApiInfo(apiKey) {
  if (!apiKey) return { status: false, message: "Parameter 'apiKey' wajib diisi" };
  const res = await httpRequest('get', '/api/whatsapp/reactch', { params: { apikey: apiKey } });
  return { status: Boolean(res.data?.status), httpStatus: res.httpStatus, ...(res.data || { message: res.error }) };
}

/* ------------------------------------------------------------------ *
 * 3. REACH (kirim reaction)
 * ------------------------------------------------------------------ */

function isTransient(statusCode, message = '') {
  if (statusCode >= 500 || statusCode === 0 || statusCode === 429) return true;
  return /(timeout|timed out|bad gateway|cooldown|coba lagi|try again|menolak|gagal memproses|unavailable)/i.test(
    String(message)
  );
}

/**
 * Kirim reaction ke postingan WhatsApp Channel.
 *
 * Prioritas: endpoint resmi ber-apiKey (POST /api/whatsapp/reactch).
 * Fallback : endpoint web /api/react (butuh verifikasi Cloudflare Turnstile + id sesi).
 */
export async function sendReaction(params = {}) {
  const startedAt = Date.now();
  const url = String(params.url || params.link || '').trim();

  if (!url) return { status: false, message: "Parameter 'url' wajib diisi" };
  if (!CHANNEL_URL_RE.test(url)) {
    return { status: false, message: 'Format URL tidak valid. Contoh: https://whatsapp.com/channel/XXXX/123' };
  }

  const { list, csv } = normalizeEmojis(params.emojis);
  const { apiKey, id } = params;
  const retries = Number.isInteger(params.retries) ? params.retries : 2;
  const useWebFallback = params.useWebFallback !== false;

  if (!apiKey && !id) {
    return { status: false, message: "Butuh 'apiKey' atau 'id' akun untuk mengirim reaction" };
  }

  const attempts = [];
  let lastPayload = null;

  const sendViaApi = async () => {
    if (!apiKey) return null;
    const res = await httpRequest('post', '/api/whatsapp/reactch', {
      params: { apikey: apiKey },
      headers: { [API_KEY_HEADER]: apiKey },
      data: { url, reaction: csv },
    });

    const payload = res.data;
    const ok = Boolean(payload?.status);
    const entry = {
      via: 'api',
      httpStatus: res.httpStatus,
      statusCode: payload?.statusCode ?? res.httpStatus,
      message: payload?.message || res.error || (ok ? 'Berhasil' : 'Gagal reaction'),
      coinDeducted: ok ? REACT_COST : 0,
    };
    attempts.push(entry);
    lastPayload = payload ?? { status: false, message: res.error };
    return { ok, entry };
  };

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const viaApi = await sendViaApi();
    if (viaApi?.ok) {
      return {
        status: true,
        message: viaApi.entry.message,
        target: url,
        emojis: list,
        cost: REACT_COST,
        via: 'api',
        attempts,
        duration: `${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      };
    }

    const lastEntry = attempts[attempts.length - 1];
    const canRetry = attempt <= retries && isTransient(lastEntry?.statusCode ?? 0, lastEntry?.message);
    if (canRetry) await sleep(2500 * attempt);
    else break;
  }

  if (useWebFallback && id) {
    const res = await httpRequest('post', '/api/react', { data: { id, url, emojis: list } });
    const payload = res.data;
    const ok = Boolean(payload?.status && payload?.data);
    attempts.push({
      via: 'web',
      httpStatus: res.httpStatus,
      statusCode: payload?.statusCode ?? res.httpStatus,
      message: payload?.message || res.error || 'Gagal reaction',
      hint: ok ? null : 'Endpoint web butuh verifikasi Cloudflare Turnstile pada sesi akun (kecuali totalReacts >= 10).',
    });

    if (ok) {
      return {
        status: true,
        message: payload.message || 'Berhasil',
        target: url,
        emojis: list,
        cost: REACT_COST,
        via: 'web',
        points: payload.data?.points ?? null,
        totalReacts: payload.data?.totalReacts ?? null,
        attempts,
        duration: `${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      };
    }
  }

  return {
    status: false,
    message: attempts[attempts.length - 1]?.message || lastPayload?.message || 'Gagal reaction',
    statusCode: attempts[attempts.length - 1]?.statusCode ?? null,
    coinDeducted: false,
    target: url,
    emojis: list,
    attempts,
    duration: `${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
  };
}

/* ------------------------------------------------------------------ *
 * 4. AUTO REGISTER + REACH
 * ------------------------------------------------------------------ */

/**
 * Pastikan ada akun siap pakai: ambil dari pool kalau masih ada koin,
 * kalau tidak ada baru auto-register (+5 koin) & klaim check-in (+1 koin).
 */
export async function ensureAccount(options = {}) {
  const minCoin = options.minCoin ?? REACT_COST;
  const pooled = options.fresh ? null : pickAccount({ minCoin });

  if (pooled) {
    const check = await checkCoin(pooled.id);
    if (check.status) {
      rememberAccount({ ...pooled, coin: check.coin });
      if (check.coin >= minCoin) {
        return { status: true, from: 'pool', user: { ...pooled, points: check.coin } };
      }
    }
  }

  const reg = await registerAccount({ ref: options.ref });
  if (!reg.status) return { status: false, from: 'register', message: reg.message, raw: reg };

  let points = reg.user.points;
  if (options.checkIn !== false) {
    await claimCheckIn(reg.user.id);
    const after = await checkCoin(reg.user.id);
    if (after.status) points = after.coin;
    rememberAccount({ ...reg.user, coin: points });
  }

  return { status: true, from: 'register', user: { ...reg.user, points } };
}

/** Auto: register akun baru -> klaim daily check-in -> kirim reaction. */
export async function registerAndReach(params = {}) {
  const { url, emojis = '👍', ref, checkIn = true } = params;

  if (!url) return { status: false, message: "Parameter 'url' wajib diisi" };

  const reg = await registerAccount({ ref });
  if (!reg.status || !reg.user?.id) {
    return { status: false, stage: 'register', message: reg.message, register: reg };
  }

  const account = reg.user;
  const before = await checkCoin(account.id);

  const checkInResult = checkIn ? await claimCheckIn(account.id) : { status: false, message: 'Dilewati' };

  const reaction = await sendReaction({ url, emojis, id: account.id, apiKey: account.apiKey });

  const after = await checkCoin(account.id);
  if (after.status) rememberAccount({ ...account, coin: after.coin });

  return {
    status: reaction.status,
    message: reaction.status ? 'Auto register + reach berhasil' : 'Reaction gagal',
    account: {
      id: account.id,
      name: account.name,
      password: account.password,
      apiKey: account.apiKey,
      initialPoints: account.points,
    },
    checkIn: { status: checkInResult.status, message: checkInResult.message },
    coin: {
      before: before.status ? before.coin : null,
      after: after.status ? after.coin : null,
      spent: before.status && after.status ? before.coin - after.coin : 0,
    },
    reaction,
  };
}

/* ------------------------------------------------------------------ *
 * ENDPOINT
 * ------------------------------------------------------------------ */

export default {
  name: "Reach CH v2",
  description: "Kirim reaksi emoji ke postingan WhatsApp Channel via ALDOXD REACTION (auto register akun + auto check-in)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["link", "emoji"],
  paramsSchema: {
    link: {
      type: "string",
      required: true,
      description: "Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/xxx/123)",
      example: "https://whatsapp.com/channel/0029Vb9GRyt6buMOcTKWse08/104"
    },
    emoji: {
      type: "string",
      required: false,
      default: "👍",
      description: "Emoji reaksi, bisa beberapa sekaligus dipisah koma (maks 5)",
      example: "🔥"
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const link = String(params.link || params.url || '').trim();
      const { list } = normalizeEmojis(params.emoji || params.emojis || '👍');

      if (!link) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'link' wajib diisi dengan tautan postingan channel WhatsApp."
        });
      }

      if (!CHANNEL_URL_RE.test(link)) {
        return res.status(400).json({
          status: false,
          message: "Format link tidak valid. Contoh: https://whatsapp.com/channel/0029Vb9GRyt6buMOcTKWse08/104"
        });
      }

      // 1. Siapkan akun: pakai dari pool kalau masih ada koin, kalau habis auto register baru
      const account = await ensureAccount();
      if (!account.status) {
        return res.status(500).json({
          status: false,
          message: `Gagal menyiapkan akun: ${account.message}`
        });
      }

      const { id, name, apiKey } = account.user;
      const before = await checkCoin(id);

      logger.info(`[REACH-CH2] ${name} (${id}) kirim ${list.join(',')} ke ${link} [akun dari ${account.from}]`);

      // 2. Kirim reaction
      const reaction = await sendReaction({
        url: link,
        emojis: list,
        id,
        apiKey,
        retries: 0, // sekali coba aja — tiap attempt bisa ~30s kalau upstream mereka timeout
        useWebFallback: false
      });

      const after = await checkCoin(id);
      if (after.status) rememberAccount({ id, name, apiKey, coin: after.coin });

      const coinBefore = before.status ? before.coin : null;
      const coinAfter = after.status ? after.coin : null;

      if (!reaction.status) {
        logger.warn(`[REACH-CH2] Gagal: ${reaction.message} (statusCode ${reaction.statusCode ?? '-'})`);
      }

      return res.status(reaction.status ? 200 : 400).json({
        status: reaction.status,
        message: reaction.message,
        statusCode: reaction.statusCode ?? undefined,
        result: {
          link,
          emojis: list,
          cost: reaction.cost ?? null,
          via: reaction.via ?? null,
          account: {
            id,
            name,
            source: account.from,
            coinBefore,
            coinAfter
          },
          coinSpent: coinBefore !== null && coinAfter !== null ? coinBefore - coinAfter : 0,
          duration: reaction.duration,
          attempts: reaction.attempts
        }
      });
    } catch (err) {
      logger.error(`[REACH-CH2] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan internal saat memproses reaksi"
      });
    }
  }
};
