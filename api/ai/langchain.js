import axios from 'axios';

export default {
  name: "LangChain AI Chat",
  description: "LangChain AI chat powered by Gemini 3.1 Flash Lite",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Chat message",
      example: "Hello, how are you?",
      minLength: 1,
      maxLength: 10000
    }
  },
  async run(req, res) {
    const { teks } = { ...req.query, ...req.body };
    if (!teks) return res.status(400).json({ success: false, message: 'Parameter "teks" is required' });

    try {
      const threadId = 'e07edfc1-c35b-40ea-a9dd-9a065a637e22';
      const userId = 'user-601c46d0-f9f5-46ea-84b5-4ba70916dc4f';

      const response = await axios.post(
        `https://chat-langchain-external-707c6e45e5075e168a6835a7d23a9934.us.langgraph.app/threads/${threadId}/runs/stream`,
        {
          input: {
            messages: [{ role: "user", content: teks }]
          },
          config: {
            recursion_limit: 100,
            tags: ["Chat-LangChain", "docs_agent"],
            metadata: {
              user_id: userId,
              source_type: "Chat-LangChain",
              graph: "docs_agent"
            },
            configurable: {
              model: "google_genai:gemini-3.1-flash-lite",
              model_provider: "google"
            }
          },
          stream_mode: ["values", "updates", "messages"],
          stream_subgraphs: true,
          assistant_id: "docs_agent",
          if_not_exists: "create"
        },
        {
          headers: {
            'Authorization': `Bearer ${userId}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream',
          timeout: 60000
        }
      );

      const result = await new Promise((resolve, reject) => {
        let fullResponse = '';
        let buffer = '';

        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (line.startsWith('event: messages/partial')) continue;
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                if (Array.isArray(data) && data[0]?.content) {
                  for (const item of data[0].content) {
                    if (item.type === 'text' && item.text && item.text.length > fullResponse.length) {
                      fullResponse = item.text;
                    }
                  }
                }
              } catch (e) {}
            }
          }
        });

        response.data.on('end', () => resolve(fullResponse));
        response.data.on('error', reject);
      });

      if (!result) return res.status(500).json({ success: false, message: 'Empty response from LangChain' });

      res.json({
        success: true,
        result: {
          response: result,
          model: "gemini-3.1-flash-lite",
          provider: "google"
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};
