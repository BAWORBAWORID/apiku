import axios from 'axios'
import crypto from 'node:crypto'
import logger from "../../src/utils/logger.js"

const MAIL_PROVIDERS = ['https://api.mail.tm', 'https://api.mail.gw']

const availableModels = [
  "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini",
  "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3-flash-preview",
  "deepseek-chat", "deepseek-reasoner"
]

const visionModels = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3-flash-preview"]
const reasoningModels = ["deepseek-chat", "deepseek-reasoner"]

let TOKENS = []
let currentTokenIndex = 0
let accountCreationPromise = null
let selectedModel = "gpt-4o"
let showReasoning = true
let cliConversationId = `conv-${Date.now()}`

function fetchWithTimeout(resource, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(resource, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
}

async function createTempMailbox() {
  let lastError = null
  for (const baseUrl of ['https://api.mail.tm', 'https://api.mail.gw']) {
    try {
      const domainRes = await fetchWithTimeout(`${baseUrl}/domains`, {}, 10000)
      if (!domainRes.ok) continue
      const domainData = await domainRes.json()
      const members = domainData['hydra:member'] || []
      if (members.length === 0) continue
      const domain = members[0].domain
      const randomId = Math.random().toString(36).substring(2, 11)
      const address = `bot_${randomId}@${domain}`
      const password = "NotePassword123!"

      const accRes = await fetchWithTimeout(`${baseUrl}/accounts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password })
      }, 10000)
      if (!accRes.ok) continue

      const tokenRes = await fetchWithTimeout(`${baseUrl}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password })
      }, 10000)
      if (!tokenRes.ok) continue
      const tokenData = await tokenRes.json()
      if (tokenData.token) return { baseUrl, email: address, password, mailToken: tokenData.token }
    } catch (err) { lastError = err }
  }
  throw new Error(`Semua provider temporary mail gagal: ${lastError?.message || 'Unknown'}`)
}

async function pollVerificationToken(mailbox, maxRetries = 25, delayMs = 1500) {
  const { baseUrl, mailToken } = mailbox
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, delayMs))
    try {
      const listRes = await fetchWithTimeout(`${baseUrl}/messages`, { headers: { 'Authorization': `Bearer ${mailToken}` } }, 8000)
      if (!listRes.ok) continue
      const listData = await listRes.json()
      const messages = listData['hydra:member'] || []
      if (messages.length > 0) {
        const msgRes = await fetchWithTimeout(`${baseUrl}/messages/${messages[0].id}`, { headers: { 'Authorization': `Bearer ${mailToken}` } }, 8000)
        if (!msgRes.ok) continue
        const msgData = await msgRes.json()
        const content = (msgData.text || "") + " " + (Array.isArray(msgData.html) ? msgData.html.join("") : (msgData.html || ""))
        const match = content.match(/token=([a-zA-Z0-9_\-\.]+)/i)
        if (match) return match[1]
      }
    } catch (e) {}
  }
  return null
}

async function generateFreshNoteGPTToken() {
  if (accountCreationPromise) return await accountCreationPromise

  accountCreationPromise = (async () => {
    try {
      const mailbox = await createTempMailbox()
      const regRes = await fetchWithTimeout('https://notegpt.io/api/v1/auth/email/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://notegpt.io', 'Referer': 'https://notegpt.io/auth/register' },
        body: JSON.stringify({ email: mailbox.email, password: mailbox.password })
      }, 15000)
      const regJson = await regRes.json()
      if (regJson.code !== 100000 && regJson.code !== 0) throw new Error(`Registrasi NoteGPT ditolak: ${regJson.message || 'Unknown'}`)

      const confirmToken = await pollVerificationToken(mailbox)
      if (!confirmToken) throw new Error('Timeout: Email verifikasi tidak diterima')

      const confirmRes = await fetchWithTimeout('https://notegpt.io/api/v1/auth/email/register/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://notegpt.io', 'Referer': `https://notegpt.io/auth/register-confirm?token=${confirmToken}&email=${encodeURIComponent(mailbox.email)}&lang=en` },
        body: JSON.stringify({ token: confirmToken })
      }, 15000)
      const confirmJson = await confirmRes.json()
      if (confirmJson.code !== 100000 && confirmJson.code !== 0) throw new Error(`Konfirmasi gagal: ${confirmJson.message || 'Unknown'}`)

      const loginRes = await fetchWithTimeout('https://notegpt.io/api/v1/auth/email/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://notegpt.io', 'Referer': 'https://notegpt.io/auth/login' },
        body: JSON.stringify({ email: mailbox.email, password: mailbox.password })
      }, 15000)

      const loginJson = await loginRes.json()
      let ncToken = loginJson?.data?.access_token || loginJson?.data?.token
      if (!ncToken) {
        const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")]
        for (const sc of setCookies) {
          const m = sc?.match(/nc_token=([^;]+)/)
          if (m) { ncToken = m[1]; break }
        }
      }
      if (!ncToken) throw new Error('nc_token tidak ditemukan')
      TOKENS.push(ncToken)
      currentTokenIndex = TOKENS.length - 1
      return ncToken
    } finally { accountCreationPromise = null }
  })()
  return await accountCreationPromise
}

async function uploadToUguu(filePath) {
  if (!filePath) throw new Error("File path required")
  const fileBuffer = await (async () => {
    if (filePath.startsWith('http')) {
      const res = await axios.get(filePath, { responseType: 'arraybuffer', timeout: 30000 })
      return Buffer.from(res.data)
    }
    const fs = await import('node:fs/promises')
    return await fs.readFile(filePath)
  })()
  const fileName = path.basename(filePath)
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex')
  let body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  const response = await fetchWithTimeout('https://uguu.se/upload.php', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body }, 20000)
  if (!response.ok) throw new Error(`Upload gagal (HTTP ${response.status})`)
  const data = await response.json()
  if (data.success && data.files?.[0]?.url) return data.files[0].url
  throw new Error("Gagal mendapatkan URL gambar")
}

async function askNoteGPT(prompt, modelStr = "gpt-4o", retryCount = 0, imageUrl = null, convId = null) {
  if (TOKENS.length === 0) await generateFreshNoteGPTToken()
  const activeToken = TOKENS[currentTokenIndex]
  const targetConvId = convId || cliConversationId

  const payload = {
    message: prompt, language: "auto", model: modelStr, tone: "default", length: "moderate",
    conversation_id: convId || `conv-${Date.now()}`, image_urls: imageUrl ? [imageUrl] : [], chat_mode: "standard"
  }

  const response = await fetchWithTimeout('https://notegpt.io/api/v2/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `nc_token=${activeToken}`, 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://notegpt.io', 'Referer': 'https://notegpt.io/ai-chat', 'Accept': '*/*' },
    body: JSON.stringify(payload)
  }, 45000)

  if (!response.ok) return handleLimitOrError(prompt, modelStr, retryCount, `HTTP ${response.status}`, imageUrl, convId)

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let done = false, hasOutput = false, isExpired = false
  let fullText = "", fullReasoning = "", sseBuffer = ""

  while (!done) {
    const { value, done: readerDone } = await reader.read()
    done = readerDone
    if (value) {
      sseBuffer += decoder.decode(value, { stream: true })
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() || ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue
          try {
            const dataObj = JSON.parse(jsonStr)
            if (dataObj.code && [164002, 100001, 100020].includes(dataObj.code)) { isExpired = true; break }
            if (dataObj.reasoning) { fullReasoning += dataObj.reasoning; hasOutput = true }
            if (dataObj.text) { fullText += dataObj.text; hasOutput = true }
          } catch {}
        }
      }
    }
  }
  if (isExpired) return handleLimitOrError(prompt, modelStr, retryCount, "Token Kadaluarsa", null, convId)
  if (!hasOutput) return handleLimitOrError(prompt, modelStr, retryCount, "Limit/Output Kosong", null, convId)
  return { text: fullText, reasoning: fullReasoning, conversation_id: convId }
}

async function handleLimitOrError(prompt, modelStr, retryCount, reason, imageUrl, convId) {
  if (retryCount >= 3) throw new Error(`Max retries: ${reason}`)
  if (TOKENS.length > 0) { TOKENS.splice(currentTokenIndex, 1); if (currentTokenIndex >= TOKENS.length) currentTokenIndex = 0 }
  if (TOKENS.length > 0) return askNoteGPT(prompt, modelStr, retryCount + 1, imageUrl, convId)
  try {
    await generateFreshNoteGPTToken()
    return askNoteGPT(prompt, modelStr, retryCount + 1, imageUrl, convId)
  } catch (err) { throw new Error(`Gagal buat akun baru: ${err.message}`) }
}

export default {
  name: "NoteGPT AI Chat",
  description: "NoteGPT multi-model AI chat (gpt-4o, gemini, deepseek) dengan auto temp-mail auth, vision, reasoning, token pool rotation",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["message", "model", "image_url", "conversation_id"],
  paramsSchema: {
    message: { type: "string", required: true, description: "Pertanyaan/pesan untuk AI" },
    model: { type: "string", required: false, default: "gpt-4o", enum: ["gpt-4o-mini","gpt-4o","gpt-4.1-mini","gemini-3.1-flash-lite","gemini-2.5-flash","gemini-3-flash-preview","deepseek-chat","deepseek-reasoner"], description: "Model AI" },
    image_url: { type: "string", required: false, description: "URL gambar untuk vision (opsional)" },
    conversation_id: { type: "string", required: false, description: "ID percakapan untuk multi-turn (opsional)" }
  },
  async run(req, res) {
    try {
      const { message, model = "gpt-4o", image_url, conversation_id } = { ...req.query, ...req.body }
      if (!message) return res.status(400).json({ status: false, message: "Parameter 'message' wajib" })
      if (!availableModels.includes(model)) model = "gpt-4o"

      const result = await askNoteGPT(message, model, 0, image_url, conversation_id)
      return res.json({ status: true, result: { text: result.text, reasoning: result.reasoning, conversation_id: result.conversation_id } })
    } catch (err) {
      logger.error(`[NOTEGPT] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "NoteGPT request failed" })
    }
  }
}