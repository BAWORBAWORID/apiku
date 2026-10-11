import http2 from "node:http2";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

const STATUS_URL = "/duckchat/v1/status";
const CHAT_URL = "/duckchat/v1/chat";
const DUCK_HOST = "https://duck.ai";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const FE_VERSION = "serp_20260721_142452_ET-ab8de4e01a8248668dfcb11d666898c33cbe4eb1";

export const MODELS = {
  // Model aktif
  "gpt-6-luna": "gpt-6-luna",
  "luna": "gpt-6-luna",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "gpt-5.4-nano": "gpt-5.4-nano",
  "claude-haiku-4-5": "claude-haiku-4-5",
  "mistral-small-2603": "mistral-small-2603",
  "gemma4-31b": "tinfoil/gemma4-31b",
  "gpt-oss-120b": "tinfoil/gpt-oss-120b",

  // Model lama / alias
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4o": "gpt-4o-mini",
  "claude-3-haiku": "claude-3-haiku-20240307",
  "claude": "claude-3-haiku-20240307",
  "llama-3.3": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "llama": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "mistral-small": "mistralai/Mistral-Small-24B-Instruct-2501",
  "mistral": "mistralai/Mistral-Small-24B-Instruct-2501",
};

// ─── Challenge Solver (JSDOM Environment) ────────────────────────────────────
const dom = new JSDOM("", {
  url: "https://duck.ai/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
});
Object.defineProperty(dom.window.navigator, "userAgent", { value: DEFAULT_USER_AGENT });
Object.defineProperty(dom.window, "crypto", {
  value: {
    subtle: {
      digest: async (algorithm, data) => crypto.createHash("sha256").update(data).digest(),
    },
  },
  writable: true,
  configurable: true,
});
dom.window.TextEncoder = TextEncoder;

function hashStr(str) {
  return crypto.createHash("sha256").update(String(str)).digest("base64");
}

async function solveChallenge(rawScriptBase64) {
  try {
    const scriptStr = Buffer.from(rawScriptBase64, "base64").toString("utf8");
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

// ─── HTTP/2 Client Pool (Bypass Datacenter 418 ERR_BN_LIMIT) ─────────────────
let h2Client = null;

function getH2Client() {
  if (!h2Client || h2Client.destroyed || h2Client.closed) {
    h2Client = http2.connect(DUCK_HOST);
    h2Client.on("error", () => { h2Client = null; });
    h2Client.on("close", () => { h2Client = null; });
    h2Client.on("goaway", () => { h2Client = null; });
  }
  return h2Client;
}

function requestH2(pathStr, headers, bodyStr = null) {
  return new Promise((resolve, reject) => {
    try {
      const client = getH2Client();
      const method = bodyStr ? "POST" : "GET";
      const reqHeaders = {
        ":method": method,
        ":path": pathStr,
        ...headers,
      };

      const req = client.request(reqHeaders);
      let responseHeaders = {};

      req.on("response", (hdrs) => {
        responseHeaders = hdrs;
      });

      let rawData = "";
      req.on("data", (chunk) => {
        rawData += chunk.toString("utf8");
      });

      req.on("end", () => {
        resolve({
          status: responseHeaders[":status"],
          headers: responseHeaders,
          text: () => rawData,
          json: () => JSON.parse(rawData),
        });
      });

      req.on("error", reject);

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Image Helpers ───────────────────────────────────────────────────────────
async function imageToDataUrl(imageInput) {
  if (typeof imageInput === "string") {
    if (imageInput.startsWith("data:image/")) return imageInput;
    if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
      const imgRes = await fetch(imageInput);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = imgRes.headers.get("content-type") || "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    const buf = await fs.readFile(path.resolve(imageInput));
    const ext = path.extname(imageInput).toLowerCase().replace(".", "");
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  if (Buffer.isBuffer(imageInput) || imageInput instanceof Uint8Array) {
    const buf = Buffer.from(imageInput);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }
  throw new Error("Unsupported image format");
}

// ─── Main askDuckAI Function ─────────────────────────────────────────────────
export async function askDuckAI(input, options = {}) {
  let messages = [];

  if (typeof input === "string") {
    const rawImages = options.images || (options.image ? [options.image] : []);
    if (rawImages.length > 0) {
      const parts = [{ type: "input_text", text: input.trim() }];
      for (const img of rawImages) {
        const dataUrl = await imageToDataUrl(img);
        parts.push({ type: "input_image", image_url: dataUrl });
      }
      messages = [{ role: "user", content: parts }];
    } else {
      messages = [{ role: "user", content: input.trim() }];
    }
  } else if (Array.isArray(input)) {
    messages = input;
  } else {
    throw new Error("Input must be a prompt string or array of messages");
  }

  const selectedModel = MODELS[options.model] || options.model || "gpt-6-luna";
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;

  // 1. Get Status & Hash Challenge
  const statusRes = await requestH2(STATUS_URL, {
    "user-agent": userAgent,
    accept: "*/*",
    "x-vqd-accept": "1",
    "x-fe-version": FE_VERSION,
  });

  if (statusRes.status !== 200) {
    throw new Error(`DuckAI status request failed with code ${statusRes.status}`);
  }

  const hashChallenge = statusRes.headers["x-vqd-hash-1"];
  if (!hashChallenge) {
    throw new Error("Failed to retrieve x-vqd-hash-1 challenge from DuckAI");
  }

  // 2. Solve Challenge
  const solvedHash = await solveChallenge(hashChallenge);

  // 3. Prepare Chat Request
  const chatHeaders = {
    "user-agent": userAgent,
    "content-type": "application/json",
    accept: "text/event-stream",
    "x-vqd-hash-1": solvedHash,
    "x-fe-version": FE_VERSION,
    origin: "https://duck.ai",
    referer: "https://duck.ai/",
  };

  if (options.vqd) {
    chatHeaders["x-vqd-4"] = options.vqd;
  }

  const toolChoice = {};
  if (options.generateImage || options.isImageGeneration) {
    toolChoice.GenerateImage = true;
  }
  if (options.webSearch) {
    toolChoice.WebSearch = true;
  }

  const requestBody = {
    model: selectedModel,
    messages,
  };

  if (Object.keys(toolChoice).length > 0) {
    requestBody.toolChoice = toolChoice;
  }

  const bodyStr = JSON.stringify(requestBody);

  // 4. Send Chat Request via HTTP/2
  const chatRes = await requestH2(CHAT_URL, chatHeaders, bodyStr);

  if (chatRes.status === 418) {
    const errorJson = chatRes.json();
    throw new Error(`DuckAI blocked with 418 (${errorJson.type || "ERR_CHALLENGE"})`);
  }

  if (chatRes.status !== 200) {
    const errorText = chatRes.text();
    throw new Error(`DuckAI chat request failed (${chatRes.status}): ${errorText}`);
  }

  const nextVqd = chatRes.headers["x-vqd-4"];
  const rawBody = chatRes.text();

  let completeAnswer = "";
  const generatedImages = [];
  const sources = [];

  const lines = rawBody.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const dataPart = trimmed.slice(5).trim();
    if (dataPart === "[DONE]") break;

    try {
      const parsed = JSON.parse(dataPart);
      if (parsed.message) {
        completeAnswer += parsed.message;
      }
      if (parsed.type === "generated-image") {
        const b64 = parsed.result;
        const fmt = parsed.format || "png";
        generatedImages.push({
          id: parsed.id,
          format: fmt,
          width: parsed.width,
          height: parsed.height,
          base64: b64,
          data_url: b64 ? `data:image/${fmt};base64,${b64}` : null,
        });
      }
      if (parsed.type === "source" && parsed.url) {
        sources.push({
          title: parsed.title,
          url: parsed.url,
          site: parsed.site,
        });
      }
    } catch {}
  }

  return {
    success: true,
    model: selectedModel,
    answer: completeAnswer.trim(),
    images: generatedImages,
    sources,
    next_vqd: nextVqd,
  };
}

// ─── ChatSession Class ───────────────────────────────────────────────────────
export class ChatSession {
  constructor(options = {}) {
    this.model = options.model || "gpt-6-luna";
    this.systemPrompt = options.systemPrompt || null;
    this.vqd = options.vqd || null;
    this.history = [];
    if (this.systemPrompt) {
      this.history.push({ role: "system", content: this.systemPrompt });
    }
  }

  async send(input, options = {}) {
    let userContent = input;
    const rawImages = options.images || (options.image ? [options.image] : []);
    if (typeof input === "string" && rawImages.length > 0) {
      const parts = [{ type: "input_text", text: input.trim() }];
      for (const img of rawImages) {
        const dataUrl = await imageToDataUrl(img);
        parts.push({ type: "input_image", image_url: dataUrl });
      }
      userContent = parts;
    } else if (typeof input === "string") {
      userContent = input.trim();
    }

    this.history.push({ role: "user", content: userContent });

    const res = await askDuckAI(this.history, {
      model: options.model || this.model,
      vqd: this.vqd,
      ...options,
    });

    if (res.next_vqd) {
      this.vqd = res.next_vqd;
    }
    if (res.answer) {
      this.history.push({ role: "assistant", content: res.answer });
    }
    return res;
  }
}

export function createChatSession(options = {}) {
  return new ChatSession(options);
}

export default {
  askDuckAI,
  ChatSession,
  createChatSession,
  MODELS,
};

// ─── Test Runner ─────────────────────────────────────────────────────────────
if (process.argv[1] && (process.argv[1].endsWith("tes.js") || process.argv[1].endsWith("test.js"))) {
  (async () => {
    console.log("=== Testing DuckAI All Models ===\n");
    const testKeys = [
      "gpt-6-luna",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "claude-haiku-4-5",
      "mistral-small-2603",
      "gemma4-31b",
      "gpt-oss-120b",
      "gpt-4o-mini",
      "claude-3-haiku",
      "llama-3.3",
      "mistral-small",
    ];

    for (const key of testKeys) {
      const targetModel = MODELS[key] || key;
      process.stdout.write(`Testing [${key}] (${targetModel}) ... `);
      try {
        const res = await askDuckAI("Halo, perkenalkan namamu dan modelmu dalam 1 kalimat.", {
          model: key,
        });
        if (res.success && res.answer) {
          console.log("SUCCESS ✅");
          console.log(`  > ${res.answer.slice(0, 110).replace(/\n/g, " ")}\n`);
        } else {
          console.log("FAILED ❌ (No answer)");
        }
      } catch (err) {
        console.log(`FAILED ❌ -> ${err.message}\n`);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log("=== Test Completed ===");
    process.exit(0);
  })();
}
