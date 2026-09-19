import axios from "axios"
import crypto from "crypto"
import FormData from "form-data"
import { loadSession, saveSession } from "../../src/utils/session.js"
import logger from "../../src/utils/logger.js"

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
]

const BASE = "https://chat.sakana.ai"
const FIREBASE_KEY = "AIzaSyBIJuyUokxGiETY0Nu3hQNC1dMadHyf_I4"
const MODELS = ["namazu", "sakana", "namazu-v2", "namazu-pro", "llama"]

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

async function sakanaRequest(method, url, options = {}, retries = 3) {
  let lastError
  for (let i = 0; i < retries; i++) {
    try {
      const headers = {
        "User-Agent": randomUA(),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        ...(options.headers || {})
      }
      const response = await axios({ method, url, headers, timeout: 30000, maxRedirects: 5, ...options })
      return response
    } catch (error) {
      lastError = error
      if (error.response?.status === 403 || error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)))
        continue
      }
      throw error
    }
  }
  throw lastError
}

class SakanaAI {
  constructor() {
    this.cookie = null
  }

  async getCookie() {
    if (this.cookie) return this.cookie
    const signup = await sakanaRequest("POST", `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`, {
      data: { returnSecureToken: true, tenantId: "sakana-talk-prd-pvl72" }
    })
    const login = await sakanaRequest("POST", `${BASE}/api/auth/login`, {
      data: new URLSearchParams({ idToken: signup.data.idToken }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE, Referer: `${BASE}/` }
    })
    const cookieHeader = login.headers["set-cookie"] || []
    this.cookie = cookieHeader.find(c => c.startsWith("sakana-chat="))?.split(";")[0]
    if (!this.cookie) throw new Error("Failed to get session cookie")
    return this.cookie
  }

  cleanText(text) {
    return text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^-\s+/gm, "")
      .replace(/^\d+\.\s+/gm, "")
      .replace(/#{1,6}\s*/g, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  async chat(question, options = {}) {
    const {
      model = "namazu",
      conversationId = null,
      parentMessageId = null,
      needSearch = 0,
      thinking = 0,
      toneMode = "default"
    } = options

    if (!question) throw new Error("Question is required")
    if (thinking && needSearch) throw new Error("Thinking and Web Search cannot be used together")
    if (!MODELS.includes(model)) throw new Error(`Model not found. Available: ${MODELS.join(", ")}`)

    const cookie = await this.getCookie()
    let convId = conversationId
    let parentId = parentMessageId

    if (!convId) {
      const create = await sakanaRequest("POST", `${BASE}/conversation`, {
        data: {
          inputs: question,
          enableThinking: thinking === 1,
          toneMode,
          webSearchEnabled: needSearch === 1,
          agentId: model
        },
        headers: { Cookie: cookie, Origin: BASE, Referer: `${BASE}/` }
      })
      convId = create.data.conversationId
      parentId = create.data.systemMessageId
    }

    const fd = new FormData()
    fd.append("data", JSON.stringify({
      inputs: question,
      id: parentId,
      is_retry: false,
      is_continue: false,
      enableThinking: thinking === 1,
      toneMode,
      webSearchEnabled: needSearch === 1,
      userMessageId: crypto.randomUUID()
    }))

    const res = await sakanaRequest("POST", `${BASE}/conversation/${convId}`, {
      data: fd,
      headers: {
        Cookie: cookie,
        Origin: BASE,
        Referer: `${BASE}/`,
        "x-requested-with": "com.xbrowser.play",
        ...fd.getHeaders()
      },
      responseType: "stream"
    })

    return new Promise((resolve, reject) => {
      let fullText = ""
      let messageId = null
      let buf = ""

      res.data.on("data", chunk => {
        buf += chunk.toString("utf8")
        const lines = buf.split("\n")
        buf = lines.pop()
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed.type === "createdMessage") messageId = parsed.messageId
            if (parsed.type === "stream" && parsed.token) {
              fullText += parsed.token.replace(/\0/g, "")
            }
          } catch {}
        }
      })

      res.data.on("end", () => {
        const cleaned = this.cleanText(
          fullText
            .replace(/<plan>[\s\S]*?<\/plan>/g, "")
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .replace(/<source-chip[^>]*\/>/g, "")
            .replace(/<\/?[a-zA-Z0-9_-]+[^>]*>/g, "")
        )
        resolve({
          text: cleaned,
          conversationId: convId,
          parentMessageId: messageId
        })
      })

      res.data.on("error", reject)
    })
  }
}

export default {
  name: "Sakana AI",
  description: "Chat dengan Sakana AI (Namazu) — support web search, thinking mode, 5 model AI",
  category: "AI CHAT",
  methods: ["GET", "POST"],

  params: ["text", "model", "search", "thinking"],

  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan atau prompt untuk Sakana AI",
      example: "Apa itu AI?",
      minLength: 1,
      maxLength: 2000
    },
    model: {
      type: "string",
      required: true,
      enum: MODELS,
      default: "sakana",
      description: "Model AI yang digunakan"
    },
    search: {
      type: "string",
      required: true,
      enum: ["true", "false"],
      default: "false",
      description: "Aktifkan web search untuk informasi terkini"
    },
    thinking: {
      type: "string",
      required: true,
      enum: ["true", "false"],
      default: "false",
      description: "Tampilkan proses berpikir AI (tidak bisa bareng search)"
    }
  },

  async run(req, res) {
    try {
      const { text, model = "sakana", search: doSearch = "false", thinking: doThinking = "false" } = { ...req.query, ...req.body }

      if (!text) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'text' wajib diisi"
        })
      }

      if (typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Text must be a non-empty string"
        })
      }

      if (!MODELS.includes(model)) {
        return res.status(400).json({
          status: false,
          message: `Invalid model '${model}'. Available: ${MODELS.join(", ")}`
        })
      }

      if (!["true", "false"].includes(doSearch)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'search' must be 'true' or 'false'"
        })
      }

      if (!["true", "false"].includes(doThinking)) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'thinking' must be 'true' or 'false'"
        })
      }

      const needSearch = doSearch === "true" ? 1 : 0
      const isThinking = doThinking === "true" ? 1 : 0

      if (isThinking && needSearch) {
        return res.status(400).json({
          status: false,
          message: "Thinking and Web Search cannot be used together"
        })
      }

      logger.info(`[SAKANA] model=${model} search=${needSearch} thinking=${isThinking}`)

      const sakana = new SakanaAI()
      const startTime = Date.now()

      const result = await sakana.chat(text, {
        model: model,
        needSearch,
        thinking: isThinking
      })

      return res.json({
        status: true,
        result: {
          text: result.text,
          conversationId: result.conversationId,
          parentMessageId: result.parentMessageId,
        model,
          search: needSearch === 1,
          thinking: isThinking === 1
        },
        responseTime: `${Date.now() - startTime}ms`
      })
    } catch (error) {
      logger.error(`[SAKANA] ${error.message}`)
      return res.status(500).json({
        status: false,
        message: error.message || "Gagal memproses permintaan"
      })
    }
  }
}
