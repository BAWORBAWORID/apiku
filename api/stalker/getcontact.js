/**
 * GetContact Stalker API
 * Scrape phone number profile + saved tags via official GetContact API
 * (reuses credential store from tes.js / .gtc/credentials.json)
 *
 * GET  /api/stalker/getcontact?phone=628xxx&type=profile
 * POST /api/stalker/getcontact -d {"phone": "628xxx", "type": "profile"}
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../src/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GTC_BASE = "https://pbssrv-centralevents.com";
const HMAC_KEY = "31426764382a642f3a6665497235466f3d236d5d785b722b4c657457442a495b494524324866782a2364292478587a78662d7a7b7578593f71703e2b7e365762";

const APP_VERSION = "8.4.0";
const ANDROID_OS = "android 9";
const LANG = "en_US";
const COUNTRY = "id";

const CRED_FILE = path.join(__dirname, "..", "..", ".gtc", "credentials.json");

class GtcError extends Error {}

function sig(ts, message, keyHex) {
  return crypto.createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(`${ts}-${message}`)
    .digest("base64");
}

function padPKCS7(buf) {
  const n = 16 - (buf.length % 16);
  return Buffer.concat([buf, Buffer.alloc(n, n)]);
}

function aesAlgo(keyBuf) {
  const size = keyBuf.length * 8;
  return size === 128 ? "aes-128-ecb" : size === 192 ? "aes-192-ecb" : "aes-256-ecb";
}

function encryptAES(data, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const cipher = crypto.createCipheriv(aesAlgo(key), key, null);
  cipher.setAutoPadding(false);
  const out = Buffer.concat([cipher.update(padPKCS7(Buffer.from(data, "utf8"))), cipher.final()]);
  return out.toString("base64");
}

function decryptAES(data, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const decipher = crypto.createDecipheriv(aesAlgo(key), key, null);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
  const padLen = out[out.length - 1];
  return out.subarray(0, out.length - padLen).toString("utf8");
}

function ts() {
  return String(Date.now());
}

async function gtcCall(endpoint, payload, { token, finalKey, deviceId }) {
  const raw = JSON.stringify(payload);
  const t = ts();
  const headers = {
    "Content-Type": "application/json",
    "x-os": ANDROID_OS,
    "x-app-version": APP_VERSION,
    "x-client-device-id": deviceId,
    "x-lang": LANG,
    "x-req-timestamp": t,
    "x-country-code": COUNTRY,
    "x-encrypted": "1",
    "x-req-signature": sig(t, raw, HMAC_KEY),
    "x-token": token,
  };
  const r = await fetch(GTC_BASE + endpoint, {
    method: "POST",
    body: JSON.stringify({ data: encryptAES(raw, finalKey) }),
    headers,
    signal: AbortSignal.timeout(25000),
  });
  let parsed;
  try {
    parsed = await r.json();
  } catch {
    throw new GtcError(`${endpoint}: non-JSON response (HTTP ${r.status})`);
  }
  if (parsed && "data" in parsed) {
    parsed = JSON.parse(decryptAES(parsed.data, finalKey));
  }
  return [r.status, parsed];
}

function dig(obj, path, def = null) {
  for (const k of path.split(".")) {
    if (!obj || typeof obj !== "object" || !(k in obj)) return def;
    obj = obj[k];
  }
  return obj === undefined ? def : obj;
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
  } catch {
    return { active: null, credentials: {} };
  }
}

function getActiveCred(store) {
  const name = store.active || Object.keys(store.credentials || {})[0];
  const cred = store.credentials?.[name];
  if (!cred || !cred.token || !cred.finalKey || !cred.clientDeviceId) {
    throw new GtcError("No GetContact credential configured. Run generate via tes.js first.");
  }
  return [name, cred];
}

function normalizePhone(raw) {
  const p = String(raw || "").replace(/[^\d+]/g, "").trim();
  if (p.startsWith("+")) return p;
  if (p.startsWith("0")) return "+62" + p.slice(1);
  if (p.startsWith("62")) return "+" + p;
  throw new GtcError(`Invalid phone number: ${raw}`);
}

async function apiSearch(cred, phone, source) {
  const endpoint = source === "tags" ? "/v2.8/number-detail" : "/v2.8/search";
  const [code, body] = await gtcCall(endpoint, {
    countryCode: COUNTRY,
    phoneNumber: phone,
    source: source === "tags" ? "profile" : "search",
    token: cred.token,
  }, {
    token: cred.token,
    finalKey: cred.finalKey,
    deviceId: cred.clientDeviceId,
  });
  const meta = dig(body, "meta.httpStatusCode");
  if (code !== 200 || meta !== 200) {
    throw new GtcError(`HTTP ${code}/${meta}: ${dig(body, "meta.errorMessage", "unknown error")}`);
  }
  return body;
}

function formatProfile(profile) {
  if (!profile) return null;
  const pick = ["displayName", "name", "surname", "phoneNumber", "displayNumber",
    "country", "countryCode", "email", "trustScore", "tagCount", "profileImage"];
  const out = {};
  for (const k of pick) out[k] = profile[k] ?? null;
  return out;
}

function formatTags(tags) {
  return (tags || []).map((t) => ({
    tag: t.tag || null,
    count: t.count ?? null,
    isNew: !!t.isNew,
    removable: !!t.removable,
  }));
}

function formatQuota(sub) {
  if (!sub) return null
  const u = sub.usage || {}
  const pick = (k) => {
    const d = u[k] || {}
    return { limit: d.limit ?? null, remaining: d.remainingCount ?? null }
  }
  return {
    premiumType: sub.premiumType || sub.premiumTypeName || "free",
    renewDate: sub.renewDate || null,
    search: pick("search"),
    numberDetail: pick("numberDetail"),
    biography: pick("biography"),
  }
}

export default {
  name: "GetContact Stalker",
  description: "Scrape phone number identity + saved tags from GetContact (Spam Caller ID) — display name, avatar, and how contacts saved the number",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["phone", "type"],

  paramsSchema: {
    phone: {
      type: "string",
      required: true,
      description: "Phone number to look up (supports 08xx / 628xx / +62 format)",
      minLength: 8,
      maxLength: 20,
    },
    type: {
      type: "string",
      required: false,
      description: "Lookup type: profile (owner name) or tags (how others saved the number)",
      enum: ["profile", "tags"],
      default: "profile",
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      let { phone, type } = { ...req.query, ...req.body }
      type = type || "profile"
      if (!["profile", "tags"].includes(type)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'type' harus 'profile' atau 'tags'",
        })
      }
      if (!phone || typeof phone !== "string" || !phone.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'phone' wajib diisi",
        })
      }

      const [name, cred] = getActiveCred(loadStore())
      const normalized = normalizePhone(phone.trim())
      logger.info(`[GETCONTACT] ${type} lookup for ${normalized} (account: ${name})`)

      const body = await apiSearch(cred, normalized, type)
      const profile = formatProfile(dig(body, "result.profile"))
      const tags = formatTags(dig(body, "result.tags"))
      const quota = formatQuota(dig(body, "result.subscriptionInfo") || dig(body, "result.quota"))

      const duration = Date.now() - startTime
      logger.info(`[GETCONTACT] ${type} result for ${normalized} | ${duration}ms`)

      const payload = {
        status: true,
        query: { phone: normalized, type },
        account: name,
        result: {
          profile,
          tags,
          quota,
        },
        metadata: { processing_time: `${duration}ms` },
      }

      return res.json(payload)
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[GETCONTACT] Error: ${error.message}`)

      if (error instanceof GtcError) {
        const isNotFound = /404.*No result found/i.test(error.message)
        const isQuota = /maximum query limit|quota/i.test(error.message)
        if (isNotFound) {
          return res.status(404).json({
            status: false,
            code: "NOT_FOUND",
            message: "Nomor tidak ditemukan di database GetContact (tidak ada data profil/tag tersimpan)",
            metadata: { processing_time: `${duration}ms` },
          })
        }
        if (isQuota) {
          return res.status(429).json({
            status: false,
            code: "QUOTA_EXHAUSTED",
            message: "Kuota GetContact habis — coba type=profile atau tunggu reset kuota",
            metadata: { processing_time: `${duration}ms` },
          })
        }
        const isAuth = /credential|Invalid phone|non-JSON/i.test(error.message)
        return res.status(isAuth ? 503 : 502).json({
          status: false,
          message: error.message,
          metadata: { processing_time: `${duration}ms` },
        })
      }

      return res.status(500).json({
        status: false,
        message: error.message,
        metadata: { processing_time: `${duration}ms` },
      })
    }
  },
}