import axios from "axios";
import logger from "../../src/utils/logger.js";

const SURFSENSE_URL = "https://api.surfsense.com/api/v1/public/anon-chat/stream";
const MODEL = "gpt-5.4-mini-no-login";

export default {
  name: "GPT-5.4 (SurfSense)",
  description: "Chat GPT-5.4 — gratis, tanpa login, streaming response",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["prompt"],

  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Pesan atau pertanyaan untuk GPT-5.4",
      example: "Halo, apa kabar?",
    },
  },

  async run(req, res) {
    try {
      const prompt = req.query?.prompt || req.body?.prompt;

      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib diisi" });
      }

      const { data: stream } = await axios({
        method: "POST",
        url: SURFSENSE_URL,
        headers: { "Content-Type": "application/json" },
        data: {
          model_slug: MODEL,
          messages: [{ role: "user", content: prompt.trim() }],
        },
        responseType: "stream",
        timeout: 60000,
      });

      let text = "";
      let buffer = "";

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") {
            stream.destroy();
            return res.json({
              status: true,
              model: "gpt-5.4",
              result: text,
            });
          }
          try {
            const json = JSON.parse(raw);
            if (json.type === "text-delta") {
              text += json.delta;
            }
          } catch {}
        }
      }

      stream.on("end", () => {
        res.json({
          status: true,
          model: "gpt-5.4",
          result: text,
        });
      });
    } catch (err) {
      const message = typeof err?.response?.data === 'string' ? err.response.data
        : (err?.response?.data?.message || err?.response?.data?.error || err.message || "Gagal request ke SurfSense");
      logger.error(`[GPT5-4] Error: ${typeof message === 'string' ? message : JSON.stringify(message)}`);
      res.status(500).json({ status: false, message: typeof message === 'string' ? message : 'Gagal request ke SurfSense' });
    }
  },
};