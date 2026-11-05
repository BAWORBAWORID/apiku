/**
 * WhatsApp Channel Reaction (VIP)
 * GET/POST /api/fun/reach-ch-vip
 */

const API_URL = 'https://reactch20jiyyad.vercel.app/api/react';

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomIp() {
  return `${rand(1, 254)}.${rand(1, 254)}.${rand(1, 254)}.${rand(1, 254)}`;
}

function randomUa() {
  const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

function spoofHeaders() {
  const ip = randomIp();
  return {
    'Content-Type': 'application/json',
    'User-Agent': randomUa(),
    'X-Forwarded-For': `${ip}, ${randomIp()}`,
    'X-Real-IP': ip,
    'X-Client-IP': ip,
    'X-Originating-IP': ip,
    'CF-Connecting-IP': ip,
    'True-Client-IP': ip,
    'X-Cluster-Client-IP': ip,
    'Forwarded': `for=${ip};proto=https`,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://reactch20jiyyad.vercel.app',
    'Referer': 'https://reactch20jiyyad.vercel.app/',
    'sec-ch-ua': '"Google Chrome";v="131", "Not_A Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
}

export default {
  name: 'WhatsApp Channel Reaction VIP',
  description: 'Kirim reaction emoji ke postingan WhatsApp Channel.',
  category: 'Fun',
  methods: ['GET', 'POST'],
  params: ['link', 'emoji'],

  paramsSchema: {
    link: {
      type: 'string',
      required: true,
      description: 'URL postingan WhatsApp Channel (harus include ID post)',
      example: 'https://whatsapp.com/channel/0029Vb8kYQcK5cDFoQ3NAK2x/141',
      default: ''
    },
    emoji: {
      type: 'string',
      required: true,
      description: 'Emoji reaction (bisa banyak, pisah koma)',
      example: '🥵',
      default: ''
    }
  },

  async run(req, res) {
    const start = Date.now();
    const { link, emoji } = { ...req.query, ...req.body };

    if (!link || !emoji) {
      return res.status(400).json({
        status: false,
        message: 'Parameter "link" dan "emoji" wajib diisi.'
      });
    }

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: spoofHeaders(),
        body: JSON.stringify({ url: link, reaction: emoji }),
        signal: AbortSignal.timeout(60000)
      });

      const data = await response.json();
      const r = data.result || {};

      return res.json({
        status: data.status ?? false,
        target: r.target || link,
        reactions: r.reactions || [],
        total: r.total_emojis ?? 0,
        message: r.message || data.message || null,
        task_status: r.task?.status || null
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal mengirim reaction.',
        responseTime: `${Date.now() - start}ms`
      });
    }
  }
};
