/**
 * Quilbot AI Chat API - Super Simple GET
 * Provider: quillbot.com
 * Parameter: teks
 * NO API KEY
 */

import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar, Cookie } from 'tough-cookie';
import { v4 as uuidv4 } from 'uuid';

// Generate fake ID
const fakeId = () => uuidv4();
const anonId = () => Math.random().toString(16).substring(2, 18);

// Simple GET handler
export default {
  name: "Quilbot AI",
  description: "Quilbot AI Chat",
  category: "AI CHAT",
  methods: ["GET"],
  params: ["teks"],  
  paramsSchema: {
    teks: { 
      type: "string", 
      required: true,
      description: "Pertanyaan atau teks untuk Quily AI"
    }
  },
  
  async run(req, res) {
    try {
      // Ambil parameter teks dari query
      const { teks } = req.query;
      
      // Validasi
      if (!teks || !teks.trim()) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'teks' wajib diisi!",
          contoh: "/api/ai/quily-ai?teks=Halo"
        });
      }

      console.log(`[Quilbot] Request: ${teks.substring(0, 30)}...`);

      // Setup cookies
      const jar = new CookieJar();
      const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        baseURL: 'https://quillbot.com',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'platform-type': 'webapp',
          'webapp-version': '40.75.2',
          'qb-product': 'AI-CHAT'
        },
        timeout: 30000
      }));

      // Set cookies
      const deviceId = fakeId();
      const anonID = anonId();
      const opts = { domain: 'quillbot.com', path: '/' };
      
      await jar.setCookie(new Cookie({ key: 'qbDeviceId', value: deviceId, ...opts }), 'https://quillbot.com');
      await jar.setCookie(new Cookie({ key: 'anonID', value: anonID, ...opts }), 'https://quillbot.com');
      await jar.setCookie(new Cookie({ key: 'ajs_anonymous_id', value: deviceId, ...opts }), 'https://quillbot.com');

      // Visit & spam check
      await client.get('/ai-chat');
      await client.get('/api/auth/spam-check');

      // Kirim chat
      const chatId = fakeId();
      const response = await client.post(`/api/ai-chat/chat/conversation/${chatId}`, {
        message: { 
          content: teks.trim(), 
          files: [] 
        },
        context: {},
        tools: { web_search_builtin: {} },
        origin: { 
          name: 'ai-chat.chat', 
          url: 'https://quillbot.com' 
        }
      }, {
        responseType: 'stream'
      });

      // Baca response
      let hasil = '';
      for await (const chunk of response.data) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line?.trim()?.startsWith('{')) {
            try {
              const json = JSON.parse(line);
              if (json.type === 'content' && json.content) {
                hasil += json.content;
              }
            } catch {
              continue;
            }
          }
        }
      }

      // Return response
      return res.status(200).json({
        status: true,
        //provider: "Quilbot AI",
        //input: teks.trim(),
        result: hasil || "Maaf, tidak ada response",
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('[Quilbot Error]:', error.message);
      
      return res.status(500).json({
        status: false,
        message: error.message || "Gagal memproses request",
        saran: "Coba lagi nanti"
      });
    }
  }
};