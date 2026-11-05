/**
 * AlightMotion Bulk V2 — Auto create CyberMail + send magic link + verify + apply premium
 * Powered by CyberMail (cybermail.us) + amService (am-premiumms.ai.studio)
 *
 * GET  /api/am/bulkv2?count=1
 * POST /api/am/bulkv2 -d {"count": 1}
 */

import logger from "../../src/utils/logger.js";
import amService from "../../src/utils/amService.js";

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

// 1. Fetch domain aktif dari CyberMail
async function getDomains() {
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

// Ekspor delegasi ke amService
export const sendMagicLink = (email) => amService.sendMagicLink(email);
export const verifyMagicLink = (email, link) => amService.verifyMagicLink(email, link);

export default {
  name: "AlightMotion Bulk V2",
  description: "Generate Am Bulk v2 (CyberMail + amService)",
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
        logger.info(`[AM BulkV2 BG] Memulai proses background untuk ${total} akun...`);
        for (let i = 0; i < results.length; i++) {
          const item = results[i];
          const email = item.email;

          try {
            logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Mengirim magic link via amService...`);
            const sendRes = await amService.sendMagicLink(email);
            if (!sendRes.success) {
              logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Gagal kirim link: ${sendRes.error || sendRes.message}`);
              continue;
            }

            logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Menunggu link verifikasi di CyberMail...`);
            const found = await waitForVerifyLink(email, { maxAttempts: 25, intervalMs: 2500 });
            if (!found) {
              logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Link verifikasi tidak ditemukan di inbox`);
              continue;
            }

            logger.info(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Melakukan verifikasi login & aktivasi VIP...`);
            const authData = await amService.verifyMagicLink(email, found.link);
            if (!authData.success) {
              logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email}: Verifikasi gagal: ${authData.message || authData.error}`);
              continue;
            }

            // Terapkan lisensi (amService applyPremium)
            await amService.applyPremium(authData.idToken, authData.orderId);

            logger.info(
              `[AM BulkV2 BG] [${i + 1}/${total}] ${email}: SUKSES PREMIUM VIP AKTIF! | UID: ${authData.user?.uid || "-"} | Order: ${authData.orderId || "-"} | Valid: ${authData.user?.validUntil || "-"}`
            );
          } catch (err) {
            logger.error(`[AM BulkV2 BG] [${i + 1}/${total}] ${email} error: ${err.message}`);
          }

          if (i < total - 1) await sleep(2000);
        }
        logger.info(`[AM BulkV2 BG] Selesai memproses seluruh ${total} akun.`);
      })().catch((err) => {
        logger.error(`[AM BulkV2 BG] Fatal background error: ${err.message}`);
      });

      // 3. Langsung kirim respon ke client (tanpa orderId)
      return res.json({
        status: true,
        message: "Permintaan bulk berhasil diterima. Proses verifikasi dan aktivasi premium berjalan di latar belakang.",
        total,
        results,
      });
    } catch (err) {
      logger.error(`[AM BulkV2] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses bulk request Alight Motion",
      });
    }
  },
};
