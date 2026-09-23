/**
 * DeepAI AI Code Chat
 * Provider: deepai.org (chat/ai-code)
 * Parameter: prompt, model
 * NO API KEY
 */

import crypto from "crypto";

const PAGE = "https://deepai.org/chat/ai-code";
const API = "https://api.deepai.org/hacking_is_a_serious_crime";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const myhash = (s) => crypto.createHash("md5").update(s).digest("hex");

function generateIslandKey() {
  const r = Math.round(Math.random() * 100000000000) + "";
  const inner = UA + myhash(UA + myhash(UA + r + "hackers_become_a_little_stinkier_every_time_they_hack"));
  return "tryit-" + r + "-" + myhash(inner);
}

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function extractArray(html, name) {
  const m = html.match(new RegExp("const\\s+" + name + "=\\[([^\\]]*)\\]"));
  if (!m) return null;
  try {
    return JSON.parse("[" + m[1] + "]");
  } catch {
    return null;
  }
}

let cachedModels = null;
let cacheTime = 0;

async function getUsableModels() {
  if (cachedModels && Date.now() - cacheTime < 10 * 60 * 1000) return cachedModels;
  const res = await fetch(PAGE, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) throw new Error("Gagal ambil halaman (HTTP " + res.status + ")");
  const html = await res.text();
  const base = extractArray(html, "baseChatModes") || [];
  const extra = extractArray(html, "additionalModels") || [];
  const all = [...base, ...extra].map((m) => ({ id: m.value, name: m.label }));
  const usable = all.filter((m) => {
    const raw = m.id;
    const locked = [...base, ...extra].find((x) => x.value === raw)?.locked || false;
    return !locked;
  });
  cachedModels = usable;
  cacheTime = Date.now();
  return usable;
}

function cleanAnswer(raw) {
  let out = raw.includes("\u001C") ? raw.split("\u001C")[0] : raw;
  const s = out.indexOf("\x1dTHINKING_START");
  const e = out.indexOf("\x1dTHINKING_END");
  if (s !== -1 && e !== -1) out = out.slice(0, s) + out.slice(e + "\x1dTHINKING_END".length);
  return out.trim();
}

async function ask(model, history) {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("chatHistory", JSON.stringify(history));
  fd.append("chat_style", "ai-code");
  fd.append("enabled_tools", JSON.stringify(["image_generator", "image_editor"]));
  fd.append("hacker_is_stinky", "very_stinky");
  fd.append("memory_enabled", "false");
  fd.append("sensitivity_request_id", uuidv4());
  fd.append("session_uuid", uuidv4());
  fd.append("thinking_support", "1");
  fd.append("attachment_uuids", "[]");
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "api-key": generateIslandKey(),
      "user-agent": UA,
      origin: "https://deepai.org",
      referer: "https://deepai.org/chat/ai-code",
      accept: "*/*"
    },
    body: fd
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("HTTP " + res.status + ": " + t.slice(0, 200));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.includes("\u001C")) break;
  }
  return cleanAnswer(buf.split("\u001C")[0]);
}

export default {
  name: "DeepAI AI Code Chat",
  description: "DeepAI AI Code Chat - No API Key Required. 10 model tersedia (DeepSeek V3.2, Gemini 2.5 Flash Lite, GPT-5 Nano, Llama 4 Scout, dll)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["prompt", "model"],
  paramsSchema: {
    prompt: { type: "string", required: true, description: "Pertanyaan atau perintah untuk AI", example: "Buatkan fungsi fibonacci di JavaScript" },
    model: { type: "string", required: false, description: "ID model (default: deepseek-v3.2). List: standard, deepseek-v3.2, gemini-2.5-flash-lite, gemma-4, gpt-4.1-nano, gpt-oss-120b, gpt-5-nano, llama-3.3-70b-instruct, llama-3.1-8b-instant, llama-4-scout", example: "deepseek-v3.2" }
  },

  async run(req, res) {
    try {
      const { prompt, model } = { ...req.query, ...req.body };

      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'prompt' wajib diisi"
        });
      }

      let models = [];
      try {
        models = await getUsableModels();
      } catch (e) {
        return res.status(500).json({ status: false, message: "Gagal memuat model: " + e.message });
      }

      const target = model || "deepseek-v3.2";
      const found = models.find((m) => m.id === target);
      if (!found) {
        return res.status(400).json({
          status: false,
          message: "Model '" + target + "' tidak ditemukan atau terkunci. Model tersedia: " + models.map((m) => m.id).join(", ")
        });
      }

      const answer = await ask(target, [{ role: "user", content: prompt.trim() }]);

      res.json({
        status: true,
        provider: "deepai.org",
        model: target,
        model_name: found.name,
        input: prompt.trim(),
        result: answer || "No response generated",
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "DeepAI request failed"
      });
    }
  }
};
