/**
 * Venice AI Chat API
 * Provider: venice.ai
 * Parameter: teks
 * NO API KEY
 */

import axios from "axios"

/* ===============================
   VENICE AI CLIENT FUNCTION
================================ */
async function veniceChat(message, systemPrompt = "", temperature = 0.8) {
  try {
    if (!message || message.trim().length === 0) {
      throw new Error("Message cannot be empty.")
    }

    const { data } = await axios.request({
      method: 'POST',
      url: 'https://outerface.venice.ai/api/inference/chat',
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        origin: 'https://venice.ai',
        referer: 'https://venice.ai/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Android 10; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
        'x-venice-version': 'interface@20250523.214528+393d253'
      },
      data: JSON.stringify({
        requestId: 'nekorinn',
        modelId: 'dolphin-3.0-mistral-24b',
        prompt: [
          {
            content: message.trim(),
            role: 'user'
          }
        ],
        systemPrompt: systemPrompt || '',
        conversationType: 'text',
        temperature: temperature || 0.8,
        webEnabled: true,
        topP: 0.9,
        isCharacter: false,
        clientProcessingTime: 15
      }),
      timeout: 60000
    });

    if (!data) {
      throw new Error("No response received from Venice AI.")
    }

    // Parse streaming response format
    const chunks = data.split('\n')
      .filter(chunk => chunk && chunk.trim() !== '')
      .map(chunk => JSON.parse(chunk));
    
    const result = chunks.map(chunk => chunk.content).join('');
    
    return result;
  } catch (error) {
    console.error("Venice AI Error:", error.message)
    throw new Error("Could not get response from Venice AI.")
  }
}

/* ===============================
   EXPORT API (STYLE LAMA KAMU)
================================ */
export default {
  name: "Venice AI Chat",
  description: "Venice AI (dolphin-3.0-mistral-24b)",
  category: "AI CHAT",
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
      const { teks, temperature, system } = req.query

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi",
        })
      }

      const ai = await veniceChat(
        teks.trim(),
        system || "",
        temperature ? Number(temperature) : 0.8
      )

      res.json({
        status: true,
        input: teks.trim(),
        result: ai,
        timestamp: Date.now(),
      })
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Venice AI request failed",
      })
    }
  },
}