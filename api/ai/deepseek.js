/**
 * DeepSeek AI Chat
 * Provider: notegpt.io
 * Parameter: teks
 * NO API KEY
 */

import axios from "axios";

/* ===============================
   DEEPSEEK CLIENT FUNCTION
================================ */
async function deepseekAI(message, model = "deepseek-chat") {
  try {
    if (!message || message.trim().length === 0) {
      throw new Error("Message cannot be empty.");
    }

    // Generate conversation ID
    const conversationId = Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 10);
    
    const url = "https://notegpt.io/api/v2/chat/stream";
    
    const payload = {
      message: message.trim(),
      language: "auto",
      model: model,
      tone: "default",
      length: "moderate",
      conversation_id: conversationId,
      image_urls: [],
      chat_mode: "standard"
    };

    const headers = {
      "Content-Type": "application/json",
      "Origin": "https://notegpt.io",
      "Referer": "https://notegpt.io/chat",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    const response = await axios.post(url, payload, {
      headers,
      responseType: "stream",
      timeout: 60000
    });

    return new Promise((resolve, reject) => {
      let fullText = "";
      let buffer = "";

      response.data.on("data", chunk => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const json = JSON.parse(jsonStr);
            
            // Handle different response formats
            if (json.text) {
              fullText += json.text;
            } else if (json.choices?.[0]?.delta?.content) {
              fullText += json.choices[0].delta.content;
            } else if (json.content) {
              fullText += json.content;
            }
            
            // Check if stream is complete
            if (json.done || json.finished) {
              resolve({
                success: true,
                response: fullText.trim() || "No response generated",
                model: model,
                conversation_id: conversationId
              });
            }
          } catch (e) {
            // Skip parsing errors
            continue;
          }
        }
      });

      response.data.on("end", () => {
        resolve({
          success: true,
          response: fullText.trim() || "No response generated",
          model: model,
          conversation_id: conversationId
        });
      });

      response.data.on("error", (err) => {
        reject(new Error(`Stream error: ${err.message}`));
      });
    });

  } catch (error) {
    console.error("DeepSeek Error:", error.message);
    
    if (error.response) {
      throw new Error(`API Error (${error.response.status}): ${error.response.data?.message || error.response.statusText}`);
    }
    throw new Error(`Could not get response from DeepSeek: ${error.message}`);
  }
}

/* ===============================
   EXPORT API
================================ */
export default {
  name: "DeepSeek AI Chat",
  description: "DeepSeek AI Chat - No API Key Required",
  category: "AI CHAT",
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

      const { teks } = req.query;

      if (!teks || typeof teks !== "string" || teks.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi"
        });
      }

      const ai = await deepseekAI(teks.trim(), "deepseek-chat");

      res.json({
        status: true,
        provider: "notegpt.io",
        model: "deepseek-chat",
        input: teks.trim(),
        result: ai.response || "No response generated",
        conversation_id: ai.conversation_id,
        timestamp: Date.now()
      });

    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "DeepSeek request failed"
      });
    }
  }
};