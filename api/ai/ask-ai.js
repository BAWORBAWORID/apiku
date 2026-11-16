/**
 * Edge AI Chat — Ask AI (Edge Contextual Chat)
 * Source: https://gist.githubusercontent.com/ayashiiiyo/f9c6b2963c49962fab92b009cb4689cc/raw/c20644a25389bb14e9e539557973e328c591f1cf/bing.mjs
 * Backend: https://edge.microsoft.com/edgecontextualchat/api/ctxsis
 *
 * Endpoint ini memanggil Edge AI contextual chat Microsoft untuk menjawab pertanyaan pengguna.
 */

const EDGE_AI_BASE = "https://edge.microsoft.com/edgecontextualchat/api/ctxsis";
const EDGE_USER_AGENT = "Mozilla/5.0 (Linux; Android 14; SM-G988N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0";

export default {
  name: "Ask AI (Edge Contextual Chat)",
  description:
    "Edge AI contextual chat via edge.microsoft.com/edgecontextualchat/api/ctxsis. " +
    "Kirim prompt, dapat jawaban komprehensif dari Edge AI Microsoft.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["prompt"],

  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Pertanyaan atau prompt yang ingin ditanyakan ke Edge AI",
      example: "bisa apa"
    },
    lang: {
      type: "string",
      required: false,
      description: "Bahasa response (default: id)",
      default: "id",
      enum: ["id", "en", "en-US", "ms"]
    },
    url: {
      type: "string",
      required: false,
      description: "URL konteks tambahan (default: https://example.com/context)",
      default: "https://example.com/context"
    },
    market: {
      type: "string",
      required: false,
      description: "Market locale untuk Edge AI (default: id-ID untuk bahasa Indonesia)",
      default: "id-ID"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.body, ...req.query };
      const prompt = String(params.prompt ?? "").trim();
      const lang = String(params.lang ?? "id").toLowerCase();
      const market = String(params.market ?? (lang === "id" ? "id-ID" : "en-US"));
      const targetUrl = String(params.url ?? "https://example.com/context");

      if (!prompt) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'prompt' wajib diisi.",
          api_time: `${Date.now() - startTime}ms`
        });
      }

      // Build PageContent sesuai format Edge AI
      let content = `Pertanyaan Pengguna:\n${prompt}\n\nInstruksi dan Konteks Diskusi:\nMohon berikan jawaban yang komprehensif, tepat sasaran, faktual, dan tersusun rapi menggunakan poin-poin utama yang mudah dipahami oleh pembaca. Pastikan uraian menjelaskan aspek terpenting dari topik yang ditanyakan dengan jelas, objektif, dan berbobot tanpa ada informasi yang terlewat.`;

      if (content.length < 350) {
        content += " ".repeat(350 - content.length);
      }

      const response = await fetch(`${EDGE_AI_BASE}/sisgenerationstream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": EDGE_USER_AGENT
        },
        body: JSON.stringify({
          Url: targetUrl,
          ClientName: "SA",
          Lang: lang,
          Market: market,
          PageContent: content,
          TriggerStatus: 0,
          QcScore: 70
        })
      });

      if (!response.ok) {
        throw new Error(`Edge AI HTTP ${response.status}`);
      }

      const answer = await response.text();

      return res.json({
        status: true,
        prompt,
        lang,
        market,
        answer,
        api_time: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[ask-ai] ${err.message || err}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses Edge AI chat.",
        api_time: `${Date.now() - startTime}ms`
      });
    }
  }
};
