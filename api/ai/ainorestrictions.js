import axios from "axios";

export default {
  name: "AI No Restrictions",
  description:
    "Chat dengan AI without restrictions — uncensored, no daily cap, no region lock. Streaming response via SSE.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["question"],
  paramsSchema: {
    question: {
      type: "string",
      required: true,
      description: "Pertanyaan untuk AI",
      example: "Apa kabar?",
      minLength: 1,
      maxLength: 10000,
    },
  },

  async run(req, res) {
    const question =
      req.query.question || req.body?.question || req.body?.text || "";

    if (!question || typeof question !== "string") {
      return res.status(400).json({
        status: false,
        error: "question is required (string)",
      });
    }

    const url = "https://aiwithnorestrictions.com/api/dispatch";
    const headers = {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "x-requested-with": "XMLHttpRequest",
    };

    try {
      const response = await axios.post(
        url,
        { user_input: question, model: "auto" },
        {
          headers,
          responseType: "stream",
          timeout: 120000,
        }
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      response.data.on("data", (chunk) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "delta" && parsed.chunk) {
              res.write(parsed.chunk);
            }
          } catch {}
        }
      });

      response.data.on("end", () => {
        res.end();
      });

      response.data.on("error", (err) => {
        console.error("ainorestrictions stream error:", err.message);
        if (!res.headersSent) {
          res.status(500).json({ status: false, error: "Stream failed" });
        } else {
          res.end();
        }
      });

      req.on("close", () => {
        response.data.destroy();
      });
    } catch (err) {
      console.error("ainorestrictions error:", err.message);
      return res.status(500).json({
        status: false,
        error: err.message || "Failed to reach aiwithnorestrictions.com",
      });
    }
  },
};
