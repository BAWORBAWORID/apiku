import http2 from "http2";
import crypto from "crypto";
import { JSDOM } from "jsdom";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const FE_VERSION = "serp_20260721_142452_ET-ab8de4e01a8248668dfcb11d666898c33cbe4eb1";

const MODELS = [
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "claude-haiku-4-5",
  "mistral-small-2603",
];

const dom = new JSDOM("", {
  url: "https://duck.ai/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
});
Object.defineProperty(dom.window.navigator, "userAgent", { value: USER_AGENT });
Object.defineProperty(dom.window, "crypto", {
  value: { subtle: { digest: async (algorithm, data) => crypto.createHash("sha256").update(data).digest() } },
  writable: true,
  configurable: true,
});
dom.window.TextEncoder = TextEncoder;

function hashStr(str) {
  return crypto.createHash("sha256").update(String(str)).digest("base64");
}

async function solveChallenge(base64Script) {
  try {
    const scriptStr = Buffer.from(base64Script, "base64").toString("utf8");
    const result = await dom.window.eval(
      "(async function(){try{return " + scriptStr + ";}catch(e){return{error:e.message,stack:e.stack}}})();"
    );
    if (result && result.error) throw new Error(result.error);
    result.client_hashes = result.client_hashes.map((val) => hashStr(val));
    result.meta = Object.assign({}, result.meta || {}, {
      origin: "https://duck.ai",
      stack: "Error\n    at l (https://duck.ai/dist/duckai-dist/entry.duckai.238a473623376d93f642.js:1:35804)",
      duration: String(Math.floor(Math.random() * 50) + 20),
    });
    return Buffer.from(JSON.stringify(result)).toString("base64");
  } catch (e) {
    throw new Error("Gagal resolve challenge: " + e.message);
  }
}

let globalH2Client = null;

function fetchH2(reqPath, headers, bodyStr = null) {
  return new Promise((resolve, reject) => {
    if (!globalH2Client || globalH2Client.destroyed || globalH2Client.closed) {
      globalH2Client = http2.connect("https://duck.ai");
      globalH2Client.on("error", () => { globalH2Client = null; });
      globalH2Client.on("close", () => { globalH2Client = null; });
      globalH2Client.on("goaway", () => { globalH2Client = null; });
    }
    const method = bodyStr ? "POST" : "GET";
    const reqHeaders = { ":method": method, ":path": reqPath, ...headers };
    const req = globalH2Client.request(reqHeaders);
    req.on("response", (resHeaders) => {
      resolve({
        status: resHeaders[":status"],
        headers: resHeaders,
        stream: req,
        text: async () => {
          let data = "";
          req.setEncoding("utf8");
          for await (const chunk of req) data += chunk;
          return data;
        },
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sessions = {};

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {
      id,
      journeyId: crypto.randomBytes(16).toString("hex"),
      conversationId: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
      vqdToken: null,
      messages: [],
    };
  }
  return sessions[id];
}

async function initSession(session) {
  const response = await fetchH2("/duckchat/v1/status", {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    priority: "u=1, i",
    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "x-vqd-accept": "1",
    referer: "https://duck.ai/",
    "user-agent": USER_AGENT,
  });

  const challengeBase64 = response.headers["x-vqd-hash-1"];
  await response.text();

  if (!challengeBase64) throw new Error("Tidak menemukan challenge token");

  session.vqdToken = await solveChallenge(challengeBase64);
  if (!session.vqdToken) throw new Error("Gagal memecahkan challenge");

  return session.vqdToken;
}

async function downloadImageAsBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to download image: " + res.status);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    return { mime: contentType, base64 };
  } catch (e) {
    throw new Error("Gagal mengunduh gambar: " + e.message);
  }
}

async function chatWithDuckAI(session, text, model = "gpt-4o-mini", imageUrl) {
  if (!session.vqdToken) {
    await initSession(session);
  }

  let content = text;
  if (imageUrl) {
    const { mime, base64 } = await downloadImageAsBase64(imageUrl);
    content = [{ type: "text", text }, { type: "image", mimeType: mime, image: "data:" + mime + ";base64," + base64 }];
  }

  session.messages.push({ role: "user", content });

  const { subtle } = crypto.webcrypto;
  const kp = await subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["encrypt", "decrypt"]
  );
  const jwk = await subtle.exportKey("jwk", kp.publicKey);
  jwk.use = "enc";

  const msgId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

  const signals = {
    start: Date.now(),
    events: [{ name: "action", delta: Math.floor(Math.random() * 2000) + 2000, trusted: true }],
    end: Math.floor(Math.random() * 4000) + 5000,
  };

  const body = JSON.stringify({
    model,
    canUseTools: true,
    durableStream: { messageId: msgId, conversationId: session.conversationId, publicKey: jwk },
    messages: session.messages,
    metadata: { toolChoice: { NewsSearch: false, VideosSearch: false, LocalSearch: false, WeatherForecast: false } },
    reasoningEffort: "none",
  });

  let retries = 3;
  let botReply = "";

  while (retries > 0) {
    retries--;
    try {
      const response = await fetchH2("/duckchat/v1/chat", {
        accept: "text/event-stream",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
        priority: "u=1, i",
        "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-ddg-journey-id": session.journeyId,
        "x-vqd-hash-1": session.vqdToken,
        origin: "https://duck.ai",
        referer: "https://duck.ai/",
        "x-fe-version": "serp_20260721_142452_ET-ab8de4e01a8248668dfcb11d666898c33cbe4eb1",
        "x-fe-signals": Buffer.from(JSON.stringify(signals)).toString("base64"),
        "user-agent": USER_AGENT,
      }, body);

      if (response.status === 418) {
        await initSession(session);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      if (response.status !== 200) {
        const errText = await response.text();
        session.messages.pop();
        throw new Error("HTTP " + response.status + ": " + errText.substring(0, 200));
      }

      for (const key of Object.keys(response.headers)) {
        if (key.startsWith("x-vqd-hash-")) {
          session.vqdToken = response.headers[key];
          break;
        }
      }

      response.stream.setEncoding("utf8");
      let buffer = "";
      for await (const chunk of response.stream) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]" || !dataStr) continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.message) botReply += parsed.message;
            } catch (e) {}
          }
        }
      }

      session.messages.push({ role: "assistant", content: botReply });
      return botReply;
    } catch (e) {
      if (retries === 0) throw e;
      await initSession(session);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  throw new Error("Gagal setelah 3 kali percobaan");
}

export default {
  name: "Duck.ai Chat",
  description: "AI Chat — GPT-5.4, Claude, Mistral, vision support",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["text", "model", "image", "session_id"],

  paramsSchema: {
    text: {
      type: "string",
      required: false,
      description: "Pertanyaan untuk AI",
      example: "Halo, apa kabar?",
    },
    model: {
      type: "string",
      required: false,
      default: "gpt-4o-mini",
      enum: MODELS,
      description: "Model AI Duck.ai",
    },
    image: {
      type: "string",
      required: false,
      description: "URL gambar untuk analisis (http/https)",
      example: "https://example.com/image.png",
    },
    session_id: {
      type: "string",
      required: false,
      description: "Session ID untuk multi-turn conversation",
    },
  },

  async run(req, res) {
    const { text, model = "gpt-4o-mini", image, session_id } = { ...req.query, ...req.body };

    if (!text && !image) {
      return res.status(400).json({ status: false, message: "Parameter 'text' atau 'image' wajib diisi" });
    }

    try {
      const sid = session_id || "default";
      const session = getSession(sid);

      if (!session.vqdToken) {
        try {
          await initSession(session);
        } catch (e) {
          return res.status(500).json({ status: false, message: "Gagal menghubungkan ke Duck.ai: " + e.message });
        }
      }

      const result = await chatWithDuckAI(session, text, model, image || null);
      res.json({ status: true, result: result.replace("  ", "").trim(), model, session_id: sid });
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Gagal chat dengan Duck.ai" });
    }
  },
};