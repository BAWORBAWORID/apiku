import logger from "../../src/utils/logger.js"

const API_BASE = 'https://api-7d4446gylq-uc.a.run.app'

async function callAnimeHub(mode, email) {
  let url = ''
  let options = {}

  switch (mode) {
    case 'check':
      url = `${API_BASE}/is`
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      }
      break

    case 'prem':
      url = `${API_BASE}/do`
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email }).toString()
      }
      break

    case 'remove':
      url = `${API_BASE}/remove`
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email }).toString()
      }
      break

    default:
      throw new Error(`Invalid mode: ${mode}`)
  }

  const res = await fetch(url, options)
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`API error (${res.status}): ${text}`)
  }

  return text
}

export default {
  name: "AnimeHub VIP Manager",
  description: "Cek status VIP, buat VIP, atau hapus VIP di AnimeHub",
  category: "FUN",
  methods: ["GET", "POST"],
  params: ["mode", "email"],
  paramsSchema: {
    mode: {
      type: "string",
      required: true,
      enum: ["check", "prem", "remove"],
      description: "Mode operasi: check (cek status), prem (buat VIP), remove (hapus VIP)",
      example: "check"
    },
    email: {
      type: "string",
      required: true,
      description: "Email target",
      example: "user@example.com"
    }
  },
  async run(req, res) {
    try {
      const { mode, email } = { ...req.query, ...req.body }

      if (!mode || !email) {
        return res.status(400).json({ status: false, message: "Parameter 'mode' dan 'email' wajib diisi" })
      }

      if (!['check', 'prem', 'remove'].includes(mode)) {
        return res.status(400).json({ status: false, message: "Mode tidak valid. Gunakan: check, prem, atau remove" })
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return res.status(400).json({ status: false, message: "Format email tidak valid" })
      }

      logger.info(`[AnimeHub] mode: ${mode} | email: ${email}`)

      const rawResult = await callAnimeHub(mode, email)

      let parsedResult
      try {
        parsedResult = JSON.parse(rawResult)
      } catch {
        parsedResult = rawResult
      }

      return res.json({
        status: true,
        mode,
        email,
        result: parsedResult
      })
    } catch (err) {
      logger.error(`[AnimeHub] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'AnimeHub request failed' })
    }
  }
}