import axios from 'axios';

export default {
  name: "Scite AI Research",
  description: "AI research assistant powered by GPT-5 Nano with academic citations and references",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["teks"],
  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Research question or message",
      example: "What are the latest findings on quantum computing?",
      minLength: 1,
      maxLength: 10000
    }
  },
  async run(req, res) {
    const { teks } = { ...req.query, ...req.body };
    if (!teks) return res.status(400).json({ success: false, message: 'Parameter "teks" is required' });

    try {
      // Get cookies first
      const cookieRes = await axios.get('https://scite.ai/assistant', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36' }
      });
      const cookies = (cookieRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://scite.ai',
        'Referer': 'https://scite.ai/assistant',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        ...(cookies && { 'Cookie': cookies })
      };

      const pollResponse = await axios.post('https://api.scite.ai/assistant/poll', {
        turns: [{ role: "user", content: teks }],
        user_input: teks,
        session_id: null,
        recaptcha_token: null,
        country: null,
        alwaysUseReferences: false,
        neverUseReferences: false,
        abstractsOnly: false,
        fullTextsOnly: false,
        numReferences: 25,
        rankBy: "all",
        answerLength: "medium",
        model: "gpt-5-nano-2025-08-07",
        reasoningEffort: "minimal",
        yearFrom: "",
        yearTo: "",
        topics: [],
        journals: [],
        citationSections: [],
        publicationTypes: [],
        citationStyle: "apa",
        dashboards: [],
        referenceChecks: [],
        dois: [],
        useStructuredResponse: false,
        usePatentMode: false,
        useMixedPatentMode: false,
        anon_id: "978f290b-548b-46fb-b51b-7863e420b484"
      }, { headers });

      const taskId = pollResponse.data.id;
      let fullResponse = '';
      let status = '';

      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const taskResponse = await axios.get(`https://api.scite.ai/assistant/tasks/${taskId}`, {
          headers: { ...headers, 'Content-Type': undefined }
        });

        if (taskResponse.data.info?.response) {
          fullResponse = taskResponse.data.info.response;
          status = taskResponse.data.status;
          if (status === 'COMPLETED') break;
        }
      }

      if (!fullResponse) return res.status(500).json({ success: false, message: 'No response from Scite AI' });

      res.json({
        success: true,
        result: {
          response: fullResponse,
          model: "gpt-5-nano-2025-08-07",
          status: status,
          citations: 25
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};
