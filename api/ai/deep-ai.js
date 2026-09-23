/**
 * Deep-Ai Chat API
 * Provider: deepai.org
 * Parameter: teks
 */

import axios from "axios"
import crypto from "crypto"

const API = "https://api.deepai.org/hacking_is_a_serious_crime"
const MODEL = "standard"

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36"

function md5Like(input) {
  const a = []

  for (let b = 0; b < 64; ) {
    a[b] = 0 | (4294967296 * Math.sin(++b % Math.PI))
  }

  let d
  let e
  let f
  let g = [
    (d = 1732584193),
    (e = 4023233417),
    ~d,
    ~e
  ]

  const h = []
  let l = unescape(encodeURI(input)) + "\u0080"
  let k = l.length
  let c = ((--k / 4 + 2) | 15)

  h[--c] = 8 * k

  while (~k) {
    h[k >> 2] |= l.charCodeAt(k) << (8 * k--)
  }

  for (let b = 0, l = 0; b < c; b += 16) {
    for (
      k = g;
      l < 64;
      k = [
        (f = k[3]),
        d +
          (((f =
            k[0] +
            [
              d & e | ~d & f,
              f & d | ~f & e,
              d ^ e ^ f,
              e ^ (d | ~f)
            ][(k = l >> 4)] +
            a[l] +
            ~~h[b | ([l, 5 * l + 1, 3 * l + 5, 7 * l][k] & 15)]) <<
            (k = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][4 * k + (l++ % 4)])) |
            (f >>> -k)),
        d,
        e
      ]
    ) {
      d = k[1] | 0
      e = k[2]
    }

    for (l = 4; l; ) {
      g[--l] += k[l]
    }
  }

  let result = ""

  for (let l = 0; l < 32; ) {
    result += ((g[l >> 3] >> (4 * (1 ^ l++))) & 15).toString(16)
  }

  return result.split("").reverse().join("")
}

function generateIslandKey() {
  const randomNumber = Math.round(Math.random() * 100000000000).toString()

  const hash = md5Like(
    USER_AGENT +
      md5Like(
        USER_AGENT +
          md5Like(
            USER_AGENT +
              randomNumber +
              "hackers_become_a_little_stinkier_every_time_they_hack"
          )
      )
  )

  return `tryit-${randomNumber}-${hash}`
}

function baseHeaders(extra = {}) {
  return {
    "sec-ch-ua-platform": '"Android"',
    "user-agent": USER_AGENT,
    "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?1",
    "accept": "*/*",
    "origin": "https://deepai.org",
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "priority": "u=1, i",
    ...extra
  }
}

async function askDeepAi(message, sessionUuid = null) {
  const uuid = sessionUuid || crypto.randomUUID()

  const userMessage = {
    role: "user",
    content: message
  }

  const chatHistory = [userMessage]

  const form = new FormData()
  form.append("chat_style", "chat")
  form.append("chatHistory", JSON.stringify(chatHistory))
  form.append("model", MODEL)
  form.append("session_uuid", uuid)
  form.append("sensitivity_request_id", crypto.randomUUID())
  form.append("hacker_is_stinky", "very_stinky")
  form.append("enabled_tools", JSON.stringify(["image_generator", "image_editor"]))

  const apiKey = generateIslandKey()

  const { data, status } = await axios.post(API, form, {
    headers: baseHeaders({ "api-key": apiKey }),
    responseType: "text",
    timeout: 60000
  })

  if (status !== 200) {
    throw new Error(`Deep-Ai returned status ${status}: ${data}`)
  }

  return { answer: data.trim(), sessionUuid: uuid }
}

export default {
  name: "Deep-Ai",
  description: "AI Chat dengan DeepAi. Gratis tanpa API Key.",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan atau teks untuk Deep-Ai"
    }
  },

  async run(req, res) {
    try {
      const { teks } = req.query || {}

      if (!teks || typeof teks !== "string" || teks.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        })
      }

      const { answer, sessionUuid } = await askDeepAi(teks.trim())

      res.json({
        status: true,
        input: teks.trim(),
        result: answer,
        session_uuid: sessionUuid,
        timestamp: Date.now()
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Deep-Ai request failed"
      })
    }
  }
}
