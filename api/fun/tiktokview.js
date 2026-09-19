const BASE_URL = 'https://clooud.my.id/api/tiktokview/?url=';

export default {
  name: "Tiktok View Free",
  description: "Suntik Tiktok View Dengan Cepat",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video TikTok yang ingin disuntik view",
      example: "https://vt.tiktok.com/ZSxG2tLqL/",
    }
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const cleanUrl = url.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(BASE_URL + encodeURIComponent(cleanUrl), {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const result = await response.json();

      const match = cleanUrl.match(/(@[\w.-]+)/);
      const attribution = match ? match[1] : "Unknown";

      res.status(200).json({
        statusCode: 200,
        status: true,
        result: {
          data: result.data || result
        },
        timestamp: new Date().toISOString(),
        attribution: attribution
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: 'Gagal mengambil data dari server',
        error: err.message,
        timestamp: Date.now(),
      });
    }
  },
};
