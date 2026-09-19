/**
 * NVIDIA NIM AI Chat
 * Provider: NVIDIA NIM (integrate.api.nvidia.com)
 * Parameter: teks, model
 * API Key: NO API KEY (uses shared NIM key)
 */

import axios from "axios";

const API_KEY = "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";
const BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const models = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "stepfun-ai/step-3.7-flash",
  "z-ai/glm-5.1",
  "nvidia/nemotron-3-content-safety",
  "stepfun-ai/step-3.5-flash",
  "nvidia/nemotron-content-safety-reasoning-4b",
  "mistralai/mistral-large-3-675b-instruct-2512",
  "bytedance/seed-oss-36b-instruct",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "google/gemma-3n-e4b-it",
  "google/gemma-3n-e2b-it",
  "mistralai/mistral-nemotron",
  "meta/llama-4-maverick-17b-128e-instruct",
  "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
  "google/gemma-2-2b-it"
];

async function nvidiaChat(teks, model) {
  const { data } = await axios.post(BASE_URL, {
    model,
    messages: [{ role: "user", content: teks }],
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: 4096,
    stream: false
  }, {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  const msg = data.choices?.[0]?.message;
  const reasoning = msg?.reasoning_content || null;
  const content = msg?.content || "";

  return { content, reasoning, model: data.model || model };
}

export default {
  name: "NVIDIA NIM AI",
  description: "AI chat powered by NVIDIA NIM with 15 free models (Nemotron, Mistral, Qwen, Llama, Gemma, etc)",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks", "model"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Chat message text",
      example: "Hello, who are you?",
      minLength: 1,
      maxLength: 4096
    },
    model: {
      type: "string",
      required: true,
      description: "Model to use. Available: nemotron-3-nano-omni, step-3.7-flash, glm-5.1, nemotron-3-safety, step-3.5-flash, nemotron-safety-reasoning, mistral-large, seed-oss-36b, qwen3-coder, gemma-3n-e4b, gemma-3n-e2b, mistral-nemotron, llama-4-maverick, nemotron-safety-guard, gemma-2-2b. Default: nemotron-3-nano-omni",
      example: "mistral-large",
      default: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      enum: models
    }
  },
  async run(req, res) {
    const { teks, model: modelInput } = { ...req.query, ...req.body };

    if (!teks || typeof teks !== "string" || !teks.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" });
    }

    // Resolve model: accept full model ID or short alias
    let selectedModel = modelInput || models[0];
    if (!selectedModel.includes("/")) {
      // Short alias matching
      const alias = models.find(m => m.toLowerCase().includes(selectedModel.toLowerCase()));
      if (alias) selectedModel = alias;
    }

    try {
      const result = await nvidiaChat(teks.trim(), selectedModel);

      res.json({
        status: true,
        input: teks.trim(),
        model: result.model,
        reasoning: result.reasoning,
        result: result.content
      });
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message || "NVIDIA NIM request failed";
      res.status(500).json({ status: false, message: errMsg });
    }
  }
};
