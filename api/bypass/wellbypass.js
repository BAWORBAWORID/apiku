/**
 * WellBypass Link Bypass API
 *
 * Bypass Linkvertise, Lootlabs, Workink, dan layanan shortlink lainnya
 * menggunakan backend wellbypass.my.id (memanfaatkan Turnstile solver)
 *
 * GET  /api/solve/wellbypass?url=https://linkvertise.com/...
 * POST /api/solve/wellbypass
 * Body: { "url": "https://linkvertise.com/..." }
 */

import logger from "../../src/utils/logger.js"

const WELLBYPASS_URL = "https://wellbypass.my.id"
const TURNSTILE_SITE_KEY = "0x4AAAAAAEw9LL7413Xfin6z"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

function generateDeviceId() {
  const fingerprint = [
    UA,
    "en-US",
    "1920x1080x24",
    "Asia/Jakarta",
    "8"
  ].join("::")
  let hash = 0
  for (let i = 0; i < fingerprint.length; i++) {
    hash = (hash << 5) - hash + fingerprint.charCodeAt(i) | 0
  }
  return `wb_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`
}

async function solveTurnstile(proxy = null) {
  const pageUrl = `${WELLBYPASS_URL}/en`
  const proxyArg = proxy ? ` --proxy http://${proxy.replace(/^https?:\/\//, "")}` : ""
  const { exec } = await import("node:child_process")
  const { stdout } = await new Promise((resolve, reject) => {
    exec(
      `npx --yes haidarcf turnstile-min --url ${pageUrl} --sitekey ${TURNSTILE_SITE_KEY}${proxyArg}`,
      { timeout: 35000, maxBuffer: 4 * 1024 * 1024 },
      (err, out) => {
        if (err) return reject(err)
        resolve(out)
      }
    )
  })
  const idx = stdout.indexOf("{")
  if (idx === -1) throw new Error("Solver output invalid")
  const data = JSON.parse(stdout.slice(idx))
  if (!data.token) throw new Error("Failed to obtain captcha token")
  return data.token
}

export default {
  name: "WellBypass Link Bypass",
  description: "Bypass shortlink (Linkvertise, Lootlabs, Workink, dll)",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url", "turnstileToken"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL shortlink yang ingin di-bypass (Linkvertise, Lootlabs, Workink, dll)",
      example: "https://linkvertise.com/546946/mYoUbm5Ro7gU"
    },
    turnstileToken: {
      type: "string",
      required: false,
      description: "Cloudflare Turnstile token (opsional, auto-solve via haidarcf jika kosong)",
      example: "0.abcdef..."
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { url, turnstileToken } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string" || url.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
          example: {
            get: "/api/solve/wellbypass?url=https://linkvertise.com/546946/mYoUbm5Ro7gU",
            post: { url: "https://linkvertise.com/546946/mYoUbm5Ro7gU" }
          }
        })
      }

      const deviceId = generateDeviceId()

      try {
        await fetch(`${WELLBYPASS_URL}/api/device/register`, {
          method: "POST",
          headers: { "x-device-id": deviceId, "User-Agent": UA }
        })
      } catch {}

      let token = turnstileToken
      if (!token) {
        try {
          token = await solveTurnstile()
        } catch (solverErr) {
          logger.warn(`[WELLBYPASS] Solver gagal: ${solverErr.message}`)
        }
      }

      if (!token) {
        return res.status(400).json({
          status: false,
          message: "Gagal mendapatkan token Turnstile. Coba kirim manual via parameter 'turnstileToken'."
        })
      }

      const bypassRes = await fetch(`${WELLBYPASS_URL}/api/bypass`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA,
          "x-device-id": deviceId,
          "Cookie": "NEXT_LOCALE=en",
          "Origin": WELLBYPASS_URL,
          "Referer": `${WELLBYPASS_URL}/en`
        },
        body: JSON.stringify({
          url: url.trim(),
          turnstileToken: token
        })
      })

      const data = await bypassRes.json().catch(() => ({ status: false, message: bypassRes.statusText }))
      const responseTime = Date.now() - startTime

      if (data.status && data.bypassedUrl) {
        return res.json({
          status: true,
          result: {
            originalUrl: url,
            bypassedUrl: data.bypassedUrl,
            service: data.service || null,
            responseTime: `${responseTime}ms`
          }
        })
      }

      return res.json({
        status: false,
        message: data.message || "Gagal bypass link",
        result: {
          originalUrl: url,
          responseTime: `${responseTime}ms`
        }
      })
    } catch (err) {
      logger.error(`[WELLBYPASS] Error: ${err.message}`)
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to bypass URL",
        result: { responseTime: `${Date.now() - startTime}ms` }
      })
    }
  }
}