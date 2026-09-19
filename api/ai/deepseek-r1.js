import https from "https";
import crypto from "crypto";

function deepseekR1Chat(prompt, thinkMode = false) {
  const csrfToken = crypto.randomBytes(32).toString("base64").slice(0, 40);
  const postData = JSON.stringify({
    model: "deepseek/deepseek-r1",
    messages: [{ role: "user", content: prompt }]
  });

  return new Promise((resolve) => {
    let fullResponse = "";
    let fullReasoning = "";
    let modelUsed = "";

    const req = https.request({
      hostname: "deep-seek.ai",
      port: 443,
      path: "/api/chat",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": csrfToken,
        "Content-Length": Buffer.byteLength(postData)
      }
    }, (res) => {
      let buffer = "";

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith(": OPENROUTER")) continue;
          if (!line.startsWith("data: ") || line.slice(6) === "[DONE]") continue;
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta;
            if (delta?.reasoning) fullReasoning += delta.reasoning;
            if (delta?.content) fullResponse += delta.content;
            if (data.model) modelUsed = data.model;
          } catch {}
        }
      });

      res.on("end", () => {
        const result = {
          answer: fullResponse.trim(),
          model: modelUsed || "deepseek/deepseek-r1"
        };
        if (thinkMode && fullReasoning.trim()) result.reasoning = fullReasoning.trim();
        resolve(result);
      });
    });

    req.on("error", (e) => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
}

export default {
  name: "DeepSeek R1",
  description: "DeepSeek R1 AI dengan dukungan mode thinking/reasoning",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks", "think"],
  paramsSchema: {
    teks: { type: "string", required: true, description: "Pertanyaan atau prompt", example: "Jelaskan bagaimana black hole terbentuk", minLength: 1 },
    think: { type: "string", required: true, default: "false", description: "Aktifkan mode reasoning/thinking", enum: ["true", "false"] }
  },
  async run(req, res) {
    const { teks, think } = { ...req.query, ...req.body };
    if (!teks) return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi" });

    const thinkMode = think === "true" || think === "1";

    try {
      const result = await deepseekR1Chat(teks.trim(), thinkMode);
      if (result.error) return res.status(502).json({ status: false, message: result.error });
      if (!result.answer) return res.status(502).json({ status: false, message: "Tidak ada respons dari DeepSeek R1" });

      const out = { status: true, result: result.answer, model: result.model };
      if (thinkMode && result.reasoning) out.reasoning = result.reasoning;
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ status: false, message: e.message });
    }
  }
};
