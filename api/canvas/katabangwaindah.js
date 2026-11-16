import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas"
import axios from "axios"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// ESM __dirname — points to api/canvas/ folder
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FONT_URL =
  "https://raw.githubusercontent.com/rzkrohan/Font/2e114f4712fbab9e290cb822ab7bfe0b02bbcaab/arialnarrow.ttf"
const BG_URL =
  "https://raw.githubusercontent.com/rzkrohan/image-canvas/refs/heads/main/IMG-20261110-WA0238.jpg"

// Local fallback paths (auto-resolved relative to this file)
const LOCAL_FONT_PATH = path.join(__dirname, "assets", "arialnarrow.ttf")
const LOCAL_BG_PATH = path.join(__dirname, "assets", "kbw-bg.jpg")

// ─── Konfigurasi render (sama dengan source asli) ───
const creator = "Rizkyrohan"
const source = "https://whatsapp.com/channel/0029VbDWBmtA89MamPba8q3f"
const width = 1594
const height = 3200
const atasbawah = -650
const kanankiri = -300
const zoom = 1
const textZoom = 1
const areaWidth = 650
const areaHeight = 800
const lineSpacing = 1.0
const boldMode = "tebal"
const boldSize = 1
const stretchY = 2
const stretchX = 1
const maxChars = 10
const maxWords = 2

export default {
  name: "Canvas Kata Bang Waindah",
  description:
    "Generator teks gaya 'Kata Bang Waindah' — tulisan besar tebal di atas background (output image/jpeg)",
  category: "Canvas",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Teks yang akan ditulis di gambar",
      default: "mark tidur, besok ban grup lagi",
      example: "besok kita lanjut lagi",
    },
  },

  async run(req, res) {
    try {
      const { text } = { ...req.query, ...req.body }

      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return res.status(400).json({ status: false, message: "Parameter 'text' wajib diisi" })
      }

      // network-primary, local-asset fallback (biar endpoint tetap hidup kalau github raw down)
      const loadFromNetworkOrLocal = async (url, localPath) => {
        try {
          const r = await axios.get(url, { responseType: "arraybuffer" })
          return Buffer.from(r.data)
        } catch (err) {
          if (fs.existsSync(localPath)) {
            console.warn(`[KataBangWaindah] Remote failed (${err.message}); pakai local fallback ${localPath}`)
            return fs.readFileSync(localPath)
          }
          throw new Error(`fetch failed (remote err: ${err.message}; local fallback missing at ${localPath})`)
        }
      }

      const [fontBuffer, bgBuffer] = await Promise.all([
        loadFromNetworkOrLocal(FONT_URL, LOCAL_FONT_PATH),
        loadFromNetworkOrLocal(BG_URL, LOCAL_BG_PATH),
      ])

      GlobalFonts.register(fontBuffer, "Arial Narrow")

      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext("2d")

      const bg = await loadImage(bgBuffer)
      const bgWidth = width * zoom
      const bgHeight = height * zoom
      ctx.drawImage(bg, (width - bgWidth) / 2, (height - bgHeight) / 2, bgWidth, bgHeight)

      // pecah teks jadi baris (algoritma sama dengan source)
      const words = text.trim().split(/\s+/)
      const lines = []
      let line = []
      for (const word of words) {
        const totalChars = line.join("").length + word.length
        if (line.length >= maxWords || totalChars > maxChars || word.length >= maxChars) {
          if (line.length) lines.push(line.join(" "))
          line = [word]
        } else {
          line.push(word)
        }
      }
      if (line.length) lines.push(line.join(" "))

      const extra = boldMode === "tebal" ? boldSize * 2 : 0
      const maxFontSize = 400
      const minFontSize = Math.min(20, source.length * 4)
      let fontSize = maxFontSize

      while (fontSize > minFontSize) {
        const currentSize = fontSize * textZoom
        ctx.font = `${currentSize}px "Arial Narrow"`
        const lh = currentSize * lineSpacing * stretchY
        const widthFits = lines.every(
          (t) => ctx.measureText(t).width * stretchX + extra * stretchX <= areaWidth
        )
        const heightFits = lines.length * lh <= areaHeight
        if (widthFits && heightFits) break
        fontSize -= 2
      }

      const finalFontSize = fontSize * textZoom
      const centerX = width / 2 + kanankiri
      const centerY = height / 2 + atasbawah

      ctx.font = `${finalFontSize}px "Arial Narrow"`
      ctx.fillStyle = "#18362F"
      ctx.strokeStyle = "#18362F"
      ctx.lineJoin = "round"
      ctx.lineWidth = boldMode === "tebal" ? boldSize * 2 : 0
      ctx.globalAlpha = Math.min(1, Math.max(0.85, creator.length / 5))
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"

      const lineHeight = finalFontSize * lineSpacing * stretchY
      const totalHeight = lines.length * lineHeight
      const startY = centerY - totalHeight / 2 + lineHeight / 2

      lines.forEach((t, i) => {
        const y = startY + i * lineHeight
        ctx.save()
        ctx.translate(centerX, y)
        ctx.scale(stretchX, stretchY)
        if (boldMode === "tebal") ctx.strokeText(t, 0, 0)
        ctx.fillText(t, 0, 0)
        ctx.restore()
      })

      res.setHeader("Content-Type", "image/jpeg")
      res.send(canvas.toBuffer("image/jpeg"))
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Kata Bang Waindah failed" })
    }
  },
}