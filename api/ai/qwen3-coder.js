/**
 * Mistral Large 3 — AI coding assistant
 * Provider: NVIDIA NIM (integrate.api.nvidia.com)
 * Model: mistralai/mistral-large-3-675b-instruct-2512
 * Parameter: teks (required)
 */

import axios from "axios";

const API_KEY = "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";
const BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "mistralai/mistral-large-3-675b-instruct-2512";

async function mistralChat(teks) {
  const { data } = await axios.post(BASE_URL, {
    model: MODEL,
    messages: [{ role: "user", content: teks }],
    temperature: 0.3,
    top_p: 0.95,
    max_tokens: 8192,
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

  return { content, reasoning, model: data.model || MODEL };
}

export default {
  name: "Mistral Large 3",
  description: "Mistral Large 3 675B — AI coding assistant (parameter: teks)",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Prompt or code question",
      example: "Buatkan fungsi untuk sorting array di JavaScript",
      minLength: 1,
      maxLength: 8192
    }
  },
  async run(req, res) {
    const { teks } = { ...req.query, ...req.body };

    if (!teks || typeof teks !== "string" || !teks.trim()) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'teks' wajib diisi",
        example: {
          GET: "/api/ai/mistral-large?teks=Buatkan%20fungsi%20sorting",
          POST: { teks: "Buatkan fungsi sorting" }
        }
      });
    }

    try {
      const result = await mistralChat(teks.trim());

      res.json({
        status: true,
        input: teks.trim(),
        model: result.model,
        reasoning: result.reasoning,
        result: result.content
      });
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message || "Mistral Large request failed";
      res.status(500).json({ status: false, message: errMsg });
    }
  }
};
