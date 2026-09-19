/**
 * TempMail Chat — tempmail.chat backend (Cloudflare Workers)
 * Feature: create inbox, check inbox, wait for email, auto (create+wait), delete inbox
 * Upstream: tempmail-backend.hasnaintariq142.workers.dev
 */
import axios from "axios"

const API_BASE = "https://tempmail-backend.hasnaintariq142.workers.dev"
const CREATE_API = `${API_BASE}/api/create-inbox`
const INBOX_API = `${API_BASE}/api/inbox`
const DELETE_API = `${API_BASE}/api/delete-inbox`

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Origin": "https://tempmail.chat",
  "Referer": "https://tempmail.chat/"
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createInbox() {
  const response = await axios.post(CREATE_API, {}, {
    timeout: 30000,
    headers: HEADERS,
    validateStatus: () => true
  })
  return {
    status: response.status,
    data: response.data
  }
}

async function getInbox(token) {
  const response = await axios.get(`${INBOX_API}?token=${encodeURIComponent(token)}`, {
    timeout: 30000,
    headers: { ...HEADERS, Accept: "application/json" },
    validateStatus: () => true
  })
  return {
    status: response.status,
    data: response.data
  }
}

async function deleteInbox(token) {
  const response = await axios.post(DELETE_API, {
    token: token
  }, {
    timeout: 30000,
    headers: HEADERS,
    validateStatus: () => true
  })
  return {
    status: response.status,
    data: response.data
  }
}

async function waitForEmail(token, maxWait) {
  const maxAttempts = Math.ceil((maxWait || 120) / 5)
  const knownIds = new Set()

  for (let i = 0; i < maxAttempts; i++) {
    const inbox = await getInbox(token)

    if (inbox.status === 200 && inbox.data?.success) {
      const messages = inbox.data.messages || []

      for (const msg of messages) {
        const msgId = msg.id || msg.received_at || JSON.stringify(msg)
        if (!knownIds.has(msgId)) {
          knownIds.add(msgId)
          return inbox.data
        }
      }
    }

    await delay(5000)
  }

  return null
}

function normalizeMessages(messages) {
  return messages.map((m, index) => ({
    index: index + 1,
    id: m.id || null,
    from: m.sender || null,
    fromName: m.sender_name || null,
    to: m.recipient || null,
    subject: m.subject || null,
    body: m.text_body || null,
    html: m.html_body || null,
    date: m.received_at || null,
    expires: m.expires_at || null
  }))
}

export default {
  name: "TempMail Chat",
  description:
    "Temporary email — create inbox, cek inbox, wait email masuk, auto (create+wait), delete inbox",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["action", "token", "maxwait"],
  paramsSchema: {
    action: {
      type: "string",
      required: true,
      description: "Action yang tersedia",
      enum: ["create", "inbox", "wait", "auto", "delete"],
      required_error: "Parameter 'action' wajib diisi (create|inbox|wait|auto|delete)",
      invalid_error: "Action tidak valid. Gunakan: create, inbox, wait, auto, delete"
    },
    token: {
      type: "string",
      required: false,
      description: "Access token inbox (hasil dari action=create) — wajib untuk inbox/wait/delete"
    },
    maxwait: {
      type: "number",
      required: false,
      description: "Maksimal waktu tunggu email (detik) untuk action wait/auto",
      default: 120,
      min: 5,
      max: 300
    }
  },
  async run(req, res) {
    const { action, token, maxwait } = { ...req.query, ...req.body }

    if (!action) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'action' wajib diisi (create|inbox|wait|auto|delete)"
      })
    }

    const maxWait = parseInt(maxwait) || 120

    try {
      if (action === "create") {
        const hasil = await createInbox()

        if (hasil.status === 200 && hasil.data?.success) {
          return res.json({
            status: true,
            data: {
              email: hasil.data.email,
              token: hasil.data.access_token,
              expires: hasil.data.expires_at || null
            }
          })
        }
        return res.json({
          status: false,
          message: hasil.data?.error || `HTTP ${hasil.status}`
        })
      }

      if (action === "inbox") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' wajib diisi (dari action=create)"
          })
        }

        const hasil = await getInbox(token)

        if (hasil.status === 200 && hasil.data?.success) {
          const messages = normalizeMessages(hasil.data.messages || [])
          return res.json({
            status: true,
            data: {
              email: hasil.data.email || null,
              expires: hasil.data.expires_at || null,
              total: messages.length,
              messages
            }
          })
        }
        return res.json({
          status: false,
          message: hasil.data?.error || `HTTP ${hasil.status}`
        })
      }

      if (action === "wait") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' wajib diisi (dari action=create)"
          })
        }

        const hasil = await waitForEmail(token, maxWait)

        if (hasil) {
          const messages = normalizeMessages(hasil.messages || [])
          return res.json({
            status: true,
            data: {
              email: hasil.email || null,
              expires: hasil.expires_at || null,
              total: messages.length,
              messages
            }
          })
        }
        return res.json({
          status: false,
          message: `Tidak ada email masuk dalam ${maxWait} detik`
        })
      }

      if (action === "auto") {
        const buat = await createInbox()

        if (buat.status !== 200 || !buat.data?.success) {
          return res.json({
            status: false,
            message: buat.data?.error || "Gagal buat inbox"
          })
        }

        const hasil = await waitForEmail(buat.data.access_token, maxWait)

        if (hasil) {
          const messages = normalizeMessages(hasil.messages || [])
          return res.json({
            status: true,
            data: {
              email: hasil.email || buat.data.email,
              token: buat.data.access_token,
              expires: hasil.expires_at || null,
              total: messages.length,
              messages
            }
          })
        }
        return res.json({
          status: false,
          message: `Tidak ada email masuk dalam ${maxWait} detik`,
          data: {
            email: buat.data.email,
            token: buat.data.access_token
          }
        })
      }

      if (action === "delete") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' wajib diisi (dari action=create)"
          })
        }

        const hasil = await deleteInbox(token)
        return res.json({
          status: hasil.status === 200 && hasil.data?.success,
          data: hasil.data
        })
      }

      return res.status(400).json({
        status: false,
        message: "Action tidak valid. Gunakan: create, inbox, wait, auto, delete"
      })
    } catch (error) {
      res.json({
        status: false,
        message: error.message || "Terjadi kesalahan internal"
      })
    }
  },
}
