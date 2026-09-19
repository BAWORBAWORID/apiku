/**
 * MathGPT AI Chat
 * Provider: math-gpt.ai
 * Parameter: teks, enableReasoning
 * NO API KEY
 */

import axios from "axios"
import crypto from "crypto"
import { fileTypeFromBuffer } from "file-type"

/* ===============================
   HELPER
================================ */
function clear(rawText) {
  if (!rawText) return ""
  return rawText
    .replace(/\$(.*?)\$/g, "$1")
    .replace(/\\\[|\\\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/* ===============================
   MATHGPT CLIENT FUNCTION
================================ */
async function mathgpt({ query, enableReasoning = false, attachedImage = null } = {}) {
  try {
    if (!query) throw new Error("Query pertanyaan wajib diisi")

    const ip = [10, crypto.randomInt(256), crypto.randomInt(256), crypto.randomInt(256)].join(".")

    const headers = {
      accept: "application/json",
      "accept-language": "id-ID,id;q=0.9",
      "content-type": "application/json",
      origin: "https://math-gpt.ai",
      referer: "https://math-gpt.ai/",
      "sec-ch-ua": '"Chromium";v="127", "Not)A;Brand";v="99"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
      "x-forwarded-for": ip,
      "x-originating-ip": ip,
      "x-remote-ip": ip,
      "x-remote-addr": ip,
      "client-ip": ip,
      "x-real-ip": ip
    }

    let mediaPayload = null
    if (attachedImage) {
      try {
        const type = await fileTypeFromBuffer(attachedImage)
        if (type && type.mime.startsWith("image/")) {
          const uniqueFileName = "chat/" + crypto.randomBytes(32).toString("hex") + "." + type.ext

          const { data: s3Ticket } = await axios.post(
            "https://math-gpt.ai/api/trpc/uploads.signedUploadUrl?batch=1",
            { 0: { json: { path: uniqueFileName, bucket: "mathgpt" } } },
            { headers, timeout: 15000 }
          )

          const uploadUrl = s3Ticket[0].result.data.json
          await axios.put(uploadUrl, attachedImage, {
            headers: { "content-type": type.mime }
          })

          mediaPayload = {
            fileUrl: "https://files.math-gpt.ai/" + uniqueFileName,
            mimeType: type.mime,
            fileName: "math-img-" + Date.now() + "." + type.ext
          }
        }
      } catch (err) {
        throw new Error("Gagal upload gambar: " + err.message)
      }
    }

    const { data: streamResponse } = await axios.post(
      "https://math-gpt.ai/api/ai/generateAnswerStream",
      {
        messages: [{
          id: Date.now(),
          text: query,
          sender: "user",
          ...(mediaPayload || {})
        }],
        type: "MathAI",
        isJustAnswerEnabled: false,
        isThinkingEnabled: enableReasoning,
        visitorId: crypto.randomUUID().replace(/-/g, "")
      },
      { headers, timeout: 60000 }
    )

    const parsedNode = streamResponse
      .split("\n\n")
      .filter(row => row.startsWith("data: {"))
      .map(row => JSON.parse(row.substring(6)))
      .find(node => node.type === "end")

    if (!parsedNode) throw new Error("Server tidak merespon node akhir")

    const structuredAnswer = clear(parsedNode.content)

    return {
      success: true,
      result: {
        answer: structuredAnswer
      }
    }
  } catch (err) {
    if (err.response) {
      throw new Error(`MathGPT API Error (${err.response.status}): ${err.response.data?.message || err.response.statusText}`)
    }
    throw new Error("MathGPT request failed: " + err.message)
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "MathGPT AI",
  description: "AI Chat untuk matematika - No API Key Required. Mendukung perhitungan, rumus, dan upload gambar soal.",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks", "enableReasoning"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Pertanyaan matematika atau perintah"
    },
    enableReasoning: {
      type: "boolean",
      required: false,
      default: false,
      description: "Aktifkan reasoning / langkah-langkah pengerjaan"
    }
  },

  async run(req, res) {
    try {
      const params = req.method === "POST" ? { ...req.body } : { ...req.query }
      const { teks, enableReasoning } = params

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        })
      }

      const reasonMode = enableReasoning === "true" || enableReasoning === true || enableReasoning === "1"

      const ai = await mathgpt({
        query: teks.trim(),
        enableReasoning: reasonMode
      })

      res.json({
        status: true,
        provider: "math-gpt.ai",
        input: teks.trim(),
        result: ai.result.answer || "No response generated",
        enableReasoning: reasonMode,
        timestamp: Date.now()
      })

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "MathGPT request failed"
      })
    }
  }
}
