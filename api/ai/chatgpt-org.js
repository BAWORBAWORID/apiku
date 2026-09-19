import { loadSession, saveSession } from "../../src/utils/session.js"

const BASE_URL = "https://chatai.org"
const SESSION_BASE = "chatgpt-org"

const MODELS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-haiku-4-5",
  "deepseek/deepseek-chat-v3-0324",
  "qwen/qwen-2.5-72b-instruct",
  "perplexity/sonar",
]

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

function getSessionFile(sessionId) {
  return sessionId ? `${SESSION_BASE}-${sessionId}.json` : `${SESSION_BASE}.json`
}

async function getCookiesAndXsrf() {
  const res = await fetch(`${BASE_URL}/`, {
    method: "GET",
    headers: { "User-Agent": UA },
  })
  
  const setCookies = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : [])

  const cookieMap = {}
  setCookies.forEach(c => {
    const clean = c.split(";")[0]
    const idx = clean.indexOf("=")
    if (idx > 0) {
      const name = clean.slice(0, idx).trim()
      const value = clean.slice(idx + 1).trim()
      cookieMap[name] = value
    }
  })

  const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join("; ")
  const xsrfToken = cookieMap["XSRF-TOKEN"] ? decodeURIComponent(cookieMap["XSRF-TOKEN"]) : ""

  return { cookieHeader, xsrfToken }
}

export default {
  name: "ChatGPT Org",
  description: "ChatGPT multi-model (GPT-4o Mini, Claude Haiku, DeepSeek, Qwen, Perplexity)",
  category: "AI CHAT",
  methods: ["GET"],
  params: ["teks", "model", "session"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan untuk AI",
    },
    model: {
      type: "string",
      required: true,
      default: "openai/gpt-4o-mini",
      description: "Model AI",
      enum: MODELS,
    },
    session: {
      type: "string",
      required: false,
      description: "ID sesi untuk percakapan berkelanjutan",
    },
  },

  async run(req, res) {
    try {
      const { teks, model, session: sessionId } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi",
        })
      }

      const selectedModel = MODELS.includes(model?.trim())
        ? model.trim()
        : "openai/gpt-4o-mini"

      const sessionFile = getSessionFile(sessionId?.trim() || "")
      const session = await loadSession(sessionFile, { messages: [] })

      session.messages.push({ role: "user", content: teks.trim() })

      const { cookieHeader, xsrfToken } = await getCookiesAndXsrf()

      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Origin": BASE_URL,
          "Referer": `${BASE_URL}/`,
          "User-Agent": UA,
          "Cookie": cookieHeader,
          "X-XSRF-TOKEN": xsrfToken,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: session.messages,
        }),
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => "")
        return res.status(response.status).json({
          status: false,
          message: `ChatGPT.org error: ${response.status}${errText ? ` — ${errText}` : ""}`,
        })
      }

      const decoder = new TextDecoder("utf-8")
      let buffer = ""
      let answer = ""

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const jsonStr = line.slice(5).trim()
          if (!jsonStr || jsonStr.startsWith(":")) continue

          try {
            const json = JSON.parse(jsonStr)
            const text = json?.choices?.[0]?.delta?.content
            if (text) answer += text
          } catch {}
        }
      }

      if (answer) {
        session.messages.push({ role: "assistant", content: answer })
        session.messages = session.messages.slice(-20)
        await saveSession(sessionFile, session)
      }

      res.json({
        status: Boolean(answer),
        model: selectedModel,
        input: teks.trim(),
        result: answer || "Tidak ada respons dari AI",
        session_id: sessionId?.trim() || null,
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "ChatGPT.org request failed",
      })
    }
  },
}
