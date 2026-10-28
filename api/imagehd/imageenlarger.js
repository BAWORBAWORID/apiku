/**
 * 【 ImageEnlarger AI Upscale 】
 * Base     : https://www.imageenlarger.app/
 * Category : Image HD
 * Desc     : AI image upscaler (enlarge/enhance/restore) — free, no key required
 */

import crypto from "node:crypto"
import axios from "axios"
import logger from "../../src/utils/logger.js"

const LOGIN_HASH = "ab5d684a5cac66c6a7c902dda743fb642827b01b8bd4d9514d46834e4c425ff2"
const API_BASE = "https://www.imageenlarger.app/api"
const UA = "Mozilla/5.0"

const MODES = ["enlarge", "enhance", "restore"]

async function getToken() {
  const deviceId = crypto.randomBytes(8).toString("hex")
  const res = await fetch(`${API_BASE}/v2/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "hash": LOGIN_HASH,
      "User-Agent": UA
    },
    body: JSON.stringify({ device_name: "Pixel 7", id: deviceId, referral: null })
  })
  if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`)
  const json = await res.json()
  if (!json?.success || !json?.data?.token) throw new Error("Failed to obtain auth token")
  return json.data.token
}

async function resolveImageBuffer(input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) return Buffer.from(input)
  if (typeof input === "string") {
    if (input.startsWith("http://") || input.startsWith("https://")) {
      const res = await axios.get(input, { responseType: "arraybuffer", timeout: 30000 })
      return Buffer.from(res.data)
    }
    if (input.startsWith("data:")) {
      const comma = input.indexOf(",")
      return Buffer.from(input.slice(comma + 1), "base64")
    }
  }
  throw new Error("Unsupported image input. Pass a URL or data URI.")
}

async function processImage(imageBuffer, type, config = {}) {
  const token = await getToken()

  const formData = new FormData()
  const blob = new Blob([imageBuffer], { type: "image/jpeg" })
  formData.append("image", blob, "image.jpg")
  formData.append("type", type)
  formData.append("input", JSON.stringify(config))

  const res = await fetch(`${API_BASE}/v2/process`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "User-Agent": UA
    },
    body: formData
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Process failed: HTTP ${res.status} - ${errorText}`)
  }

  const json = await res.json()
  if (!json?.success || !json?.data?.output) {
    throw new Error(`Operation failed: ${json?.message || json?.error_code || "Unknown error"}`)
  }

  return json.data
}

export default {
  name: "ImageEnlarger",
  description: "AI image upscaler — enlarge, enhance, atau restore gambar menggunakan imageenlarger.app",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url", "mode", "upscale", "face"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan diproses",
      example: "https://example.com/image.jpg"
    },
    mode: {
      type: "string",
      required: false,
      default: "enhance",
      enum: MODES,
      description: "Mode pemrosesan: enlarge, enhance, atau restore"
    },
    upscale: {
      type: "number",
      required: false,
      default: 2,
      description: "Faktor upscale (2 atau 4)"
    },
    face: {
      type: "string",
      required: false,
      default: "false",
      enum: ["true", "false"],
      description: "Aktifkan face enhancement (khusus mode enlarge/enhance)"
    }
  },

  async run(req, res) {
    try {
      const { url, mode = "enhance", upscale = 2, face = "false" } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      const m = String(mode).toLowerCase()
      if (!MODES.includes(m)) {
        return res.status(400).json({ status: false, message: `Mode tidak valid. Pilihan: ${MODES.join(", ")}` })
      }

      const upscaleNum = parseInt(upscale) || 2
      const faceEnhance = ["true", "1", "yes"].includes(String(face).toLowerCase())

      const imageBuffer = await resolveImageBuffer(url)

      let config = {}
      let type = ""

      if (m === "enlarge") {
        type = "Enlarger"
        config = { upscale: upscaleNum, isFaceEnhanceEnabled: faceEnhance }
      } else if (m === "restore") {
        type = "Restore"
        config = { upscale: upscaleNum }
      } else {
        type = "Enhancer"
        config = { upscale: upscaleNum, isBackgroundEnabled: faceEnhance }
      }

      const data = await processImage(imageBuffer, type, config)

      logger.info(`[IMAGEENLARGER] mode=${m} upscale=${upscaleNum}x | ${url.slice(0, 60)} | credits=${data.credits}`)

      return res.json({
        status: true,
        mode: m,
        scale: `${upscaleNum}x`,
        result: data.output,
        width: data.width,
        height: data.height,
        size: data.size,
        credits: data.credits
      })
    } catch (err) {
      logger.error(`[IMAGEENLARGER] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || "Gagal memproses gambar" })
    }
  }
}
