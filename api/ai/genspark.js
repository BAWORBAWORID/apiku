import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const COOKIE_DIR = new URL("assets/genspark", import.meta.url).pathname;
const COOKIE_FILE = path.join(COOKIE_DIR, "cookies.json");
const CHROME_PATH = "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome";
const EMAIL = "fazzafabianahmad09@gmail.com";
const PASSWORD = "YSn33hrDYDZF=@!";

const MODELS = [
  "claude-sonnet-4-6", "claude-opus-4-7", "claude-opus-4-6", "claude-4-5-haiku",
  "gpt-5.4", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2-pro", "gpt-5.4-pro", "o3-pro",
  "gemini-2.5-pro", "gemini-3-flash-preview", "gemini-3.1-pro-preview",
  "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning",
];

let browser = null;
let page = null;

async function getPage() {
  if (page && !page.isClosed()) {
    try {
      await page.evaluate("1");
      return page;
    } catch (e) {}
  }
  return null;
}

async function initBrowser() {
  if (browser && browser.process()?.pid) {
    try {
      const pages = await browser.pages();
      if (pages.length > 0) {
        page = pages[0];
        await page.evaluate("1");
        return page;
      }
    } catch (e) {
      await browser.close().catch(() => {});
    }
  }

  browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36");
  await page.setViewport({ width: 1280, height: 720 });
  return page;
}

async function login(email, password) {
  const p = await getPage();
  if (!p) await initBrowser();

  fs.mkdirSync(COOKIE_DIR, { recursive: true });

  await page.goto(
    `https://www.genspark.ai/api/login?redirect_url=${encodeURIComponent("https://www.genspark.ai/")}`,
    { waitUntil: "networkidle2", timeout: 30000 },
  );

  await new Promise((r) => setTimeout(r, 2000));
  await page.type("#email", email);
  await new Promise((r) => setTimeout(r, 300));
  await page.type("#password", password);
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector("#next")?.click());
  await new Promise((r) => setTimeout(r, 5000));

  const loggedIn = await page.evaluate(async () => {
    const res = await fetch("https://www.genspark.ai/api/is_login", { credentials: "include" });
    const data = await res.json();
    return !!(data.data?.is_login || data.is_login);
  });

  if (!loggedIn) throw new Error("Login gagal");

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));

  return await page.evaluate(async () => {
    const res = await fetch("https://www.genspark.ai/api/user", { credentials: "include" });
    const data = await res.json();
    return data.data?.cogen?.email || "Unknown";
  });
}

async function tryRestoreSession() {
  if (!fs.existsSync(COOKIE_FILE)) return false;
  try {
    const p = await getPage();
    if (!p) await initBrowser();

    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    await page.setCookie(...cookies);

    await page.goto("https://www.genspark.ai/", { waitUntil: "domcontentloaded", timeout: 15000 });

    const loggedIn = await page.evaluate(async () => {
      const res = await fetch("https://www.genspark.ai/api/is_login", { credentials: "include" });
      const data = await res.json();
      return !!(data.data?.is_login || data.is_login);
    });

    return loggedIn;
  } catch (e) {
    return false;
  }
}

export default {
  name: "Genspark AI",
  description: "Chat AI multi-model via browser automation",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["text", "model"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan untuk AI",
      example: "Halo, apa kabar?",
    },
    model: {
      type: "string",
      required: true,
      default: "claude-sonnet-4-6",
      enum: MODELS,
      description: "Model AI",
    },
  },

  async run(req, res) {
    const { text, model = "claude-sonnet-4-6" } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" });
    }

    try {
      let p = await getPage();
      let loggedIn = false;

      if (p) {
        loggedIn = await page.evaluate(async () => {
          const res = await fetch("https://www.genspark.ai/api/is_login", { credentials: "include" });
          const data = await res.json();
          return !!(data.data?.is_login || data.is_login);
        }).catch(() => false);
      }

      if (!loggedIn) loggedIn = await tryRestoreSession();
      if (!loggedIn) await login(EMAIL, PASSWORD);

      const msgId = "n" + Date.now() + Math.random().toString(36).slice(2, 8);

      const result = await page.evaluate(
        async ({ prompt, model, msgId }) => {
          const payload = {
            ai_chat_model: model,
            ai_chat_enable_search: true,
            ai_chat_disable_personalization: false,
            use_moa_proxy: false,
            moa_models: [],
            writingContent: null,
            type: "ai_chat",
            project_id: null,
            messages: [{ role: "user", id: msgId, content: prompt }],
            user_s_input: prompt,
            g_recaptcha_token: "",
            is_private: true,
            push_token: "",
            session_state: { steps: [], messages: [{ role: "user", id: msgId, content: prompt }] },
          };

          const res = await fetch("https://www.genspark.ai/api/agent/ask_proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "*/*" },
            credentials: "include",
            body: JSON.stringify(payload),
          });

          if (!res.ok) return { success: false, error: `Chat gagal: ${res.status}` };

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "", fullText = "", foundCompletion = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              let data = line.trim();
              if (data.startsWith("data:")) data = data.substring(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "message_field_delta" && parsed.field_name === "content") {
                  fullText += parsed.delta || "";
                } else if (parsed.type === "message_complete") {
                  foundCompletion = true;
                }
              } catch (e) {}
            }
            if (foundCompletion) break;
          }

          if (!fullText) return { success: false, error: "Tidak ada response dari AI" };
          return { success: true, result: { message: fullText.trim() } };
        },
        { prompt: text, model, msgId },
      );

      if (!result.success) throw new Error(result.error);
      res.json({ status: true, result: result.result.message, model });
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Gagal chat dengan Genspark" });
    }
  },
};
