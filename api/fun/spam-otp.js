/**
 * Spam OTP API
 * GET/POST /api/fun/spam-otp
 */

export default {
  name: "Spam OTP",
  description: "Kirim request OTP massal ke nomor telepon",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["number"],
  paramsSchema: {
    number: "string"
  },
  async run(req, res) {
    try {
      const { number } = req.method === 'POST' ? req.body : req.query;
      const targetNumber = number || req.query.phone || req.body?.phone || "";

      if (!targetNumber) {
        return res.status(400).json({
          status: false,
          message: 'Parameter "number" wajib diisi.'
        });
      }

      const apiUrl = "https://flox-spamotp.vercel.app/api";
      const payload = {
        action: "request_otp",
        phone: targetNumber
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Paradox-Token": "PARADOX_SUPER_SECRET_998877",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
          "Referer": "https://flox-spamotp.vercel.app/",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
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

      return res.status(response.status).json({
        status: response.ok,
        data: data,
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message,
      });
    }
  },
};
