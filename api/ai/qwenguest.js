/**
 * Qwen Guest AI — chat.qwen.ai/c/guest via Puppeteer Stealth (tanpa akun/token)
 * Engine: Guest Web Bypass (adaptasi dari "Qwen AI Universal Suite" by OmnifyLabs)
 *
 * Optimasi: PERSISTENT BROWSER — Chrome diluncurkan SEKALI saat request pertama,
 * lalu di-reuse untuk semua request berikutnya (cukup newPage() per request).
 * - Persist lintas HMR reload via globalThis
 * - Auto-close setelah idle 10 menit (hemat RAM)
 * - Max 2 request paralel, sisanya antri
 * - Auto-retry 1x jika jawaban kosong
 */
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import getChromePath from "../../src/utils/chromePath.js";
import logger from "../../src/utils/logger.js";

puppeteer.use(StealthPlugin());

const WEB_URL = "https://chat.qwen.ai";
const GUEST_URL = `${WEB_URL}/c/guest`;
const BROWSER_KEY = "__qwenGuestBrowser";
const IDLE_CLOSE_MS = 30 * 60 * 1000; // 30 menit — browser tetap warm untuk traffic rutin
const MAX_CONCURRENT = 2;

// ─── Persistent browser (aman dari HMR reload) ───────────────
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const b = globalThis[BROWSER_KEY];
    if (b && !b.disconnected) {
      logger.info("[QwenGuest] Browser idle 10 menit — auto-close");
      await b.close().catch(() => {});
    }
    globalThis[BROWSER_KEY] = null;
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

async function getBrowser() {
  const existing = globalThis[BROWSER_KEY];
  if (existing && !existing.disconnected) {
    resetIdleTimer();
    return existing;
  }
  logger.info("[QwenGuest] Launching persistent Chrome...");
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: getChromePath() || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800",
    ],
  });
  globalThis[BROWSER_KEY] = browser;
  resetIdleTimer();
  return browser;
}

// ─── Concurrency queue (max 2 paralel) ───────────────────────
let active = 0;
const waiters = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise((r) => waiters.push(r));
  active++;
}

function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

// ─── Core flow (satu percakapan = satu page) ─────────────────
async function runGuestFlow(prompt, timeoutMs) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1280, height: 800 });

    let chatId = null;
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/api/v2/chat/completions")) {
        const idMatch = url.match(/chat_id=([a-zA-Z0-9_-]+)/);
        if (idMatch) chatId = idMatch[1];
      }
    });

    await page.goto(GUEST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    });

    // Bypass modal login
    const closeAuthBtn = await page
      .waitForSelector(".auth-layout-close-button", { timeout: 5000 })
      .catch(() => null);
    if (closeAuthBtn) {
      await closeAuthBtn.click();
      await new Promise((r) => setTimeout(r, 800));
    }

    await page.waitForSelector(".message-input-textarea", { timeout: 12000 });
    await page.type(".message-input-textarea", prompt.trim());
    await new Promise((r) => setTimeout(r, 300));
    await page.keyboard.press("Enter");

    try {
      await page.waitForSelector(
        '.chat-input-stop-button, [class*="stop-button"], button[aria-label="Stop"]',
        { timeout: 8000 }
      );
    } catch {}

    // Poll jawaban sampai stabil
    const startTime = Date.now();
    let stableCount = 0;
    let lastLen = 0;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 400));

      const poll = await page.evaluate(() => {
        const isGenerating = !!document.querySelector(
          '.chat-input-stop-button, [class*="stop-button"], button[aria-label="Stop"]'
        );
        const thoughtEl = document.querySelector(
          '.qwen-chat-thinking-status-card-content, [class*="thinking-status"], [class*="thought"]'
        );
        const answerEl = document.querySelector(
          ".response-message-content.phase-answer, .qwen-chat-message-assistant .qwen-markdown"
        );
        const rawAnswer = answerEl ? answerEl.innerText.trim() : "";
        const isValidAnswer =
          rawAnswer.length > 0 &&
          !/^(thinking|searching the web|reading sources)/i.test(rawAnswer);

        return {
          isGenerating,
          thought: thoughtEl ? thoughtEl.innerText.trim() : "",
          answer: isValidAnswer ? rawAnswer : "",
        };
      });

      if (!poll.isGenerating && poll.answer.length > 0 && Date.now() - startTime > 2500) {
        break;
      }
      if (poll.answer.length > 0) {
        if (poll.answer.length === lastLen) {
          stableCount++;
          if (stableCount >= 10) break;
        } else {
          stableCount = 0;
          lastLen = poll.answer.length;
        }
      }
    }

    const domResult = await page.evaluate(() => {
      const answerEl = document.querySelector(
        ".response-message-content.phase-answer, .qwen-chat-message-assistant .qwen-markdown"
      );
      const thoughtEl = document.querySelector(
        '.qwen-chat-thinking-status-card-content, [class*="thinking-status"], [class*="thought"]'
      );
      return {
        answer: answerEl ? answerEl.innerText : "",
        thought: thoughtEl ? thoughtEl.innerText : "",
      };
    });

    const response = (domResult.answer || "")
      .replace(/^Thinking completed\s*/i, "")
      .replace(/^Searching the web\s*Skip\s*/i, "")
      .trim();
    const thought = (domResult.thought || "")
      .replace(/^Thinking completed\s*/i, "")
      .trim();

    return {
      response,
      thought: thought || null,
      chatId: chatId || null,
      chatUrl: chatId ? `${WEB_URL}/c/${chatId}` : GUEST_URL,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Endpoint ────────────────────────────────────────────────
export default {
  name: "Qwen Guest AI",
  description:
    "Chat Qwen AI tanpa akun via guest mode (persistent browser — cepat setelah request pertama). Support deep thinking & web search otomatis.",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["text", "timeout"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan / prompt untuk Qwen AI",
      example: "Apa ibukota Jepang?",
      minLength: 1,
      maxLength: 4000,
    },
    timeout: {
      type: "number",
      required: false,
      description: "Timeout tunggu jawaban (detik)",
      default: 60,
      min: 15,
      max: 120,
    },
  },
  async run(req, res) {
    const { text, timeout } = { ...req.query, ...req.body };

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'text' wajib diisi",
      });
    }

    const timeoutSec = Math.min(Math.max(parseInt(timeout) || 60, 15), 120);
    const timeoutMs = timeoutSec * 1000;
    const started = Date.now();

    await acquire();
    try {
      let result = null;
      // Attempt pertama + auto-retry 1x jika jawaban kosong
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          result = await runGuestFlow(String(text), timeoutMs);
          if (result.response) break;
          if (attempt === 1) logger.info("[QwenGuest] Jawaban kosong — retry 1x");
        } catch (err) {
          if (attempt === 2) throw err;
          logger.warn(`[QwenGuest] Attempt 1 gagal: ${err.message} — retry`);
        }
      }

      if (!result || !result.response) {
        return res.json({
          status: false,
          message: `Tidak ada jawaban dalam ${timeoutSec} detik (2 percobaan)`,
        });
      }

      res.json({
        status: true,
        result: {
          model: "qwen3.7-plus",
          prompt: String(text).trim(),
          response: result.response,
          thought: result.thought,
          chatId: result.chatId,
          chatUrl: result.chatUrl,
          durationMs: Date.now() - started,
        },
      });
    } catch (err) {
      logger.error(`[QwenGuest] Error: ${err.message}`);
      res.json({
        status: false,
        message: err.message || "Gagal memproses chat Qwen Guest",
      });
    } finally {
      release();
    }
  },
};
