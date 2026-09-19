/**
 * Manus AI Chat
 * Provider: manus.im (socket.io WebSocket)
 * Parameter: text
 * NO API KEY (static session token)
 */

import { io } from "socket.io-client"

const wasm_url = "https://raw.githubusercontent.com/ren-offc/loader_wasm/main/manus_loader.wasm"
const client_id = "oitz7WwqVCkJkAlQYxdxXY"
const SESSION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6ImZhenphZmFiaWFuYWhtYWQwOUBnbWFpbC5jb20iLCJleHAiOjE3OTY2MTE0OTUsImlhdCI6MTc4ODgzNTQ5NSwianRpIjoiZ0ZzOFRYa1BTOTlLM1ZaOGdmUmVIVCIsIm5hbWUiOiJGYXp6YSBmYWJpYW4gQWhtYWQiLCJvcmlnaW5hbF91c2VyX2lkIjoiIiwidGVhbV91aWQiOiIiLCJ0eXBlIjoidXNlciIsInVzZXJfaWQiOiIzMTA1MTk2NjM5NDc2OTM0MTgifQ.Dbqrrw_wu2-ayrGERItXlvmnwfPeGIyITtBbn7YodTk"

let _instPromise = null

async function init_wasm() {
  if (!_instPromise) {
    _instPromise = (async () => {
      const { instance } = await WebAssembly.instantiate(await (await fetch(wasm_url)).arrayBuffer())
      return instance
    })()
  }
  return _instPromise.then((i) => {
    if (!i) throw new Error("wasm init failed")
    return i
  })
}

function g(inst, key) {
  const m = new Uint8Array(inst.exports.memory.buffer)
  const ptr = inst.exports[key]()
  const size = (m[ptr] << 8) | m[ptr + 1]
  const xk = m[ptr + 2]
  let s = ""
  for (let i = 0; i < size; i++) s += String.fromCharCode(m[ptr + 3 + i] ^ xk)
  return s
}

function gen_id() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: 22 }, () => c[Math.floor(Math.random() * c.length)]).join("")
}

function chat(token, sid, msg, maxMs = 120000) {
  return new Promise((resolve) => {
    let reply = ""
    let settled = false
    const done = (final) => {
      if (settled) return
      settled = true
      try { s.disconnect() } catch {}
      resolve(final)
    }

    const s = io("wss://api.manus.im", {
      auth: { token },
      transports: ["websocket"],
      extraHeaders: { Authorization: "Bearer " + token, Origin: "https://manus.im" },
      reconnection: false,
    })

    s.on("connect", () => {
      s.emit("message", {
        id: gen_id(),
        type: "join_session",
        sessionId: sid,
        lastMessageId: "new_session",
        version: 2,
      })
      setTimeout(() => {
        s.emit("message", {
          id: gen_id(),
          messageStatus: "pending",
          type: "user_message",
          timestamp: Date.now(),
          sessionId: sid,
          content: msg,
          contents: [{ type: "text", value: msg }],
          messageType: "text",
          taskMode: "standard",
          attachments: [],
          extData: {},
          quoteContents: null,
          scheduleTask: false,
          countryIsoCode: "ID",
        })
      }, 1500)
    })
    s.on("message", (d) => {
      if (d && d.type === "event" && d.event && d.event.type === "chat" && d.event.sender === "assistant") {
        reply += d.event.content || ""
      }
      if (d && d.type === "event" && (d.event?.type === "done" || d.event?.type === "session_done" || d.event?.type === "session_finished")) {
        done(reply)
      }
      if (d && (d.type === "response_done" || d.type === "done" || d.type === "finish")) {
        done(reply)
      }
    })
    s.on("disconnect", () => done(reply))
    s.on("connect_error", (e) => done({ __error: e.message }))
    s.on("error", (e) => done({ __error: e.message }))
    setTimeout(() => done(reply), maxMs)
  })
}

export default {
  name: "Manus AI Chat",
  description: "Manus AI WebSocket - Session token statis",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk Manus AI",
      example: "halo, kenalan yuk!",
      minLength: 1,
      maxLength: 5000,
    },
  },
  async run(req, res) {
    const { text } = { ...req.query, ...req.body }
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" })
    }

    try {
      const inst = await init_wasm()
      const base = g(inst, "a4344")
      if (!base) throw new Error("Gagal load loader wasm")

      const sid = gen_id()
      const reply = await chat(SESSION_TOKEN, sid, text.trim(), 60000)
      if (reply && reply.__error) {
        return res.status(502).json({ status: false, message: "Manus connection error: " + reply.__error })
      }
      if (!reply || !reply.trim()) {
        return res.status(504).json({ status: false, message: "No response from Manus (timeout)" })
      }

      return res.json({ status: true, result: { reply, session_id: sid } })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.message || String(err) })
    }
  },
}