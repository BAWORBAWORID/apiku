/**
 * Rin API - React Channel WhatsApp (rch) Scraper & Automator
 * Target: https://apiii-xrina.my.id/rch
 *
 * Mendukung multiple solver Turnstile:
 * 1. Local Playwright Solver (import from ./api/solve/turnstile.js)
 * 2. CapSolver API (TurnstileTask / TurnstileTaskProxyLess)
 * 3. 2Captcha API (Turnstile / Cloudflare)
 * 4. Custom Solver API Endpoint
 *
 * ESM Native
 */

import axios from "axios";
import { solveTurnstile as localSolveTurnstile } from "./api/solve/turnstile.js";

const BASE_URL = "https://apiii-xrina.my.id";
const RCH_PAGE_URL = `${BASE_URL}/rch`;
const DEFAULT_SITEKEY = "0x4AAAAAAFSt8uci-DnRwonJ";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  Origin: BASE_URL,
  Referer: RCH_PAGE_URL,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1. Cek status sisa jatah/limit harian
 */
export async function getStatus() {
  const res = await axios.get(`${BASE_URL}/rch/status`, {
    headers: DEFAULT_HEADERS,
    timeout: 10000,
  });
  return res.data;
}

/**
 * 2. Inisialisasi sesi verifikasi manusia (mendapatkan cid, ray, siteKey)
 */
export async function initVerification() {
  const res = await axios.get(`${BASE_URL}/rch/v/init`, {
    headers: DEFAULT_HEADERS,
    timeout: 10000,
  });
  if (!res.data || !res.data.cid) {
    throw new Error(
      "Gagal mendapatkan session cid dari /rch/v/init: " + JSON.stringify(res.data)
    );
  }
  return res.data;
}

/**
 * 3. Solver: Local Playwright Turnstile
 */
export async function solveWithLocalPlaywright(siteKey = DEFAULT_SITEKEY, options = {}) {
  const token = await localSolveTurnstile({
    url: RCH_PAGE_URL,
    sitekey: siteKey,
    invisible: options.invisible || false,
    debug: options.debug || false,
    timeoutMs: options.timeoutMs || 45000,
  });
  if (!token) throw new Error("Local Playwright solver gagal mendapatkan token Turnstile");
  return token;
}

/**
 * 4. Solver: CapSolver API
 * https://docs.capsolver.com/guide/captcha/cloudflare_turnstile.html
 */
export async function solveWithCapSolver(apiKey, siteKey = DEFAULT_SITEKEY, options = {}) {
  if (!apiKey) throw new Error("CapSolver API key diperlukan");

  const createRes = await axios.post(
    "https://api.capsolver.com/createTask",
    {
      clientKey: apiKey,
      task: {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL: RCH_PAGE_URL,
        websiteKey: siteKey,
      },
    },
    { timeout: 15000 }
  );

  if (createRes.data.errorId !== 0) {
    throw new Error(`CapSolver createTask error: ${createRes.data.errorDescription || JSON.stringify(createRes.data)}`);
  }

  const taskId = createRes.data.taskId;
  const deadline = Date.now() + (options.timeoutMs || 60000);

  while (Date.now() < deadline) {
    await sleep(2000);
    const resultRes = await axios.post(
      "https://api.capsolver.com/getTaskResult",
      { clientKey: apiKey, taskId },
      { timeout: 15000 }
    );

    if (resultRes.data.status === "ready") {
      const token = resultRes.data.solution?.token;
      if (!token) throw new Error("CapSolver tidak mengembalikan token valid");
      return token;
    }
    if (resultRes.data.status === "failed") {
      throw new Error(`CapSolver task failed: ${resultRes.data.errorDescription}`);
    }
  }

  throw new Error("CapSolver timeout menunggu penyelesaian Turnstile");
}

/**
 * 5. Solver: 2Captcha API
 * https://2captcha.com/2captcha-api#turnstile
 */
export async function solveWith2Captcha(apiKey, siteKey = DEFAULT_SITEKEY, options = {}) {
  if (!apiKey) throw new Error("2Captcha API key diperlukan");

  const inRes = await axios.post(
    "https://2captcha.com/in.php",
    null,
    {
      params: {
        key: apiKey,
        method: "turnstile",
        sitekey: siteKey,
        pageurl: RCH_PAGE_URL,
        json: 1,
      },
      timeout: 15000,
    }
  );

  if (inRes.data.status !== 1) {
    throw new Error(`2Captcha in.php error: ${inRes.data.request}`);
  }

  const id = inRes.data.request;
  const deadline = Date.now() + (options.timeoutMs || 60000);

  while (Date.now() < deadline) {
    await sleep(4000);
    const resRes = await axios.get("https://2captcha.com/res.php", {
      params: {
        key: apiKey,
        action: "get",
        id,
        json: 1,
      },
      timeout: 15000,
    });

    if (resRes.data.status === 1) {
      return resRes.data.request;
    }
    if (resRes.data.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2Captcha error: ${resRes.data.request}`);
    }
  }

  throw new Error("2Captcha timeout menunggu penyelesaian Turnstile");
}

/**
 * 6. Solver: Custom API Endpoint
 * Contoh: POST https://your-solver.com/api/solve/turnstile?url=...&sitekey=...
 */
export async function solveWithCustomApi(apiUrl, siteKey = DEFAULT_SITEKEY, options = {}) {
  if (!apiUrl) throw new Error("Custom solver API URL diperlukan");

  const res = await axios.post(
    apiUrl,
    {
      url: RCH_PAGE_URL,
      sitekey: siteKey,
      ...options,
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: options.timeoutMs || 45000,
    }
  );

  const token = res.data?.token || res.data?.result?.token || res.data?.data?.token || res.data;
  if (!token || typeof token !== "string") {
    throw new Error("Custom solver tidak mengembalikan format token string yang valid: " + JSON.stringify(res.data));
  }
  return token;
}

/**
 * 7. Unified Solver Resolver
 */
export async function resolveTurnstile(siteKey = DEFAULT_SITEKEY, options = {}) {
  const solverType = options.solver || "local";

  if (solverType === "capsolver") {
    return await solveWithCapSolver(options.apiKey || process.env.CAPSOLVER_API_KEY, siteKey, options);
  }
  if (solverType === "2captcha") {
    return await solveWith2Captcha(options.apiKey || process.env.TWOCAPTCHA_API_KEY, siteKey, options);
  }
  if (solverType === "custom" || options.solverUrl) {
    return await solveWithCustomApi(options.solverUrl, siteKey, options);
  }

  // Default: local playwright solver
  return await solveWithLocalPlaywright(siteKey, options);
}

/**
 * 8. Verifikasi Human Token (/rch/v/check)
 * Memvalidasi Turnstile token & session cid untuk mendapatkan token otorisasi kirim react.
 */
export async function verifyHuman({ cid, tsToken, delayMs = 2500 }) {
  if (!cid) throw new Error("Parameter 'cid' wajib diisi");
  if (!tsToken) throw new Error("Parameter 'tsToken' wajib diisi");

  // Server Rin API memberlakukan rate limit minimal (jika <2 detik -> "Terlalu cepat")
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const res = await axios.post(
    `${BASE_URL}/rch/v/check`,
    {
      cid,
      hp: "", // Honeypot trap wajib string kosong
      ts: tsToken,
    },
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return res.data;
}

/**
 * 9. Kirim Reaction ke WhatsApp Channel (/rch/send)
 * @param {string} url - Link postingan channel (contoh: https://whatsapp.com/channel/xxx/123)
 * @param {string|string[]} reaction - Emoji atau deretan emoji dipisah koma (maks. 4 emoji)
 * @param {string} cid - Session cid terverifikasi
 * @param {string} token - Human token hasil verifyHuman
 */
export async function sendReaction({ url, reaction, cid, token }) {
  if (!url) throw new Error("URL pesan WhatsApp channel wajib diisi");
  if (!reaction) throw new Error("Reaction emoji wajib diisi");
  if (!cid) throw new Error("Parameter 'cid' wajib diisi");
  if (!token) throw new Error("Parameter 'token' verifikasi manusia wajib diisi");

  const cleanUrl = String(url).trim().split("?")[0].split("#")[0].replace(/\/+$/, "");
  const reactionStr = Array.isArray(reaction) ? reaction.join(",") : String(reaction).trim();

  const res = await axios.post(
    `${BASE_URL}/rch/send`,
    {
      url: cleanUrl,
      reaction: reactionStr,
      cid,
      token,
    },
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return res.data;
}

/**
 * 10. Pipeline Lengkap React Channel WhatsApp
 */
export async function reactChannel({ url, reaction, solver = "local", solverApiKey = null, solverUrl = null, options = {} }) {
  // A. Cek Status Limit
  const status = await getStatus();
  if (status.limit && status.limit.remaining <= 0) {
    throw new Error(`Limit reaksi 24 jam sudah habis (sisa: ${status.limit.remaining}/${status.limit.max})`);
  }

  // B. Inisialisasi Sesi
  const init = await initVerification();
  const siteKey = init.turnstile?.siteKey || DEFAULT_SITEKEY;
  const cid = init.cid;

  // C. Solve Cloudflare Turnstile
  const tsToken = await resolveTurnstile(siteKey, {
    solver,
    apiKey: solverApiKey,
    solverUrl,
    ...options,
  });

  // D. Verifikasi Human Token (dengan delay natural minimal 2500ms)
  const verifyResult = await verifyHuman({
    cid,
    tsToken,
    delayMs: options.delayMs || 2500,
  });

  if (!verifyResult || !verifyResult.done || !verifyResult.token) {
    throw new Error(verifyResult?.message || "Verifikasi gagal atau token tidak diterbitkan");
  }

  // E. Kirim Reaksi ke Pesan Channel
  const sendResult = await sendReaction({
    url,
    reaction,
    cid,
    token: verifyResult.token,
  });

  return {
    status: true,
    result: sendResult,
    limit: sendResult.limit || status.limit,
  };
}

// ─── CLI EXECUTION SUPPORT ──────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const args = process.argv.slice(2);
  const help = args.includes("--help") || args.includes("-h");

  if (help || args.length === 0) {
    console.log(`
React Channel WhatsApp (Rin API Scraper)
Usage:
  node reach.js --status
  node reach.js --init
  node reach.js --url <whatsapp_post_url> --reaction <emojis> [options]

Options:
  --status                    Cek limit pemakaian rch saat ini
  --init                      Ambil session cid & sitekey Turnstile
  --url, -u <link>            Link pesan WhatsApp channel (contoh: https://whatsapp.com/channel/xxx/5)
  --reaction, -r <emojis>     Emoji reaksi (contoh: 🔥,❤️ atau 🔥)
  --solver <type>             Pilihan solver: local, capsolver, 2captcha, custom (default: local)
  --key <apikey>              API Key jika memakai solver capsolver / 2captcha
  --solver-url <url>          URL endpoint jika memakai custom solver API
  --debug                     Aktifkan log detail solver
`);
    process.exit(0);
  }

  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  (async () => {
    try {
      if (args.includes("--status")) {
        console.log("Mengambil status...");
        const res = await getStatus();
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      if (args.includes("--init")) {
        console.log("Mengambil init...");
        const res = await initVerification();
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      const url = getArg("--url") || getArg("-u");
      const reaction = getArg("--reaction") || getArg("-r") || "🔥";
      const solver = getArg("--solver") || "local";
      const apiKey = getArg("--key");
      const solverUrl = getArg("--solver-url");
      const debug = args.includes("--debug");

      if (!url) {
        console.error("Error: Parameter --url wajib diisi");
        process.exit(1);
      }

      console.log(`[RCH] Memulai pengiriman reaksi: ${reaction} -> ${url}`);
      console.log(`[RCH] Solver yang digunakan: ${solver}`);

      const result = await reactChannel({
        url,
        reaction,
        solver,
        solverApiKey: apiKey,
        solverUrl,
        options: { debug },
      });

      console.log("Berhasil:", JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("Gagal:", err.message);
      if (err.response?.data) {
        console.error("Response data:", JSON.stringify(err.response.data, null, 2));
      }
      process.exit(1);
    }
  })();
}
