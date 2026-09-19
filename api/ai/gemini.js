/**
 * Gemini AI Chat API
 * Menggunakan NoteGPT.io proxy untuk akses Google Gemini
 * Parameter: teks, session
 */

import axios from "axios"
import crypto from "node:crypto"
import { loadSession, saveSession } from "../../src/utils/session.js"

const BASE = "https://notegpt.io"
const SESSION_BASE = "notegpt-gemini"
const ua = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

function randomNumber(length = 10) {
  let result = ""
  for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10)
  return result
}

function makeCookieHeader() {
  const now = Math.floor(Date.now() / 1000)
  const anonymousUserId = crypto.randomUUID()
  const sboxRaw = `${now}|13|${randomNumber(9)}`
  const sboxGuid = Buffer.from(sboxRaw).toString("base64")
  return [
    `sbox-guid=${encodeURIComponent(sboxGuid)}`,
    `anonymous_user_id=${anonymousUserId}`,
    `_gid=GA1.2.${randomNumber(9)}.${now}`,
    `_ga=GA1.2.${randomNumber(9)}.${now}`,
    `_ga_PFX3BRW5RQ=GS2.1.s${now}$o1$g1$t${now}$j20$l0$h${randomNumber(10)}`
  ].join("; ")
}

function parseSSE(rawBody) {
  let result = ""
  for (const line of rawBody.split(/\r?\n/)) {
    const clean = line.trim()
    if (!clean.startsWith("data:")) continue
    const raw = clean.replace(/^data:\s*/, "").trim()
    if (!raw || raw === "[DONE]") continue
    try {
      const json = JSON.parse(raw)
      if (json.text) result += json.text
      if (json.done) break
    } catch {}
  }
  return result
}

export default {
  name: "Gemini AI",
  description: "Google Gemini AI Chat. Mendukung percakapan multi-turn dengan session.",
  category: "AI CHAT",
  methods: ["GET"],
  params: ["teks", "session"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk Gemini AI"
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi kustom untuk percakapan terpisah (opsional)"
    }
  },

  async run(req, res) {
    try {
      const { teks, session: sessionId } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        })
      }

      if (teks.length > 2000) {
        return res.status(400).json({
          status: false,
          message: "Teks terlalu panjang (maksimal 2000 karakter)"
        })
      }

      const history = await loadSession(
        getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : ""),
        []
      )
      const conversationId = crypto.randomUUID()

      const payload = {
        message: teks.trim(),
        language: "auto",
        model: "gemini-3-flash",
        tone: "default",
        length: "moderate",
        conversation_id: conversationId,
        image_urls: [],
        history_messages: history.slice(-5).flatMap(item => [
          { role: "user", content: item.user },
          { role: "assistant", content: item.assistant }
        ]),
        chat_mode: "standard"
      }

      const response = await axios.post(`${BASE}/api/v2/chat/stream`, JSON.stringify(payload), {
        timeout: 60000,
        responseType: "stream",
        validateStatus: () => true,
        headers: {
          "sec-ch-ua-platform": '"Android"',
          "User-Agent": ua,
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "Content-Type": "application/json",
          "sec-ch-ua-mobile": "?1",
          Accept: "*/*",
          Origin: BASE,
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          "sec-fetch-dest": "empty",
          Referer: `${BASE}/ai-chat`,
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "id-ID,id;q=0.9",
          Cookie: makeCookieHeader(),
          priority: "u=1, i"
        }
      })

      let rawBody = ""
      response.data.setEncoding("utf8")
      response.data.on("data", chunk => { rawBody += chunk })

      const result = await new Promise(resolve => {
        response.data.on("end", () => resolve({ answer: parseSSE(rawBody), conversation_id: conversationId }))
        response.data.on("error", () => resolve({ answer: "", conversation_id: conversationId }))
      })

      if (result.answer) {
        history.push({ user: teks.trim(), assistant: result.answer })
        await saveSession(
          getSessionFile(sessionId && typeof sessionId === "string" ? sessionId.trim() : ""),
          history
        )
      }

      res.json({
        status: Boolean(result.answer),
        input: teks.trim(),
        result: result.answer,
        model: "gemini-3-flash",
        conversation_id: result.conversation_id,
        session_id: sessionId?.trim() || null,
        timestamp: Date.now()
      })

    } catch (err) {
      console.error("Gemini Error:", err.message)
      res.status(500).json({
        status: false,
        message: err.message || "Gemini AI request failed",
        provider: "notegpt.io",
        timestamp: Date.now()
      })
    }
  }
}
