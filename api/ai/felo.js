import axios from "axios"

/**
 * Felo AI Chat API
 * Parameter: teks
 * NO API KEY
 */

/* ===============================
   FELO CLIENT FUNCTION
================================ */
async function askFelo(message) {
  try {
    if (!message || typeof message !== "string" || message.trim() === "") {
      throw new Error("Message cannot be empty.")
    }

    const headers = {
      Accept: "*/*",
      "User-Agent": "Postify/1.0.0",
      "Content-Encoding": "gzip, deflate, br, zstd",
      "Content-Type": "application/json",
      Origin: "https://felo.ai",
      Referer: "https://felo.ai/",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
    }

    const payload = {
      query: message.trim(),
      search_uuid: Date.now().toString(),
      search_options: { langcode: "id-MM" },
      search_video: true,
    }

    const parseStreamResponse = (data) => {
      const result = { answer: "", source: [] }
      
      const lines = data.split('\n')
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const jsonStr = line.slice(5).trim()
            if (!jsonStr) continue
            
            const parsed = JSON.parse(jsonStr)
            if (parsed.data) {
              // Extract answer text
              if (parsed.data.text) {
                result.answer = parsed.data.text.replace(/\d+/g, "").trim()
              }
              
              // Extract sources
              if (parsed.data.sources && Array.isArray(parsed.data.sources)) {
                result.source = parsed.data.sources
              }
            }
          } catch (e) {
            continue
          }
        }
      }
      
      return result
    }

    const response = await axios.post(
      "https://api.felo.ai/search/threads",
      payload,
      {
        headers,
        timeout: 45000,
        responseType: 'text',
        validateStatus: function (status) {
          return status >= 200 && status < 500
        }
      }
    )

    if (!response.data || typeof response.data !== 'string') {
      throw new Error('Invalid response format from Felo AI')
    }

    const result = parseStreamResponse(response.data)
    
    // If no answer but we have sources
    if (!result.answer && result.source.length > 0) {
      result.answer = "I found relevant sources but couldn't generate a complete answer."
    }
    
    // If completely empty response
    if (!result.answer && result.source.length === 0) {
      throw new Error('Felo AI returned no results for your query')
    }

    return result
    
  } catch (error) {
    console.error("Felo Error:", error.message)
    
    if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - Felo AI is taking too long to respond')
    }
    
    if (error.response) {
      const status = error.response.status
      if (status === 429) {
        throw new Error('Rate limit exceeded - Too many requests to Felo AI')
      } else if (status === 403) {
        throw new Error('Access forbidden - Check Felo AI access')
      } else if (status >= 500) {
        throw new Error('Felo AI server error')
      }
    }
    
    throw new Error("Failed to get response from Felo AI: " + error.message)
  }
}

/* ===============================
   EXPORT API (BLACKBOX-STYLE STRUCTURE)
================================ */
export default {
  name: "Felo AI",
  description: "This API endpoint allows you to get an AI-generated response from Felo using query parameters. Felo is an AI service capable of processing natural language queries and providing structured answers, including potential sources. This endpoint is suitable for quick, text-based interactions, such as question-answering, summarization, or general information retrieval. The response includes the AI's answer and a list of sources if available.",
  category: "AI Chat",
  methods: ["GET"],
  params: ["teks"],
  paramsSchema: {
    teks: { 
      type: "string", 
      required: true,
      description: "Pertanyaan atau teks untuk Felo AI"
    },
  },

  async run(req, res) {
    try {
      const { teks } = req.query

      if (!teks || typeof teks !== "string" || teks.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi",
        })
      }

      if (teks.length > 1000) {
        return res.status(400).json({
          status: false,
          message: "Teks terlalu panjang (maksimal 1000 karakter)",
        })
      }

      const result = await askFelo(teks)

      res.json({
        status: true,
        //provider: "felo",
        //input: teks.trim(),
        result: {
          answer: result.answer,
          sources: result.source
        },
        timestamp: Date.now(),
      })
      
    } catch (err) {
      let statusCode = 500
      let errorMessage = err.message || "Felo AI request failed"
      
      // Custom error mapping
      if (err.message.includes('timeout')) {
        statusCode = 504
      } else if (err.message.includes('Rate limit')) {
        statusCode = 429
      } else if (err.message.includes('forbidden') || err.message.includes('access')) {
        statusCode = 403
      } else if (err.message.includes('no results') || err.message.includes('no response')) {
        statusCode = 404
      }
      
      res.status(statusCode).json({
        status: false,
        message: errorMessage,
      })
    }
  },
}