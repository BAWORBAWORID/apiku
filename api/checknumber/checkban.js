/**
 * Check Ban WhatsApp — gabungan 2 provider
 *  1. kyuux-r.indevs.in/api/check-whatsapp   (status Safe/Unsafe, device/email)
 *  2. api.neosoft.best/api/tools/checker-ban-wa (status Safe/Blocked, exists, detail OTP)
 *
 * GET  /api/checknumber/checkban?nomor=6285167361633
 * POST /api/checknumber/checkban
 */

import logger from "../../src/utils/logger.js"

const UPSTREAM_1 = "https://kyuux-r.indevs.in/api/check-whatsapp"
const UPSTREAM_2 = "https://api.neosoft.best/api/tools/checker-ban-wa"

const TIMEOUT = 25000

function normalizeNumber(input) {
  let clean = String(input).replace(/\D/g, "")
  if (clean.startsWith("+")) clean = clean.slice(1)
  if (clean.startsWith("0") && !clean.startsWith("00")) {
    clean = "62" + clean.slice(1)
  } else if (!clean.startsWith("62") && clean.startsWith("8") && clean.length <= 13) {
    clean = "62" + clean
  }
  return clean
}

async function fetchWithTimeout(url, headers = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", ...headers }
    })
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Provider 1 — kyuux-r.indevs.in
 */
async function providerKyuux(nomor) {
  const json = await fetchWithTimeout(`${UPSTREAM_1}?phone=${nomor}`)
  if (!json.success || !json.data) {
    return { success: false, message: json.message || "Upstream mengembalikan status false" }
  }
  const d = json.data
  return {
    success: true,
    provider: {
      name: "kyuux-r.indevs.in",
      number: d.number || null,
      status: d.status || "Unknown",
      banned: d.banned ?? false,
      info: {
        device: d.info?.device || "Unknown",
        email: d.info?.email || "Unknown"
      }
    }
  }
}

/**
 * Provider 2 — api.neosoft.best
 */
async function providerNeosoft(nomor) {
  const json = await fetchWithTimeout(`${UPSTREAM_2}?number=${nomor}`)
  if (!json.status) {
    return { success: false, message: json.message || "Upstream mengembalikan status false" }
  }
  const r = json.result || {}
  return {
    success: true,
    provider: {
      name: "api.neosoft.best",
      phone: r.phone || null,
      masked: r.masked || null,
      status: r.status || "Unknown",
      banned: !!r.banned,
      exists: !!r.exists,
      detail: r.detail || null
    }
  }
}

function isBanned(r) {
  return !!r.banned || String(r.status || "").toLowerCase().includes("ban")
}

export default {
  name: "Check Ban WhatsApp",
  description: "Cek status ban WhatsApp dari 2 provider sekaligus — status Safe/Blocked, banned, terdaftar/tidak, device/email, dan detail limit akun",
  category: "Check Number",
  methods: ["GET", "POST"],
  params: ["nomor"],
  paramsSchema: {
    nomor: {
      type: "string", required: true,
      description: "Nomor WhatsApp (format 628xx, 08xx, +62xx, atau kode negara lain)",
      example: "6285167361633",
      default: "6285167361633",
      minLength: 8,
      maxLength: 15
    }
  },

  async run(req, res) {
    try {
      const { nomor } = { ...req.query, ...req.body }

      if (!nomor || !String(nomor).trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'nomor' wajib diisi"
        })
      }

      const normalized = normalizeNumber(nomor)

      const [p1, p2] = await Promise.allSettled([
        providerKyuux(normalized),
        providerNeosoft(normalized)
      ])

      const providers = []
      if (p1.status === "fulfilled") providers.push(p1.value)
      else logger.error(`[CHECKBAN] Provider kyuux error: ${p1.reason?.message}`)
      if (p2.status === "fulfilled") providers.push(p2.value)
      else logger.error(`[CHECKBAN] Provider neosoft error: ${p2.reason?.message}`)

      if (providers.length === 0) {
        return res.status(502).json({
          status: false,
          message: "Semua provider gagal",
          result: null
        })
      }

      const successProviders = providers.filter(p => p.success)
      const lastGood = successProviders[successProviders.length - 1]

      const p1Data = successProviders.find(p => p.provider.name === "kyuux-r.indevs.in")?.provider || {}
      const p2Data = successProviders.find(p => p.provider.name === "api.neosoft.best")?.provider || {}

      const isBannedSummary = successProviders.some(p => isBanned(p.provider))
      const isExistsSummary = p2Data.exists ?? true // if neosoft succeeds, it accurately tells if exists

      const result = {
        phone: normalized,
        phone_masked: p2Data.masked || p1Data.number || null,
        status: isBannedSummary ? "Banned" : (lastGood?.provider?.status || "Safe"),
        is_banned: isBannedSummary,
        is_registered: isExistsSummary,
        device: p1Data.info?.device && p1Data.info.device !== "Unknown" ? p1Data.info.device : null,
        email: p1Data.info?.email && p1Data.info.email !== "Unknown" ? p1Data.info.email : null,
      }

      if (p2Data.detail) {
        result.otp = {
          methods: p2Data.detail.fallback_methods || [],
          wait_times_seconds: {
            sms: p2Data.detail.sms_wait || 0,
            voice: p2Data.detail.voice_wait || 0,
            flash: p2Data.detail.flash_wait || 0,
            email: p2Data.detail.email_otp_wait || 0
          }
        }
      }

      return res.json({
        status: true,
        message: "Berhasil mengecek status WhatsApp",
        result,
        _providers: {
          total_success: successProviders.length,
          errors: providers.filter(p => !p.success).map(p => p.message)
        }
      })
    } catch (err) {
      logger.error(`[CHECKBAN] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal cek status WhatsApp"
      })
    }
  }
}