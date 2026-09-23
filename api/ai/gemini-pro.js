/**
 * Gemini 2.5 Pro AI Chat
 * Provider: minitoolai.com
 * Parameter: teks
 * NO API KEY
 */

import axios from "axios"

const BASE_URL = "https://minitoolai.com"
const PAGE_URL = `${BASE_URL}/Gemini-Pro/`
const API_URL = `${BASE_URL}/test_python/`
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

/* ===============================
   GET SESSION (PHPSESSID + utoken)
================================ */
async function getSession() {
  const res = await axios.get(PAGE_URL, {
    headers: { "User-Agent": ua },
    maxRedirects: 5,
    timeout: 15000
  })

  const setCookies = res.headers["set-cookie"] || []
  let phpSessId = ""
  for (const c of setCookies) {
    const m = c.match(/PHPSESSID=([^;]+)/)
    if (m) phpSessId = m[1]
  }

  const html = typeof res.data === "string" ? res.data : ""
  const utokenMatch = html.match(/var\s+utoken\s*=\s*["']([a-f0-9]{64})["']/)
  if (!utokenMatch) throw new Error("utoken tidak ditemukan di halaman")

  return { phpSessId, utoken: utokenMatch[1] }
}

/* ===============================
   SEND MESSAGE
================================ */
async function sendMessage(phpSessId, utoken, message) {
  const res = await axios.post(API_URL, {
    utoken,
    message: `(respond in text)${message}`
  }, {
    headers: {
      "User-Agent": ua,
      "Content-Type": "application/json",
      Referer: PAGE_URL,
      Origin: BASE_URL,
      Cookie: `PHPSESSID=${phpSessId}`
    },
    timeout: 120000
  })

  if (res.status !== 200) {
    throw new Error(`API ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`)
  }

  return res.data?.response || ""
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "Gemini Pro",
  description: "Google Gemini 2.5 Pro",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau perintah untuk AI"
    }
  },

  async run(req, res) {
    try {
      const { teks } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        })
      }

      const { phpSessId, utoken } = await getSession()
      const answer = await sendMessage(phpSessId, utoken, teks.trim())

      res.json({
        status: Boolean(answer),
        model: "gemini-2.5-pro",
        input: teks.trim(),
        result: answer
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gemini Pro request failed"
      })
    }
  }
}
