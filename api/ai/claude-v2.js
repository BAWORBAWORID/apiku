/**
 * Claude V2 - Direct claude.ai API
 * Models: claude-sonnet-4-6, claude-opus-4-7
 * Source: https://github.com/XBotzLauncher/scrape/blob/main/lib/claude.js
 * Requires: cookie + orgId from claude.ai session
 */

import { randomUUID } from "crypto"

const BASE_URL = "https://claude.ai"

const DEFAULT_HEADERS = {
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "anthropic-client-platform": "web_claude_ai",
  "anthropic-client-version": "1.0.0",
  "content-type": "application/json",
  origin: "https://claude.ai",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
}

/* ===============================
   SSE STREAM PARSER
================================ */
async function parseSSE(res) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let fullText = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === "[DONE]") continue

      let evt
      try {
        evt = JSON.parse(raw)
      } catch {
        continue
      }

      if (
        evt.type === "content_block_delta" &&
        evt.delta?.type === "text_delta"
      ) {
        fullText += evt.delta.text || ""
      }

      if (evt.type === "error") {
        throw new Error(`Claude error: ${JSON.stringify(evt.error)}`)
      }
    }
  }

  return fullText
}

/* ===============================
   CLAUDE CLIENT
================================ */
class ClaudeClient {
  constructor({ cookie, orgId, model = "claude-sonnet-4-6", deviceId }) {
    if (!cookie) throw new Error("cookie wajib diisi")
    if (!orgId) throw new Error("orgId wajib diisi")

    this.cookie = cookie
    this.orgId = orgId
    this.model = model
    this.deviceId = deviceId || randomUUID()
  }

  #headers(extra = {}) {
    return {
      ...DEFAULT_HEADERS,
      cookie: this.cookie,
      "anthropic-device-id": this.deviceId,
      ...extra,
    }
  }

  async createConversation() {
    const res = await fetch(
      `${BASE_URL}/api/organizations/${this.orgId}/chat_conversations`,
      {
        method: "POST",
        headers: this.#headers({ accept: "application/json" }),
        body: JSON.stringify({ name: "", model: this.model }),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      throw new Error(
        `createConversation → ${res.status}: ${err.slice(0, 200)}`
      )
    }
    const data = await res.json()
    return data.uuid
  }

  async sendMessage(conversationId, prompt) {
    const humanUUID = randomUUID()
    const assistantUUID = randomUUID()

    const body = {
      prompt,
      timezone: "Asia/Jakarta",
      locale: "id-ID",
      model: this.model,
      personalized_styles: [
        {
          type: "default",
          key: "Default",
          name: "Normal",
          nameKey: "normal_style_name",
          prompt: "Normal\n",
          summary: "Default responses from Claude",
          summaryKey: "normal_style_summary",
          isDefault: true,
        },
      ],
      tools: [
        { type: "web_search_v0", name: "web_search" },
        { type: "artifacts_v0", name: "artifacts" },
        { type: "repl_v0", name: "repl" },
      ],
      turn_message_uuids: {
        human_message_uuid: humanUUID,
        assistant_message_uuid: assistantUUID,
      },
      attachments: [],
      files: [],
      sync_sources: [],
      rendering_mode: "messages",
    }

    const res = await fetch(
      `${BASE_URL}/api/organizations/${this.orgId}/chat_conversations/${conversationId}/completion`,
      {
        method: "POST",
        headers: this.#headers({
          accept: "text/event-stream",
          referer: `${BASE_URL}/chat/${conversationId}`,
        }),
        body: JSON.stringify(body),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`sendMessage → ${res.status}: ${err.slice(0, 300)}`)
    }

    const text = await parseSSE(res)
    return { text, assistantUUID }
  }

  async chat(prompt) {
    const conversationId = await this.createConversation()
    const { text, assistantUUID } = await this.sendMessage(
      conversationId,
      prompt
    )
    return { conversationId, text, assistantUUID }
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "Claude V2",
  description:
    "Claude AI — Sonnet 4.6 & Opus 4.7 (requires session cookie)",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks", "model", "cookie", "orgId"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk Claude",
    },
    model: {
      type: "string",
      required: true,
      default: "claude-sonnet-4-6",
      enum: ["claude-sonnet-4-6", "claude-opus-4-7"],
      description: "Model Claude yang digunakan",
    },
    cookie: {
      type: "string",
      required: true,
      description:
        "Session cookie dari claude.ai (ambil dari browser DevTools → Application → Cookies)",
    },
    orgId: {
      type: "string",
      required: true,
      description:
        "Organization ID dari claude.ai (ambil dari URL: claude.ai/org/xxx atau Network tab)",
    },
  },

  async run(req, res) {
    try {
      const params =
        req.method === "POST" ? req.body || {} : req.query || {}
      const { teks, model, cookie, orgId } = params

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi",
        })
      }

      if (!cookie) {
        return res.status(400).json({
          status: false,
          message:
            "Parameter 'cookie' wajib diisi — ambil dari browser DevTools → Application → Cookies di claude.ai",
        })
      }

      if (!orgId) {
        return res.status(400).json({
          status: false,
          message:
            "Parameter 'orgId' wajib diisi — ambil dari URL claude.ai/org/xxx atau dari Network tab",
        })
      }

      const selectedModel = model || "claude-sonnet-4-6"
      const validModels = ["claude-sonnet-4-6", "claude-opus-4-7"]
      if (!validModels.includes(selectedModel)) {
        return res.status(400).json({
          status: false,
          message: `Model tidak valid. Pilihan: ${validModels.join(", ")}`,
        })
      }

      const client = new ClaudeClient({
        cookie,
        orgId,
        model: selectedModel,
      })

      const result = await client.chat(teks.trim())

      res.json({
        status: true,
        model: selectedModel,
        result: result.text || "No response generated",
        conversation_id: result.conversationId,
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Claude request failed",
      })
    }
  },
}
