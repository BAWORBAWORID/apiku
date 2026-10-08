#!/usr/bin/env node
/*
  Port ESM dari NexaReactEngine (Go) -> Node.js >= 18
  Sumber: https://lunee.lol/raw/eFPfCs

  Usage:
    node reach.js <link> [emoji|rounds|turnstileToken ...]

  Contoh:
    node reach.js "https://whatsapp.com/channel/0029.../775" 🔥
    node reach.js <link> 🔥 ❤️ 5
    node reach.js <link> 0x000000000000000000000000000000000000
*/

import axios from "axios";
import https from "node:https";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const ORIGIN = "https://195.88.211.140";
const HOSTNAME = "react.nexapanel.my.id";
const DEFAULT_SITEKEY = "0x4AAAAAAD9k4QStw1JJr-cl";
const DEFAULT_TARGET = "https://whatsapp.com/channel/0029VayDvvwKAwEf3GrHDT0u/775";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_TURNSTILE_TOKEN =
  "1.PrK2QVeqeBmLA8LqzBh3SAkmx25h9_0czYVwU1n9kUCZJrulyhSViX5DcHW2VFGpgYb6r9DBwZbAfFERLqL4aOzF_EDC8eqM6X_aL9utCVw87ZltRLzwd9odZIBHMD0CLNwjb7YJMiAuqVuFpo3vZIOqQkEd82o0vLZFd-h3Rz9bZav41UVIsCOxWk9tOYBInBxA2Jap8ckgFDHfk1tW-TJctrGP62Yz4tjwcE1hF5JxA5SwQswS3O9kP-T7T7vORqxKiPDg-kTkcyTaRFdrtb7e83onZViqFjUUZHN1prTASbsGlCKOdLJNySEg9iLXzbPu0X7ffMXENw7EYu4Sf3gXRzsuT__983wktH5FbsMwjelgE1ENGXXdJG6wF7r2Bt4Wg8d5w18jBoHwvmMRUmKf_Z6Eu7lpHoVT37x2X-LZJia4J6WTlC-YTnqunMO-Mi7ve737XZR9NbenqcpddZR4xWycY474VUZekuCCM2LEBxw1XiLiesgMIyamZMKENnJK-bjaCC881OiJ7SIo9vxukTSO2ukgWzoYMD8A2q1rguF_-7nVlgqc9_ylC8bLmr7mSMBr8Wg8PpTiKSfPdmKIlpebWOsozSXeXTc5JoKEVveKUaVKbRqXvE9WSBzKAjR94yqZsy8Wg6Ze3Vq_63QTgUCljzdymZj2LNVdqi-xH44k0uU1Duz4i6ZvbMt6hbhN8Mi0QatxCB9tGmA3Yg.jeiX5km4xl9gXuH58Mu9BQ.0d6d543ed1aa48546b9200794f30e3402394c195647f58e1febf0906a4418044";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unescapeHtml(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function match(re, text, idx = 1) {
  const m = re.exec(text || "");
  return m && m.length > idx ? m[idx] : "";
}

function resolveCachedTurnstileToken() {
  const env = (process.env.TURNSTILE_TOKEN || "").trim();
  if (env) return env;

  for (const p of [".turnstile_cache", "/root/Scrape/.turnstile_cache"]) {
    try {
      const tok = fs.readFileSync(p, "utf8").trim();
      if (tok.length > 20) return tok;
    } catch {
      /* file tidak ada — lewati */
    }
  }

  if (DEFAULT_TURNSTILE_TOKEN) return DEFAULT_TURNSTILE_TOKEN;

  try {
    const out = execFileSync("xvfb-run", [
      "-a",
      "bun",
      "run",
      "/root/Scrape/AstraluneApi/get_turnstile.ts",
    ]);
    const tok = String(out).trim();
    if (tok.length > 20) {
      fs.writeFileSync(".turnstile_cache", tok, "utf8");
      return tok;
    }
  } catch {
    /* fallback */
  }
  return DEFAULT_TURNSTILE_TOKEN;
}

function normalizeEmojis(rawEmojis) {
  const out = [];
  if (!rawEmojis || rawEmojis.length === 0) return ["🔥", "❤️"];

  for (const e of rawEmojis) {
    for (const sp of String(e).split(",")) {
      const tr = sp.trim().toLowerCase();
      switch (tr) {
        case "api":
        case "fire":
        case "🔥":
          out.push("🔥");
          break;
        case "love":
        case "heart":
        case "❤️":
        case "❤":
          out.push("❤️");
          break;
        case "like":
        case "thumbs":
        case "👍":
          out.push("👍");
          break;
        case "laugh":
        case "joy":
        case "😂":
          out.push("😂");
          break;
        default:
          if (tr !== "") out.push(sp.trim());
      }
    }
  }
  return out;
}

class NexaReactEngine {
  constructor(timeoutMs) {
    this.originURL = ORIGIN;
    this.hostName = HOSTNAME;
    this.timeout = timeoutMs;
    this.jar = new Map();

    this.agent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      maxSockets: 100,
      ALPNProtocols: ["http/1.1"],
    });
  }

  resetSession() {
    this.jar = new Map();
  }

  applyHeaders(referer) {
    const h = {
      Host: this.hostName,
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
    };
    if (referer) {
      h.Referer = referer;
      h.Origin = `https://${this.hostName}`;
    }
    if (this.jar.size) {
      h.Cookie = [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    return h;
  }

  captureCookies(raw) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of list) {
      const first = String(c).split(";")[0];
      const i = first.indexOf("=");
      if (i > 0) this.jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
    }
  }

  async request(config) {
    const res = await axios({
      ...config,
      timeout: this.timeout,
      httpsAgent: this.agent,
      proxy: false,
      validateStatus: () => true,
      maxRedirects: 0,
      transitional: { clarifyTimeoutError: true },
    });
    this.captureCookies(res.headers["set-cookie"]);
    return res;
  }

  async fetchPageState() {
    const res = await this.request({
      method: "GET",
      url: `${this.originURL}/`,
      headers: this.applyHeaders(""),
    });
    const htmlContent = String(res.data ?? "");

    let csrf = match(/name=["']_csrf_token["']\s+value=["']([^"']+)["']/, htmlContent);
    if (!csrf) csrf = match(/_csrf_token["'][^>]*value=["']([^"']+)["']/, htmlContent);

    const uid = match(/(NEXA-[A-Za-z0-9]+)/, htmlContent);

    let coins = 3;
    const coinsRaw = match(/(\d+)\s*<\/span>\s*<span[^>]*>Coins<\/span>/, htmlContent);
    if (coinsRaw && Number.isFinite(Number(coinsRaw))) coins = Number(coinsRaw);

    const siteKey = match(/data-sitekey=["']([^"']+)["']/, htmlContent) || DEFAULT_SITEKEY;

    return { csrf, uid, coins, siteKey, html: htmlContent };
  }

  async submitReaction({ csrf, uid, targetURL, emojis, turnstileToken }) {
    const form = new URLSearchParams();
    form.set("_csrf_token", csrf);
    form.set("_uid", uid);
    form.set("link", targetURL);
    form.set("emoji", emojis);
    form.set("cf-turnstile-response", turnstileToken);
    form.set("execute", "1");

    const res = await this.request({
      method: "POST",
      url: `${this.originURL}/`,
      headers: {
        ...this.applyHeaders(`https://${this.hostName}/`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: form.toString(),
    });
    return String(res.data ?? "");
  }

  async executeWithRotation({
    targetURL,
    rawEmojis,
    rounds,
    turnstileToken,
    ctxDeadline,
  }) {
    const startTime = Date.now();

    let cleanTarget = String(targetURL || "").trim();
    if (!cleanTarget) cleanTarget = DEFAULT_TARGET;
    if (rounds < 1) rounds = 3;

    const formattedEmojis = normalizeEmojis(rawEmojis);
    const emojiStr = formattedEmojis.join(",");

    if (!turnstileToken) turnstileToken = resolveCachedTurnstileToken();

    const sessions = [];
    let detectedSiteKey = DEFAULT_SITEKEY;
    let totalCoins = 0;

    for (let r = 1; r <= rounds; r++) {
      if (Date.now() > ctxDeadline) {
        sessions.push({
          round: r,
          submit_status: "TIMEOUT",
          server_message: "Context deadline exceeded",
        });
        break;
      }

      if (r > 1) {
        this.resetSession();
        await sleep(1000);
      }

      let state;
      try {
        state = await this.fetchPageState();
      } catch (err) {
        sessions.push({
          round: r,
          submit_status: "FETCH_FAILED",
          server_message: err.message,
        });
        continue;
      }

      detectedSiteKey = state.siteKey || detectedSiteKey;
      totalCoins += state.coins;

      let status = "READY";
      let serverMsg = "Sesi berhasil dibuat dengan 3 koin gratis.";

      if (turnstileToken) {
        let respHTML;
        try {
          respHTML = await this.submitReaction({
            csrf: state.csrf,
            uid: state.uid,
            targetURL: cleanTarget,
            emojis: emojiStr,
            turnstileToken,
          });
        } catch (err) {
          status = "NETWORK_ERROR";
          serverMsg = err.message;
        }

        if (respHTML !== undefined) {
          let toast = unescapeHtml(match(/<p class="text-xs font-bold">(.*?)<\/p>/, respHTML));
          if (toast) {
            serverMsg = toast;
            if (toast.includes("CAPTCHA tidak valid")) {
              status = "CAPTCHA_EXPIRED";
              try {
                fs.unlinkSync(".turnstile_cache");
              } catch {
                /* tidak ada file */
              }
              const fresh = resolveCachedTurnstileToken();
              if (fresh && fresh !== turnstileToken) {
                turnstileToken = fresh;
                try {
                  const retry = await this.submitReaction({
                    csrf: state.csrf,
                    uid: state.uid,
                    targetURL: cleanTarget,
                    emojis: emojiStr,
                    turnstileToken: fresh,
                  });
                  const retryToast = unescapeHtml(
                    match(/<p class="text-xs font-bold">(.*?)<\/p>/, retry)
                  );
                  if (retryToast) {
                    serverMsg = retryToast;
                    if (!retryToast.includes("CAPTCHA tidak valid")) status = "SUBMITTED";
                  } else {
                    status = "COMPLETED";
                    serverMsg = "Pesanan reaksi berhasil dikirimkan!";
                  }
                } catch (errRetry) {
                  serverMsg = errRetry.message;
                }
              }
            } else {
              status = "SUBMITTED";
            }
          } else {
            status = "COMPLETED";
            serverMsg = "Pesanan reaksi berhasil dikirimkan!";
          }
        }
      } else {
        status = "AWAITING_TURNSTILE_TOKEN";
        serverMsg = `UID ${state.uid} siap dengan ${state.coins} koin gratis. Token Turnstile otomatis sedang diproses.`;
      }

      sessions.push({
        round: r,
        verified_uid: state.uid,
        available_coins: state.coins,
        csrf_token: state.csrf,
        submit_status: status,
        server_message: serverMsg,
      });
    }

    return {
      success: true,
      status_code: 200,
      data: {
        platform: "Nexa React 👑 (Server2 Auto-Rotator)",
        membership: "FREE USER (Auto-Rotated)",
        target_link: cleanTarget,
        selected_emojis: emojiStr,
        turnstile_sitekey: detectedSiteKey,
        total_coins_allocated: totalCoins,
        sessions,
      },
      timestamp: startTime,
    };
  }
}

function parseArgs(argv) {
  let target = DEFAULT_TARGET;
  let rounds = 3;
  let turnstile = resolveCachedTurnstileToken();
  const emojis = [];

  if (argv.length > 0) target = argv[0];

  if (argv.length > 1) {
    for (const arg of argv.slice(1)) {
      if (arg.startsWith("0x") || arg.length > 40) {
        turnstile = arg;
      } else if (/^\d+$/.test(arg)) {
        const num = Number(arg);
        if (num > 0 && num <= 20) rounds = num;
        else emojis.push(arg);
      } else {
        emojis.push(arg);
      }
    }
  } else {
    emojis.push("🔥", "❤️");
  }

  return { target, rounds, turnstile, emojis };
}

async function main() {
  const { target, rounds, turnstile, emojis } = parseArgs(process.argv.slice(2));

  let engine;
  try {
    engine = new NexaReactEngine(25_000);
  } catch (err) {
    console.error(`engine_init_failed: ${err.message}`);
    process.exit(1);
  }

  const result = await engine.executeWithRotation({
    targetURL: target,
    rawEmojis: emojis,
    rounds,
    turnstileToken: turnstile,
    ctxDeadline: Date.now() + 45_000,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});
