/**
 * ChatILM Islamic-AI
 * Author: nath (API integration adapted for Antigravity)
 * Base: https://chatilm.islamicity.org/
 */

import { loadSession, saveSession } from "../../src/utils/session.js";

const TARGET_URL = "https://chatilmv2-ehfaf4dxccg4dde2.eastus2-01.azurewebsites.net/api/v1/context-in-usage";

async function fetchChatILM(messages) {
  const res = await fetch(TARGET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream"
    },
    body: JSON.stringify({
      messages,
      referrer: "ChatILM",
      stream: false
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ChatILM request failed with status ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Respons kosong dari ChatILM");
  }

  return {
    content,
    model: data.model || "chatilm-islamic-ai",
    usage: data.usage || null,
    context: data.context || null
  };
}

export default {
  name: "ChatILM (Islamic AI)",
  description: "AI Islami untuk konsultasi dan tanya jawab seputar agama Islam beserta dalil dan hukumnya",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks", "session", "stream"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan seputar Islam",
      example: "Apa hukum sholat jumat bagi laki-laki muslim?"
    },
    session: {
      type: "string",
      required: false,
      description: "ID Sesi untuk melacak histori obrolan sebelumnya",
      example: "muslim-123"
    },
    stream: {
      type: "boolean",
      required: false,
      default: false,
      enum: ["true", "false"],
      description: "Set true untuk menerima respons secara real-time / streaming (Server-Sent Events / SSE)",
      example: "false"
    }
  },

  async run(req, res) {
    try {
      const data = { ...req.query, ...req.body };
      const teks = data.teks || data.message || data.prompt;
      if (!teks || typeof teks !== "string" || !teks.trim()) {
        return res.status(400).json({ status: false, message: "Parameter 'teks' wajib diisi dengan pertanyaan seputar Islam" });
      }

      const sessionId = data.session || data.session_id || null;
      const sessionFile = sessionId ? `chatilm-${sessionId}.json` : `chatilm.json`;
      const isStream = data.stream === "true" || data.stream === true;

      const sessionObj = await loadSession(sessionFile, { messages: [] });
      if (!sessionObj.messages || !Array.isArray(sessionObj.messages)) {
        sessionObj.messages = [];
      }

      sessionObj.messages.push({ role: "user", content: teks.trim() });
      if (sessionObj.messages.length > 12) {
        sessionObj.messages = sessionObj.messages.slice(-12);
      }

      const result = await fetchChatILM(sessionObj.messages);

      if (result.content) {
        sessionObj.messages.push({ role: "assistant", content: result.content });
        await saveSession(sessionFile, sessionObj);
      }

      if (isStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const words = result.content.split(/(?<=\s+)/);
        for (const word of words) {
          res.write(`data: ${JSON.stringify({
            id: "chatilm-" + Date.now(),
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: result.model,
            choices: [{ delta: { content: word }, index: 0, finish_reason: null }]
          })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({
          id: "chatilm-" + Date.now(),
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: result.model,
          choices: [{ delta: {}, index: 0, finish_reason: "stop" }]
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      return res.json({
        status: true,
        model: result.model,
        provider: "chatilm.islamicity.org",
        input: teks.trim(),
        result: result.content,
        usage: result.usage,
        context: result.context,
        session_id: sessionId || null
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal menghubungi layanan ChatILM"
      });
    }
  }
};
