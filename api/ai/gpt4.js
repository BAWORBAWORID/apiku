/**
 * GPT-4 Chat API
 * Provider: chateverywhere.app
 * Parameter: teks
 * NO API KEY
 */

import axios from "axios"

/* ===============================
   GPT-4 CLIENT FUNCTION
================================ */
async function gpt4(message, systemPrompt = null, temperature = 0.5) {
  try {
    if (!message || message.trim().length === 0) {
      throw new Error("Message cannot be empty.")
    }

    const defaultPrompt =
      "You are a helpful AI assistant. Provide clear, accurate, and concise responses."

    const { data } = await axios.post(
      "https://chateverywhere.app/api/chat/",
      {
        model: {
          id: "gpt-4",
          name: "GPT-4",
          maxLength: 320000,
          tokenLimit: 10000,
          completionTokenLimit: 5000,
          deploymentName: "gpt-4",
        },
        messages: [
          {
            pluginId: null,
            content: message.trim(),
            role: "user",
          },
        ],
        prompt: systemPrompt || defaultPrompt,
        temperature: temperature,
      },
      {
        headers: {
          Accept: "*/*",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    )

    if (!data) {
      throw new Error("No response received from GPT-4.")
    }

    return data
  } catch (error) {
    console.error("GPT-4 Error:", error.message)
    throw new Error("Could not get response from GPT-4.")
  }
}

/* ===============================
   EXPORT API (STYLE LAMA KAMU)
================================ */
export default {
  name: "GPT-4 Chat",
  description: "GPT-4 AI",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
    },
  },

  async run(req, res) {
    try {
      const { teks, temperature } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi",
        })
      }

      const ai = await gpt4(
        teks.trim(),
        null,
        temperature ? Number(temperature) : 0.5
      )

      res.json({
        status: true,
        //provider: "chateverywhere",
        //model: "gpt-4",
        input: teks.trim(),
        result:
          ai?.choices?.[0]?.message?.content ||
          ai?.text ||
          ai,
        //raw: ai,
        timestamp: Date.now(),
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "GPT-4 request failed",
      })
    }
  },
}