import axios from 'axios'
import crypto from 'crypto'
import logger from "../../src/utils/logger.js"

const BASE_URL = "https://chat.qwen.ai/api/v2"
const HEADERS = {
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 15; 25028RN03A Build/AP3A.240905.015.A2) AliApp(QWENCHAT/2.5.1) AppType/Release AplusBridgeLite,Dalvik/2.1.0 (Linux; U; Android 15; 25028RN03A Build/AP3A.240905.015.A2)',
  'Connection': 'Keep-Alive',
  'Accept': 'application/json',
  'X-Platform': 'android',
  'source': 'app',
  'Accept-Language': 'en-US',
  'Accept-Charset': 'UTF-8',
  'Cache-Control': 'no-store',
  'app_waf': 'Z9Tr56YmQpXcO2K_d_3nAbJvRqMLFW8HTNjvRguWHEowM1xY'
}

const CREDENTIALS = {
  email: process.env.QWEN_EMAIL || '',
  password: process.env.QWEN_PASSWORD || ''
}

let cookieJar = ''
let sharedToken = null
let sharedInitDone = false

function uuid() { return crypto.randomUUID() }
function md5(s) { return crypto.createHash('md5').update(s).digest('hex') }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex') }
function deviceId() { return 'ai' + md5(uuid()) }

function getHeaders(token, extra = {}) {
  const headers = { ...HEADERS, 'x-request-id': uuid(), 'x-device-id': deviceId(), ...extra }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (cookieJar) headers['Cookie'] = cookieJar
  return headers
}

function updateCookies(response) {
  const setCookie = response.headers['set-cookie']
  if (!setCookie) return
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie]).map(c => c.split(';')[0])
  const existing = cookieJar ? cookieJar.split('; ').filter(Boolean) : []
  const all = [...existing]
  for (const p of cookies) {
    const key = p.split('=')[0]
    const idx = all.findIndex(c => c.split('=')[0] === key)
    if (idx >= 0) all[idx] = p
    else all.push(p)
  }
  cookieJar = all.join('; ')
}

function parseSSE(chunk) {
  const lines = chunk.toString().split('\n')
  const events = []
  let currentEvent = { event: 'message', data: '' }
  for (const line of lines) {
    if (line.startsWith('event:')) {
      if (currentEvent.data) events.push({ ...currentEvent })
      currentEvent = { event: line.substring(6).trim(), data: '' }
    } else if (line.startsWith('data:')) {
      currentEvent.data += line.substring(5).trim()
    } else if (line === '' && currentEvent.data) {
      events.push({ ...currentEvent })
      currentEvent = { event: 'message', data: '' }
    }
  }
  if (currentEvent.data) events.push(currentEvent)
  return events
}

async function login(email, password) {
  try {
    const hashedPassword = sha256(password)
    const response = await axios.post(`${BASE_URL}/auths/signin`,
      { email, password: hashedPassword },
      { headers: getHeaders(null, { 'x-request-id': uuid() }) }
    )
    updateCookies(response)
    if (!response.data.success) throw new Error("Login failed")
    return { token: response.data.data.token, user: response.data.data }
  } catch (error) {
    return { error: error.message }
  }
}

async function createSession(token) {
  try {
    const response = await axios.post(`${BASE_URL}/chats/new`,
      { chat_mode: "normal", project_id: "" },
      { headers: getHeaders(token) }
    )
    updateCookies(response)
    if (!response.data.success) throw new Error('Failed to create session')
    return response.data.data.id
  } catch (error) {
    return null
  }
}

function chat(token, chatId, prompt, options = {}) {
  const model = options.model || "qwen3.7-plus"
  const payload = {
    stream: true,
    incremental_output: true,
    chat_id: chatId,
    chat_mode: "normal",
    model,
    version: "2.1",
    messages: [{
      chat_type: "t2t",
      content: prompt,
      role: "user",
      feature_config: {
        output_schema: "phase",
        thinking_enabled: options.thinkingEnabled !== false,
        thinking_format: "summary",
        auto_thinking: true,
        auto_search: options.searchEnabled !== false
      },
      timestamp: Math.floor(Date.now() / 1000),
      sub_chat_type: "t2t",
      models: [model],
      user_action: "chat",
      extra: { meta: { subChatType: "t2t" } }
    }],
    timestamp: Math.floor(Date.now() / 1000),
    share_id: "",
    origin_branch_message_id: ""
  }

  return axios.post(`${BASE_URL}/chat/completions?chat_id=${chatId}`, payload, {
    headers: getHeaders(token, {
      'Accept': '*/*,text/event-stream',
      'Content-Type': 'application/json; charset=UTF-8'
    }),
    responseType: 'stream',
    maxBodyLength: Infinity
  }).then(response => new Promise((resolve, reject) => {
    let fullText = '', thoughtText = '', searchResults = [], buffer = '', printedThoughts = 0

    response.data.on('data', chunk => {
      buffer += chunk.toString()
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const part of parts) {
        for (const event of parseSSE(part + '\n\n')) {
          if (!event.data || event.data === ':') continue
          try {
            const parsed = JSON.parse(event.data)
            if (parsed['response.created'] || !parsed.choices?.length) continue
            const delta = parsed.choices[0].delta
            if (!delta) continue

            if (delta.phase === 'thinking_summary' && delta.extra?.summary_thought?.content) {
              const thoughts = delta.extra.summary_thought.content
              for (let i = printedThoughts; i < thoughts.length; i++) thoughtText += thoughts[i] + '\n'
              printedThoughts = thoughts.length
            }
            if ((delta.phase === 'image_search' || delta.phase === 'search') && delta.extra?.search_result) {
              searchResults = delta.extra.search_result
            }
            if (delta.phase === 'answer' && delta.content) fullText += delta.content
          } catch {}
        }
      }
    })

    response.data.on('end', () => resolve({
      status: 'success',
      thinking: thoughtText.trim(),
      search_results: searchResults,
      response: fullText.trim()
    }))

    response.data.on('error', err => resolve({ status: 'error', message: err.message }))
  })).catch(error => ({ status: 'error', message: error.message }))
}

async function initShared() {
  if (sharedInitDone) return
  sharedInitDone = true
  logger.info('[QwenV2] Auto-login...')
  const auth = await login(CREDENTIALS.email, CREDENTIALS.password)
  if (auth.token) {
    sharedToken = auth.token
    logger.ready('[QwenV2] Auto-login success')
  } else {
    logger.warn(`[QwenV2] Auto-login gagal: ${auth.error}`)
  }
}

initShared()

export default {
  name: "Qwen V2",
  description: "Qwen AI Chat V2 (Android API) — support streaming, thinking, web search. Auto-login with default account.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "model", "stream", "thinking", "search"],

  paramsSchema: {
    text: {
      type: "string", required: true,
      description: "Pesan teks yang akan dikirim ke Qwen AI",
      example: "Halo, apa kabar?", minLength: 1, maxLength: 2000
    },
    model: {
      type: "string", required: true,
      default: "qwen3.7-plus",
      description: "Model yang digunakan",
      enum: ["qwen3.7-plus", "qwen3-235b", "qwen2.5-72b", "qwen2.5-coder", "qwen-max"]
    },
    stream: {
      type: "string", required: false, default: "false",
      enum: ["true", "false"],
      description: "Aktifkan streaming response"
    },
    thinking: {
      type: "string", required: false, default: "true",
      enum: ["true", "false"],
      description: "Aktifkan thinking mode"
    },
    search: {
      type: "string", required: false, default: "true",
      enum: ["true", "false"],
      description: "Aktifkan auto search"
    }
  },

  async run(req, res) {
    try {
      const p = { ...req.query, ...req.body }
      const text = p.text
      const model = p.model || 'qwen3.7-plus'
      const thinking = p.thinking || 'true'
      const doSearch = p.search || 'true'

      if (!text || !text.trim()) {
        return res.status(400).json({ status: false, error: "Parameter 'text' wajib diisi" })
      }

      if (!sharedToken) {
        return res.status(500).json({ status: false, error: "Auto-login belum selesai, coba lagi" })
      }

      const chatId = await createSession(sharedToken)
      if (!chatId) {
        return res.status(500).json({ status: false, error: "Gagal membuat session" })
      }

      const result = await chat(sharedToken, chatId, text, {
        model,
        thinkingEnabled: thinking === 'true',
        searchEnabled: doSearch === 'true'
      })

      if (result.status === 'error') {
        return res.status(500).json({ status: false, error: result.message })
      }

      return res.json({
        status: true,
        model,
        response: result.response,
        thinking: result.thinking,
        search_results: result.search_results,
        chatId
      })
    } catch (err) {
      return res.status(500).json({
        status: false,
        error: err.message || "Failed to chat with Qwen V2"
      })
    }
  }
}
