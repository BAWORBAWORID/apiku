/**
 * Bing Image Search — Bing Image Search
 * Source: https://gist.githubusercontent.com/ayashiiiyo/f9c6b2963c49962fab92b009cb4689cc/raw/c20644a25389bb14e9e539557973e328c591f1cf/bing.mjs
 * API: https://www.bing.com/images/async
 *
 * Endpoint ini melakukan pencarian gambar menggunakan Bing Image Search.
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default {
  name: "Bing Image Search",
  description:
    "Pencarian gambar menggunakan Bing Image Search. " +
    "Kirim query, dapat hasil gambar dari Bing.",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian gambar",
      example: "kucing"
    },
    count: {
      type: "number",
      required: false,
      description: "Jumlah hasil (default: 20, maks: 50)",
      default: 20
    },
    offset: {
      type: "number",
      required: false,
      description: "Offset hasil (default: 0)",
      default: 0
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.body, ...req.query };
      const query = String(params.query ?? "").trim();
      const count = Math.min(Number(params.count) || 20, 50);
      const offset = Math.max(Number(params.offset) || 0, 0);

      if (!query) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi.",
          api_time: `${Date.now() - startTime}ms`
        });
      }

      const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=${offset + 1}&count=${count}&mmasync=1`;
      const resBing = await fetch(url, {
        headers: { "User-Agent": USER_AGENT }
      });

      if (!resBing.ok) {
        return res.status(resBing.status).json({
          status: false,
          message: `Bing Image Search HTTP ${resBing.status}`,
          api_time: `${Date.now() - startTime}ms`
        });
      }

      const html = await resBing.text();
      const rawMatches = html.match(/m="(\{[^\"]+\})"/g) || [];

      const results = [];
      for (const m of rawMatches) {
        if (results.length >= count) break;
        try {
          const clean = m.slice(3, -1).replace(/&quot;/g, '"');
          const j = JSON.parse(clean);
          results.push({
            title: j.t || "",
            url: j.murl || "",
            thumbnailUrl: j.turl || "",
            sourceUrl: j.purl || "",
            description: j.desc || ""
          });
        } catch {}
      }

      return res.json({
        status: true,
        query,
        count: results.length,
        results,
        api_time: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[bing-image] ${err.message || err}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses Bing Image Search.",
        api_time: `${Date.now() - startTime}ms`
      });
    }
  }
};
