/**
 * Apodex AI Endpoint — Full SDK wrapper for Apodex.ai (Self-contained, no imports)
 * 72+ endpoints: chat, auth, upload, library, memory, history, org, vip, asr, feedback
 * Auto-fresh account via TempMail (justlann) — no headless, no imports
 * Auto-init session saved to data/apodex.json
 */

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import logger from "../../src/utils/logger.js"

const BASE = 'https://www.apodex.ai'
const AKUNLAMA_DOMAIN = 'akunlama.com'
const ADJECTIVES = ["happy","sleepy","clever","swift","brave","calm","wild","gentle","lucky","proud","cozy","fuzzy"]
const ANIMALS = ["kitten","cat","tiger","lion","panther","cheetah","lynx","puma","jaguar","leopard"]
function genName(){ const adj=ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]; const animal=ANIMALS[Math.floor(Math.random()*ANIMALS.length)]; const num=Math.floor(Math.random()*900)+100; return `${adj}-${animal}-${num}-${Date.now().toString(36).slice(-4)}` }
const DEFAULT_DEVICE_ID = '01a04765-c7fb-74ca-a840-cd562144e213'
const ACCOUNT_FILE = path.join(process.cwd(), 'data', 'apodex.json')
const ACCOUNT_TTL_MS = 24 * 3600000 // regenerasi akun/cookie setiap 24 jam

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/event-stream, */*',
  'Origin': BASE,
  'Referer': BASE,
}

function genUUID() { return crypto.randomUUID() }
function buildQuery(params) {
  if (!params) return ''
  const o = {}
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) o[k] = String(v)
  return new URLSearchParams(o).toString()
}
function createMultipart(fields, files) {
  const boundary = '----ApodexFormBoundary' + crypto.randomBytes(12).toString('hex')
  const parts = []
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined) continue
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  for (const f of files || []) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType || 'application/octet-stream'}\r\n\r\n`))
    parts.push(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data))
    parts.push(Buffer.from(`\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), boundary }
}

function getAxiosConfig(extra = {}) {
  return { headers: { ...DEFAULT_HEADERS, ...extra }, timeout: 30000 }
}

// ===== akunlama TempMail helpers (fix: justlann timeout, pakai akunlama.com) =====
async function pollAkunlama(recipient, maxTries=12){
  for(let i=0;i<maxTries;i++){
    const r=await fetch(`https://akunlama.com/api/list?recipient=${encodeURIComponent(recipient)}`)
    const list=await r.json()
    if(Array.isArray(list)&&list.length>0) return list
    await new Promise(r=>setTimeout(r,5000))
  }
  throw new Error('Inbox kosong akunlama '+recipient)
}
async function getOtpAkunlama(recipient){
  const list=await pollAkunlama(recipient)
  const first=list[0]; const key=first.storage?.key, region=first.storage?.region||'us'
  const htmlRes=await fetch(`https://akunlama.com/api/getHtml?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`)
  const html=await htmlRes.text()
  let m=html.match(/\b(\d{6})\b/)
  if(m) return m[1]
  throw new Error('OTP not found')
}

async function sendApodexCode(email, deviceID) {
  const res = await axios.post(`${BASE}/api/auth/passwordless/send-code`, { email }, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'deviceType': '7', 'deviceID': deviceID },
    timeout: 30000
  })
  if (res.status !== 200) throw new Error(`send-code failed ${res.status}: ${JSON.stringify(res.data).slice(0,600)}`)
  const cookieHeader = res.headers['set-cookie']
  let session = null
  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join(';') : (cookieHeader || '')
  const m = cookieStr.match(/session=([^;]+)/)
  if (m) session = `session=${m[1]}`
  return { body: res.data, cookie: session, headers: res.headers }
}

async function verifyApodexCode(email, code, deviceID, sessionCookie) {
  const res = await axios.post(`${BASE}/api/auth/passwordless/verify-login`, { email, code }, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'deviceType': '7', 'deviceID': deviceID, 'Cookie': sessionCookie },
    timeout: 30000
  })
  if (res.status !== 200) throw new Error(`verify-login failed ${res.status}: ${JSON.stringify(res.data).slice(0,800)}`)
  const token = res.data?.data?.access_token || res.data?.access_token
  const cookieHeader = res.headers['set-cookie']
  let session = sessionCookie
  const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join(';') : (cookieHeader || '')
  const m = cookieStr.match(/session=([^;]+)/)
  if (m) session = `session=${m[1]}`
  return { body: res.data, token, cookie: session, user: res.data?.data?.user, isNewUser: res.data?.data?.is_new_user }
}

async function waitForOtp(email, { timeoutMs = 60000, intervalMs = 2500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const inbox = await checkInbox(email)
      // justlann inbox may return OTP directly: {data:{otp, body, total_messages}}
      if (inbox?.data?.otp && /^\d{4,8}$/.test(inbox.data.otp)) {
        return { otp: inbox.data.otp, source: 'inbox.otp', inbox }
      }
      const msgs = inbox?.data?.messages || inbox?.data?.inbox || []
      if (Array.isArray(msgs) && msgs.length) {
        for (const msg of msgs) {
          const id = msg.id || msg._id || msg.uid
          if (id) {
            try {
              const detail = await readMessage(email, id)
              const body = detail?.data?.body || detail?.data?.text || JSON.stringify(detail)
              const m2 = body.match(/\b(\d{6})\b/)
              if (m2) return { otp: m2[1], source: 'message:'+id, inbox: detail }
              if (detail?.data?.otp) return { otp: detail.data.otp, source: 'message.otp', inbox: detail }
            } catch {}
          }
          const txt = JSON.stringify(msg)
          const mm = txt.match(/\b(\d{6})\b/)
          if (mm) return { otp: mm[1], source: 'messages', inbox }
        }
      }
      const otpRes = await extractOtp(email)
      if (otpRes?.data?.otp) return { otp: otpRes.data.otp, source: 'otp', inbox: otpRes }
      const linkRes = await extractLink(email)
      if (linkRes?.data?.otp) return { otp: linkRes.data.otp, source: 'link', inbox: linkRes }
      const body = inbox?.data?.body || inbox?.data?.text || ''
      const m = body.match(/\b(\d{6})\b/)
      if (m) return { otp: m[1], source: 'body-regex', inbox }
    } catch (e) {}
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`Timeout waiting OTP for ${email} after ${timeoutMs}ms`)
}

async function createFreshAccount(options = {}) {
  const deviceID = options.deviceID || crypto.randomUUID()
  const verbose = options.verbose !== false
  const username = genName()
  const email = `${username}@${AKUNLAMA_DOMAIN}`
  if (verbose) logger.info(`[Apodex] Akunlama: ${email}`)
  if (verbose) logger.info('[Apodex] Sending Apodex OTP code...')
  const send = await sendApodexCode(email, deviceID)
  let sessionCookie = send.cookie
  if (verbose) logger.info(`[Apodex] send-code OK: ${send.body.message} | session=${sessionCookie}`)
  if (verbose) logger.info('[Apodex] Polling akunlama for OTP (max 60s)...')
  const otp = await getOtpAkunlama(username)
  if (verbose) logger.info(`[Apodex] OTP found: ${otp}`)
  if (verbose) logger.info('[Apodex] Verifying OTP with Apodex...')
  const verify = await verifyApodexCode(email, otp, deviceID, sessionCookie)
  if (!verify.token) throw new Error('No access_token in verify response: ' + JSON.stringify(verify.body).slice(0,600))
  if (verbose) logger.info(`[Apodex] Verify OK: user=${verify.user?.id} new=${verify.isNewUser} token=${verify.token.slice(0,20)}...`)
  const guest_id = 'guest_' + crypto.randomBytes(6).toString('hex')
  const fullCookie = [`guest_id=${guest_id}`,'apx-signed-in=1',verify.cookie].filter(Boolean).join('; ')
  const result = {
    email, username, domain: AKUNLAMA_DOMAIN, otp, token: verify.token, sessionCookie: verify.cookie, fullCookie, deviceID, guest_id, user: verify.user, isNewUser: verify.isNewUser, raw: verify.body, createdAt: new Date().toISOString()
  }
  if (options.saveTo) {
    fs.writeFileSync(options.saveTo, JSON.stringify(result, null, 2), 'utf8')
    if (verbose) logger.info(`[Apodex] Saved to ${options.saveTo}`)
  }
  return result
}

// ===== ApodexClient Class =====
class ApodexClient {
  constructor(options = {}) {
    this.baseHostname = 'www.apodex.ai'
    this.basePath = '/api'
    this.cookie = options.cookie || ''
    this.token = options.token || null
    this.deviceID = options.deviceID || crypto.randomUUID()
    this.deviceType = options.deviceType || '7'
    this.userAgent = options.userAgent || DEFAULT_HEADERS['User-Agent']
    this.timeoutMs = options.timeoutMs || 30000
    this.autoRefresh = options.autoRefresh || false
    this.autoRefreshOptions = options.autoRefreshOptions || {}
    this._refreshing = null
  }

  setToken(t) { this.token = t }
  setCookie(c) { this.cookie = c }
  setDeviceID(d) { this.deviceID = d }

  _headers(extra = {}, requireAuth = true) {
    const h = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json, text/event-stream, */*',
      'deviceType': this.deviceType,
      'deviceID': this.deviceID,
      ...extra
    }
    if (this.cookie) h['Cookie'] = this.cookie
    if (requireAuth && this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  async _doAutoRefresh() {
    if (this._refreshing) return this._refreshing
    this._refreshing = (async () => {
      logger.info('[AUTO] Cookie/token expired or limit reached -> generate fresh via TempMail (no headless)...')
      const account = await createFreshAccount({
        deviceID: this.deviceID,
        verbose: this.autoRefreshOptions.verbose || false,
        timeoutMs: this.autoRefreshOptions.timeoutMs || 60000,
        saveTo: this.autoRefreshOptions.saveTo,
        domain: this.autoRefreshOptions.domain,
      })
      this.token = account.token
      this.cookie = account.fullCookie
      this.deviceID = account.deviceID
      this._account = account
      logger.info(`[AUTO] Fresh account: ${account.email} | token ${account.token.slice(0,12)}...`)
      return account
    })()
    try { return await this._refreshing } finally { this._refreshing = null }
  }

  async _request(endpoint, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase()
    const requireAuth = opts.requireAuth !== undefined ? opts.requireAuth : true
    const params = opts.params
    const body = opts.body
    const extraHeaders = opts.headers || {}
    const timeoutMs = opts.timeoutMs || this.timeoutMs
    const isFormData = opts.isFormData
    const _attempt = opts._attempt || 0

    const fullPath = this.basePath + endpoint + buildQuery(params)
    const headers = this._headers(extraHeaders, requireAuth)
    
    let payload = null
    if (body !== undefined && body !== null && method !== 'GET') {
      if (isFormData) {
        const mp = createMultipart(body.fields, body.files)
        payload = mp.body
        headers['Content-Type'] = `multipart/form-data; boundary=${mp.boundary}`
        headers['Content-Length'] = payload.length
      } else if (Buffer.isBuffer(body) || typeof body === 'string') {
        payload = Buffer.isBuffer(body) ? body : Buffer.from(body)
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/octet-stream'
        headers['Content-Length'] = payload.length
      } else {
        const json = JSON.stringify(body)
        payload = Buffer.from(json)
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = payload.length
      }
    } else {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
    }

    const doRequest = async () => {
      const url = BASE + this.basePath + endpoint + buildQuery(params)
      const config = { method, url, headers, timeout: 30000 }
      // Only attach a body when one actually exists. Passing data:null makes axios
      // send a GET with Content-Length 4 + body "null" (CloudFront rejects it as 403 Bad request)
      if (payload !== null && payload !== undefined) config.data = payload
      return axios.request(config)
    }

    try {
      const res = await doRequest()
      const parsed = res.data
      if (!res.status || res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data).slice(0,500)}`)
      }
      if (parsed && typeof parsed === 'object' && parsed.success === true && 'data' in parsed) {
        return parsed.data
      }
      if (parsed && typeof parsed === 'object' && parsed.success === false) {
        throw new Error(`${parsed.message || 'API error'} (code: ${parsed.code})`)
      }
      return parsed
    } catch (err) {
      if (this.autoRefresh && _attempt === 0 && this._isRetryableError(err)) {
        try {
          await this._doAutoRefresh()
          return await this._request(endpoint, { ...opts, _attempt: 1 })
        } catch (refreshErr) {
          throw new Error(`${err.message} | auto-refresh failed: ${refreshErr.message}`)
        }
      }
      throw err
    }
  }

  _isRetryableError(err) {
    if (!err) return false
    const code = String(err.code || err.response?.data?.code || err.response?.data?.data?.code || '')
    const httpStatus = err.response?.status || err.status
    const msg = String(err.message || '')
    if (code === 'HEAVY_ACCESS_DENIED' || /HEAVY_ACCESS_DENIED/i.test(msg)) return false
    if (httpStatus === 401) return true
    if (/UNAUTHORIZED|TOKEN_EXPIRED|SESSION_EXPIRED|AUTH_REQUIRED|ORG_CONTEXT_INVALID|AUTHENTICATION_REQUIRED/i.test(code)) return true
    if (/Authorization header missing|Unauthorized|session.*expired|token.*expired|login required|not authenticated/i.test(String(err.message))) return true
    if (httpStatus === 429) {
      if (/PASSWORDLESS_SEND_RATE_LIMITED/i.test(code) || /PASSWORDLESS_SEND_RATE_LIMITED/i.test(String(err.message))) return false
      return true
    }
    if (/LIMIT_EXCEEDED|EXHAUSTED|TRIAL_ENDED|TRIAL_USED|QUOTA_EXCEEDED|USAGE_LIMIT/i.test(code)) return true
    if (/rate limit|limit exceeded|trial.*used up|usage limit|quota exceeded|exceeded daily/i.test(msg)) return true
    return false
  }

  get(ep, opts) { return this._request(ep, { ...opts, method: 'GET' }) }
  post(ep, body, opts) { return this._request(ep, { ...opts, method: 'POST', body }) }
  put(ep, body, opts) { return this._request(ep, { ...opts, method: 'PUT', body }) }
  patch(ep, body, opts) { return this._request(ep, { ...opts, method: 'PATCH', body }) }
  del(ep, opts) { return this._request(ep, { ...opts, method: 'DELETE' }) }

  // --- Chat ---
  chat = {
    stream: async (prompt, options = {}) => {
      const chatId = options.chatId || crypto.randomUUID()
      const messageId = options.messageId || crypto.randomUUID()
      const modeMap = { standard: 'standard', pro: 'pro', heavy: 'agent-swarm-gv', 'agent-swarm': 'agent-swarm', 'agent-swarm-gv': 'agent-swarm-gv' }
      const apiMode = modeMap[options.mode || 'standard'] || 'standard'
      const version = options.version || '1.1'

      const payloadObj = {
        messages: [{ role: 'user', content: prompt }],
        chat_id: chatId,
        message_id: messageId,
        mode: apiMode,
        version: version,
      }
      if (options.files && options.files.length) payloadObj.files = options.files
      if (options.file_ids && options.file_ids.length) payloadObj.file_ids = options.file_ids
      if (options.libraryItems) payloadObj.library_items = options.libraryItems
      if (options.sceneId) payloadObj.scene_id = options.sceneId
      if (options.useMemory !== undefined) payloadObj.use_memory = options.useMemory
      if (options.extra) Object.assign(payloadObj, options.extra)

      const payload = JSON.stringify(payloadObj)
      const baseHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json, text/plain, */*',
        'Origin': BASE,
        'Referer': `${BASE}/chat/${chatId}`,
        'Content-Length': Buffer.byteLength(payload)
      }
      if (this.token) baseHeaders['Authorization'] = `Bearer ${this.token}`
      const headers = this._headers(baseHeaders, false)

      return new Promise((resolve, reject) => {
        const url = BASE + '/api/chat/stream'
        const req = axios.post(url, payload, { headers, responseType: 'stream', timeout: 180000, validateStatus: () => true })
        
        req.then(res => {
          if (res.status !== 200) {
            reject(new Error(`chat/stream HTTP ${res.status}`))
            return
          }
          let buffer = ''
          let finalAnswer = ''
          let assembled = ''
          
          res.data.on('data', (chunk) => {
            buffer += chunk.toString()
            const parts = buffer.split('\n')
            buffer = parts.pop()
            let pendingEvent = null
            for (let i = 0; i < parts.length; i++) {
              const line = parts[i].trim()
              if (!line) { pendingEvent = null; continue }
              if (line.startsWith('event:')) pendingEvent = line.slice(6).trim()
              else if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim()
                if (dataStr === '[DONE]') continue
                try {
                  const parsed = JSON.parse(dataStr)
                  if (pendingEvent === 'final_answer' && parsed.content) finalAnswer = parsed.content
                  else if (pendingEvent === 'message' && parsed.delta?.content) {
                    assembled += parsed.delta.content
                    if (options.onDelta) options.onDelta(parsed.delta.content, parsed)
                  } else if (pendingEvent === 'end_of_agent' && parsed.run_result?.final_content) {
                    finalAnswer = parsed.run_result.final_content
                  }
                } catch (e) {
                  if (pendingEvent === 'message') assembled += dataStr
                }
                pendingEvent = null
              }
            }
          })
          res.data.on('end', () => {
            if (buffer.trim().startsWith('data:')) {
              try {
                const dataStr = buffer.trim().slice(5).trim()
                const parsed = JSON.parse(dataStr)
                if (parsed.delta?.content) assembled += parsed.delta.content
                if (parsed.content) finalAnswer = parsed.content
              } catch {}
            }
            resolve({ chatId, messageId, content: finalAnswer || assembled })
          })
        }).catch(reject)
      })
    }
  }

  // --- Other SDK methods ---
  appConfig = { get: () => this.get('/config', { requireAuth: false }) }
  auth = {
    login: (email, password) => this.post('/auth/login', { email, password }, { requireAuth: false }),
    logout: () => this.post('/auth/logout', {}),
    getUserInfo: () => this.get('/auth/get_user_info'),
    exchangeOauthCode: (code, state) => this.post('/auth/oauth/exchange', { code, state }, { requireAuth: false }),
    loginWithOAuth: (provider) => `${BASE}/auth/oauth/authorize?provider=${provider}`,
    updateProfile: (data) => this.post('/auth/profile', data),
    sendDeleteAccountCode: (email) => this.post('/app/auth/send-code', { email, type: 'delete_account' }, { requireAuth: false, headers: { 'Accept-Language': 'en' } }),
    deleteAccount: (code) => this.post('/app/auth/delete-account', { code }),
    sendResetPasswordCode: (email) => this.post('/app/auth/send-code', { email, type: 'reset_password' }, { requireAuth: false, headers: { 'Accept-Language': 'en' } }),
    verifyResetCode: (email, code) => this.post('/app/auth/v2/verify-reset-code', { email, code }, { requireAuth: false, headers: { 'Accept-Language': 'en' } }),
    resetPassword: (reset_token, password) => this.post('/app/auth/v2/reset-password', { reset_token, password }, { requireAuth: false, headers: { 'Accept-Language': 'en' } }),
    sendPasswordlessCode: (email) => this.post('/auth/passwordless/send-code', { email }, { requireAuth: false }),
    verifyPasswordless: (email, code) => this.post('/auth/passwordless/verify-login', { email, code }, { requireAuth: false }),
    switchOrgContext: (org_id) => this.post('/auth/switch-context', { org_id }),
  }
  upload = {
    presigned: (filename, content_type, file_size) => this.post('/upload/presigned', { filename, content_type, file_size }),
    confirm: (file_id) => this.post('/upload/confirm', { file_id }),
    getDownloadUrl: (file_id) => this.post('/upload/download', { file_id }).then(r => r.download_url || r),
    uploadFile: async (filePath, onProgress) => {
      const stat = fs.statSync(filePath)
      const filename = path.basename(filePath)
      const ext = path.extname(filename).toLowerCase()
      const mimeMap = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.doc':'application/msword','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.ppt':'application/vnd.ms-powerpoint' }
      const content_type = mimeMap[ext] || 'application/octet-stream'
      const pres = await this.upload.presigned(filename, content_type, stat.size)
      const upload_url = pres.upload_url
      const file_id = pres.file_id
      await new Promise((resolve, reject) => {
        const data = fs.readFileSync(filePath)
        const u = new URL(upload_url)
        const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'PUT', headers: { 'Content-Type': content_type, 'Content-Length': data.length } }, (res) => {
          let body = ''
          res.on('data', c => body += c)
          res.on('end', () => { if (res.statusCode >= 200 && res.statusCode < 300) resolve(); else reject(new Error(`TOS upload failed ${res.statusCode}: ${body.slice(0,500)}`)) })
        })
        req.on('error', reject)
        if (onProgress) onProgress({ loaded: data.length, total: data.length, percentage: 100 })
        req.write(data)
        req.end()
      })
      return this.upload.confirm(file_id)
    }
  }
  library = {
    list: (opts = {}) => this.post('/library/items', { scope: opts.scope, limit: opts.limit, offset: opts.offset, quotaOnly: opts.quotaOnly, sleeping_only: opts.sleeping_only }),
    picker: (opts = {}) => this.post('/library/picker', { query: opts.query, limit: opts.limit }),
    upload: (fileId, filename) => {
      if (typeof fileId === 'object' && fileId !== null) return this.post('/library/upload', fileId)
      if (!filename) throw new Error('library.upload requires filename: client.library.upload(file_id, filename)')
      return this.post('/library/upload', { file_id: fileId, filename })
    },
    save: (data) => this.post('/library/save', data),
    remove: (itemId, scope) => this.post(`/library/items/${itemId}/remove`, scope ? { scope } : {}),
    download: (scope, filePath) => this.post('/library/files/download', { scope, path: filePath }),
  }
  memory = {
    list: () => this.get('/memory/items'),
    create: (text, version) => this.post('/memory/items', { text, version }),
    update: (id, text, version) => this.patch(`/memory/items/${id}`, { text, version }),
    delete: (id, version) => this.del(`/memory/items/${id}?version=${version}`),
    status: () => this.get('/memory/status'),
    pauseBatch: () => this.post('/memory/batch/pause', {}),
    resumeBatch: () => this.post('/memory/batch/resume', {}),
    reprocess: () => this.post('/memory/reprocess', {}),
    getSettings: () => this.get('/memory/settings'),
    updateSettings: (data) => this.put('/memory/settings', data),
    citations: (id) => this.get(`/memory/citations/${id}`),
  }
  history = {
    list: (opts = {}) => this.get('/auth/history', { params: { page: opts.page || 1, page_size: opts.page_size || 30, filter: opts.filter || 'active', project_id: opts.project_id } }),
    batch: (data) => this.post('/auth/history/batch', data),
    pin: (chatIds) => this.post('/auth/history/batch', { action: 'pin', chatIds }),
    unpin: (chatIds) => this.post('/auth/history/batch', { action: 'unpin', chatIds }),
    archive: (chatIds) => this.post('/auth/history/batch', { action: 'archive', chatIds }),
    unarchive: (chatIds) => this.post('/auth/history/batch', { action: 'unarchive', chatIds }),
    moveToProject: (chatIds, project_id) => this.post('/auth/history/batch', { action: 'move_to_project', chatIds, project_id }),
    delete: (chatId) => this.del(`/auth/history/${chatId}`),
    rename: (chatId, title) => this.patch(`/auth/history/${chatId}`, { title }),
    copy: (chatId) => this.post(`/auth/history/${chatId}/copy`, {}),
    copyPartial: (chatId, messageIndex, title) => this.post(`/auth/history/${chatId}/copy-partial`, { messageIndex, title }),
    search: (params={}) => {
      const p = { ...params }
      if (p.query && !p.q) { p.q = p.query; delete p.query }
      if (p.keyword && !p.q) { p.q = p.keyword; delete p.keyword }
      if (!p.q) throw new Error("history.search requires param 'q' (contoh: {q:'test'})")
      return this.get('/auth/history/search', { params: p })
    }
  }
  scene = { configs: (locale) => this.get('/scene/configs', { headers: locale ? { 'Accept-Language': locale } : {}, requireAuth: false }) }
  org = {
    listContexts: () => this.post('/org/list-org-contexts', {}),
    getInviteInfo: (data) => this.post('/org/get-invite-info', data),
    acceptInvite: (data) => this.post('/org/accept-invite', data),
    listPendingConfirmations: () => this.post('/org/list-pending-confirmations', {}),
    confirmPending: (data) => this.post('/org/confirm-pending-org', data),
    leave: (data) => this.post('/org/leave-org', data || {}),
    getCurrent: () => this.post('/org/get-current-org', {}),
    listMembers: (data) => this.post('/org/list-org-members', data || {}),
    updateMemberQuota: (data) => this.post('/org/update-member-quota', data),
    removeMember: (data) => this.post('/org/remove-member', data),
    createInvite: (data) => this.post('/org/create-org-invite', data),
    revokeInvite: (data) => this.post('/org/revoke-org-invite', data),
    usageOverview: (data) => this.post('/org/get-org-usage-overview', data || {}),
  }
  vip = {
    info: () => this.get('/vip/info'),
    plans: () => this.get('/vip/plans'),
    subscribe: (data) => this.post('/vip/subscribe', data || {}),
    unsubscribe: (data) => this.post('/vip/unsubscribe', data || {}),
    boost: (data) => this.post('/vip/boost', data || {}),
    creditTransactions: (data) => this.post('/vip/credit-transactions', data || {}),
    invoices: (data) => this.post('/vip/invoices', data || {}),
  }
  project = { list: () => this.get('/auth/projects'), create: (data) => this.post('/auth/projects', data) }
  asr = { transcribe: async (filePath, opts = {}) => { const data = fs.readFileSync(filePath); const filename = path.basename(filePath) || 'recording.webm'; return this._request('/asr/transcribe', { method: 'POST', body: { fields: opts.language ? { language: opts.language } : {}, files: [{ field: 'file', filename, contentType: 'audio/webm', data }] }, isFormData: true }).then(r => r.text || r) } }
  feedback = { send: (data) => { if(!data.category) throw new Error("feedback.send requires category"); if(!data.title) throw new Error("feedback.send requires title"); if(!data.description) throw new Error("feedback.send requires description"); return this.post('/general-feedback', data) }, uploadImage: async (filePath, filename) => { const data = fs.readFileSync(filePath); const fn = filename || path.basename(filePath); return this._request('/general-feedback/upload-image', { method: 'POST', body: { fields: {}, files: [{ field: 'file', filename: fn, contentType: 'image/png', data }] }, isFormData: true }) } }
  user = { getNotificationSettings: () => this.get('/user/notification-settings'), updateNotificationSettings: (data) => this.put('/user/notification-settings', data), getPrivacySettings: () => this.get('/user/privacy-settings'), updatePrivacySettings: (data) => this.put('/user/privacy-settings', data), getVapidKey: () => this.get('/user/vapid-public-key', { requireAuth: false }), createPushSubscription: (data) => this.post('/user/push-subscription', data), deletePushSubscription: (data) => this.del('/user/push-subscription', { body: data }) }
  scene = { configs: (locale) => this.get('/scene/configs', { headers: locale ? { 'Accept-Language': locale } : {}, requireAuth: false }) }
  org = { listContexts: () => this.post('/org/list-org-contexts', {}), getInviteInfo: (data) => this.post('/org/get-invite-info', data), acceptInvite: (data) => this.post('/org/accept-invite', data), listPendingConfirmations: () => this.post('/org/list-pending-confirmations', {}), confirmPending: (data) => this.post('/org/confirm-pending-org', data), leave: (data) => this.post('/org/leave-org', data || {}), getCurrent: () => this.post('/org/get-current-org', {}), listMembers: (data) => this.post('/org/list-org-members', data || {}), updateMemberQuota: (data) => this.post('/org/update-member-quota', data), removeMember: (data) => this.post('/org/remove-member', data), createInvite: (data) => this.post('/org/create-org-invite', data), revokeInvite: (data) => this.post('/org/revoke-org-invite', data), usageOverview: (data) => this.post('/org/get-org-usage-overview', data || {}) }
  vip = { info: () => this.get('/vip/info'), plans: () => this.get('/vip/plans'), subscribe: (data) => this.post('/vip/subscribe', data || {}), unsubscribe: (data) => this.post('/vip/unsubscribe', data || {}), boost: (data) => this.post('/vip/boost', data || {}), creditTransactions: (data) => this.post('/vip/credit-transactions', data || {}), invoices: (data) => this.post('/vip/invoices', data || {}) }
  project = { list: () => this.get('/auth/projects'), create: (data) => this.post('/auth/projects', data) }
  asr = { transcribe: async (filePath, opts = {}) => { const data = fs.readFileSync(filePath); const filename = path.basename(filePath) || 'recording.webm'; return this._request('/asr/transcribe', { method: 'POST', body: { fields: opts.language ? { language: opts.language } : {}, files: [{ field: 'file', filename, contentType: 'audio/webm', data }] }, isFormData: true }).then(r => r.text || r) } }
  feedback = { send: (data) => { if(!data.category) throw new Error("feedback.send requires category"); if(!data.title) throw new Error("feedback.send requires title"); if(!data.description) throw new Error("feedback.send requires description"); return this.post('/general-feedback', data) }, uploadImage: async (filePath, filename) => { const data = fs.readFileSync(filePath); const fn = filename || path.basename(filePath); return this._request('/general-feedback/upload-image', { method: 'POST', body: { fields: {}, files: [{ field: 'file', filename: fn, contentType: 'image/png', data }] }, isFormData: true }) } }
  user = { getNotificationSettings: () => this.get('/user/notification-settings'), updateNotificationSettings: (data) => this.put('/user/notification-settings', data), getPrivacySettings: () => this.get('/user/privacy-settings'), updatePrivacySettings: (data) => this.put('/user/privacy-settings', data), getVapidKey: () => this.get('/user/vapid-public-key', { requireAuth: false }), createPushSubscription: (data) => this.post('/user/push-subscription', data), deletePushSubscription: (data) => this.del('/user/push-subscription', { body: data }) }
  scene = { configs: (locale) => this.get('/scene/configs', { headers: locale ? { 'Accept-Language': locale } : {}, requireAuth: false }) }
  org = { listContexts: () => this.post('/org/list-org-contexts', {}), getInviteInfo: (data) => this.post('/org/get-invite-info', data), acceptInvite: (data) => this.post('/org/accept-invite', data), listPendingConfirmations: () => this.post('/org/list-pending-confirmations', {}), confirmPending: (data) => this.post('/org/confirm-pending-org', data), leave: (data) => this.post('/org/leave-org', data || {}), getCurrent: () => this.post('/org/get-current-org', {}), listMembers: (data) => this.post('/org/list-org-members', data || {}), updateMemberQuota: (data) => this.post('/org/update-member-quota', data), removeMember: (data) => this.post('/org/remove-member', data), createInvite: (data) => this.post('/org/create-org-invite', data), revokeInvite: (data) => this.post('/org/revoke-org-invite', data), usageOverview: (data) => this.post('/org/get-org-usage-overview', data || {}) }
  vip = { info: () => this.get('/vip/info'), plans: () => this.get('/vip/plans'), subscribe: (data) => this.post('/vip/subscribe', data || {}), unsubscribe: (data) => this.post('/vip/unsubscribe', data || {}), boost: (data) => this.post('/vip/boost', data || {}), creditTransactions: (data) => this.post('/vip/credit-transactions', data || {}), invoices: (data) => this.post('/vip/invoices', data || {}) }
  project = { list: () => this.get('/auth/projects'), create: (data) => this.post('/auth/projects', data) }
  asr = { transcribe: async (filePath, opts = {}) => { const data = fs.readFileSync(filePath); const filename = path.basename(filePath) || 'recording.webm'; return this._request('/asr/transcribe', { method: 'POST', body: { fields: opts.language ? { language: opts.language } : {}, files: [{ field: 'file', filename, contentType: 'audio/webm', data }] }, isFormData: true }).then(r => r.text || r) } }
  feedback = { send: (data) => { if(!data.category) throw new Error("feedback.send requires category"); if(!data.title) throw new Error("feedback.send requires title"); if(!data.description) throw new Error("feedback.send requires description"); return this.post('/general-feedback', data) }, uploadImage: async (filePath, filename) => { const data = fs.readFileSync(filePath); const fn = filename || path.basename(filePath); return this._request('/general-feedback/upload-image', { method: 'POST', body: { fields: {}, files: [{ field: 'file', filename: fn, contentType: 'image/png', data }] }, isFormData: true }) } }
  user = { getNotificationSettings: () => this.get('/user/notification-settings'), updateNotificationSettings: (data) => this.put('/user/notification-settings', data), getPrivacySettings: () => this.get('/user/privacy-settings'), updatePrivacySettings: (data) => this.put('/user/privacy-settings', data), getVapidKey: () => this.get('/user/vapid-public-key', { requireAuth: false }), createPushSubscription: (data) => this.post('/user/push-subscription', data), deletePushSubscription: (data) => this.del('/user/push-subscription', { body: data }) }
}

// ===== Account persistence =====
// Cookie di-generate SEKALI, disimpan di data/apodex.json, dipakai terus.
// Regenerate otomatis hanya terjadi setelah 24 jam (TTL) atau lewat action=fresh.
let cachedClient = null
let cachedAccount = null
let cachedAccountFile = null

function accountExpires(data) {
  // TTL 24 jam dihitung dari createdAt (atau expires yang tersimpan)
  const born = data?.createdAt
    ? new Date(data.createdAt).getTime()
    : data?.expires
      ? data.expires - ACCOUNT_TTL_MS
      : Date.now() - ACCOUNT_TTL_MS
  return born + ACCOUNT_TTL_MS
}

function loadAccount() {
  // Prioritas: akun dengan token (user login, lolos guest-trial limit) dulu,
  // baru cookie-only (guest — bisa kena ip_exhausted)
  const candidates = [
    ACCOUNT_FILE,
    path.join(process.cwd(), 'apodex_account.json'),
  ]
  const withToken = []
  const withoutToken = []
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if ((!data?.token && !data?.cookie && !data?.fullCookie) || !data?.deviceID) continue
      if (Date.now() >= accountExpires(data)) continue // sudah > 24 jam → buang, biar regenerate
      const entry = { ...data, expires: accountExpires(data), _file: file }
      if (data.token) withToken.push(entry)
      else withoutToken.push(entry)
    } catch (e) {}
  }
  return withToken[0] || withoutToken[0] || null
}

function saveAccount(account) {
  try {
    const saveData = { ...account, expires: accountExpires(account) }
    fs.mkdirSync(path.dirname(ACCOUNT_FILE), { recursive: true })
    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(saveData, null, 2), 'utf8')
  } catch(e) {}
}

function makeClient(account) {
  // autoRefresh=false: akun dipakai apa adanya — tidak ada generate dadakan saat request error,
  // regenerate hanya lewat TTL 24 jam, action=fresh, atau token revoked (401)
  return new ApodexClient({ cookie: account.fullCookie || account.cookie, token: account.token, deviceID: account.deviceID, autoRefresh: false })
}

function safeStringify(v, maxLen = 500) {
  if (v === null || v === undefined) return undefined
  try {
    if (typeof v === 'string') return v.slice(0, maxLen)
    if (Buffer.isBuffer(v)) return v.toString('utf8').slice(0, maxLen)
    const seen = new WeakSet()
    const json = JSON.stringify(v, (k, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    })
    return json ? json.slice(0, maxLen) : undefined
  } catch (e) {
    return undefined
  }
}

// Token 401/revoked → tandai file akun itu expired supaya request berikutnya
// pakai akun lain (fallback apodex_account.json) atau generate akun baru
function invalidateAccount() {
  cachedClient = null
  cachedAccount = null
  try {
    const file = cachedAccountFile || ACCOUNT_FILE
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      data.expires = Date.now() - 1
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
    }
  } catch (e) {}
  cachedAccountFile = null
}

// ===== Auto-refresh 24 jam (proactive) =====
// Timer otomatis: generate akun + cookie baru tepat saat TTL habis,
// supaya request pertama setelah expiry tidak nunggu generate.
// Dedup via globalThis supaya HMR reload tidak menumpuk timer.
const REFRESH_KEY = '__apodexRefreshTimer'
const REFRESHING_KEY = '__apodexRefreshing'
let lastRefreshFailed = false

function scheduleAccountRefresh() {
  // disabled: hanya generate jika expired on-demand (tidak auto timer)
  return
}
// clear timer lama jika ada dari versi sebelumnya (HMR)
if (globalThis[REFRESH_KEY]) { try{ clearTimeout(globalThis[REFRESH_KEY]) }catch{} globalThis[REFRESH_KEY]=null }

async function getClient() {
  // Pakai client in-memory selama akunnya masih < 24 jam
  if (cachedClient && cachedAccount && Date.now() < cachedAccount.expires) {
    return cachedClient
  }

  // Ambil dari file: data/apodex.json dulu, fallback apodex_account.json
  const cached = loadAccount()
  if ((cached?.token || cached?.cookie || cached?.fullCookie) && cached?.deviceID) {
    cachedAccount = cached
    cachedAccountFile = cached._file || ACCOUNT_FILE
    cachedClient = makeClient(cached)
    return cachedClient
  }

  // Tidak ada akun valid / expired — generate SEKALI, simpan ke data/apodex.json (hanya jika expired)
  logger.info('[Apodex] No valid session (expired), creating fresh account via TempMail (saved to data/apodex.json)...')
  const account = await createFreshAccount({ deviceID: crypto.randomUUID(), verbose: true })
  saveAccount(account)
  cachedAccount = { ...account, expires: accountExpires(account) }
  cachedAccountFile = ACCOUNT_FILE
  cachedClient = makeClient(account)
  lastRefreshFailed = false
  return cachedClient
}

// ===== Main Endpoint =====
export default {
  name: "Apodex AI (Full SDK - mail.tm/justlann)",
  description: "Deep Research AI (standard/pro/heavy) — 72+ endpoints including chat, auth, upload, library, memory, history, org, vip, asr, feedback. Auto-fresh account via TempMail. Session auto-saved to data/apodex.json",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "mode", "version", "action"],
  paramsSchema: {
    text: { type: "string", required: false, description: "Pertanyaan untuk AI (required untuk chat)", example: "What are the main causes of climate change?" },
    mode: {
      type: "string",
      required: false,
      default: "standard",
      description: "Mode AI: standard (Deep Research), pro (Deep Solve), heavy (Deep Discover)",
      enum: ["standard", "pro", "heavy", "agent-swarm", "agent-swarm-gv"],
    },
    version: {
      type: "string",
      required: false,
      default: "1.1",
      description: "Versi model Apodex",
      enum: ["1.0", "1.1"],
    },
    action: {
      type: "string",
      required: false,
      default: "chat",
      description: "Aksi: chat (default) | config (konfigurasi model) | auth-userinfo | library-list | library-picker | vip-info | vip-plans",
      enum: ["chat", "config", "auth-userinfo", "library-list", "library-picker", "vip-info", "vip-plans"],
    },
  },

  async run(req, res) {
    try {
      const { text, mode, version, action = 'chat' } = { ...req.query, ...req.body }
      const body = { ...req.body }

      // ---- config ----
      if (action === 'config') {
        const client = new ApodexClient({})
        const cfg = await client.appConfig.get()
        return res.json({ status: true, config: cfg })
      }

      // ---- chat ----
      if (action === 'chat') {
        if (!text) return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi untuk chat" })
        const client = await getClient()
        logger.info(`[Apodex] Chat: "${text}" (${mode} v${version})`)
        const r = await client.chat.stream(text, { mode, version })
        return res.json({
          status: true,
          mode,
          version,
          question: text,
          answer: r.content,
          chat_id: r.chatId,
          attribution: "@zyvorapi"
        })
      }

      // ---- generic SDK actions (hanya aksi yang diizinkan) ----
      const client = await getClient()
      const actionMap = {
        'auth-userinfo': () => client.auth.getUserInfo(),
        'library-list': () => client.library.list(body),
        'library-picker': () => client.library.picker(body),
        'vip-info': () => client.vip.info(),
        'vip-plans': () => client.vip.plans(),
      }

      if (actionMap[action]) {
        const result = await actionMap[action]()
        return res.json({ status: true, action, result })
      }

      return res.status(400).json({ status: false, message: `Unknown action: ${action}` })

    } catch (err) {
      logger.error(`[Apodex] Error: ${err.message}`)
      const status = /429|rate limit|ip_exhausted|exhausted/i.test(err.message) ? 429 : 500
      const detail = safeStringify(err.response?.data ?? err.data)
      // Token 401/revoked → invalidasi akun cache; request berikutnya pakai akun lain/generate baru
      const errText = `${err.message || ''} ${detail || ''}`
      // auto-generate hanya jika expired (via TTL 24h), bukan saat 401/revoked — biarkan error sampai expired
      return res.status(status).json({ 
        status: false, 
        message: err.message || "Gagal memproses request",
        ...(detail && { detail }),
        hint: status === 429 ? "Apodex rate limited. Use action=fresh for a new account, or add proxies." : undefined
      })
    }
  }
}