/**
 * WhatsApp Channel Reaction (VIP)
 * GET/POST /api/fun/reach-ch-vip
 */

const ENDPOINT = "https://apis.davidcyriltech.my.id/tools/wareact";

export default {
  name: "WhatsApp Channel Reaction VIP",
  description: "Send reactions to WhatsApp channel posts",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["link", "emoji"],
  paramsSchema: {
    link: "string",
    emoji: "string"
  },
  async run(req, res) {
    try {
      const { link, emoji } = req.method === 'POST' ? req.body : req.query;

      if (!link || !emoji) {
        return res.json({
          success: false,
          message: 'Parameter "link" dan "emoji" wajib diisi.'
        });
      }

      const apiUrl = `${ENDPOINT}?link=${encodeURIComponent(link)}&emoji=${encodeURIComponent(emoji)}`;

      const response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
          "Referer": "https://wa.dclabs.my.id/",
        },
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
        if (data && typeof data === 'object') {
          delete data.creator;
        }
      } catch {
        data = { success: false, rawText: text };
      }

      return res.json(data);
    } catch (e) {
      return res.json({ success: false, message: e.message });
    }
  },
};
