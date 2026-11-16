/**
 * Bing Visual Search — Bing Visual Search (Search by Image)
 * Source: https://gist.githubusercontent.com/ayashiiiyo/f9c6b2963c49962fab92b009cb4689cc/raw/c20644a25389bb14e9e539557973e328c591f1cf/bing.mjs
 * API: https://www.bing.com/images/search?view=detailv2
 *
 * Endpoint ini melakukan pencarian visual menggunakan Bing Visual Search (search by image URL).
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default {
  name: "Bing Visual Search",
  description:
    "Pencarian visual menggunakan Bing Visual Search (search by image URL). " +
    "Kirim URL gambar, dapat hasil pencarian visual dari Bing.",
  category: "Image",
  methods: ["GET", "POST"],
  params: ["image_url"],

  paramsSchema: {
    image_url: {
      type: "string",
      required: true,
      description: "URL gambar yang akan dicari secara visual",
      example: "https://example.com/cat.jpg"
    },
    count: {
      type: "number",
      required: false,
      description: "Jumlah hasil (default: 10, maks: 50)",
      default: 10
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.body, ...req.query };
      const imageUrl = String(params.image_url ?? "").trim();
      const count = Math.min(Number(params.count) || 10, 50);

      if (!imageUrl) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'image_url' wajib diisi.",
          api_time: `${Date.now() - startTime}ms`
        });
      }

      // Validasi URL
      try {
        new URL(imageUrl);
      } catch {
        return res.status(400).json({
          status: false,
          message: "Parameter 'image_url' harus berupa URL yang valid.",
          api_time: `${Date.now() - startTime}ms`
        });
      }

      const encoded = encodeURIComponent(imageUrl);
      const url = `https://www.bing.com/images/search?view=detailv2&iss=SBI&form=L2MS03&sbisrc=UrlPaste&q=imgurl:${encoded}`;

      const resBing = await fetch(url, {
        headers: { "User-Agent": USER_AGENT }
      });

      if (!resBing.ok) {
        return res.status(resBing.status).json({
          status: false,
          message: `Bing Visual Search HTTP ${resBing.status}`,
          api_time: `${Date.now() - startTime}ms`
        });
      }

      const html = await resBing.text();
      const match = html.match(/\/search\?format=rss&amp;q=([^&]+)&amp;bcid=([^&"]+)/);
      const recognizedQuery = match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
      const bcid = match ? match[2] : "";

      // Jika ada recognized query, lakukan pencarian gambar berdasarkan query tersebut
      let similarImages = [];
      if (recognizedQuery) {
        try {
          const imageSearchUrl = `https://www.bing.com/images/async?q=${encodeURIComponent(recognizedQuery)}&first=1&count=${count}&mmasync=1`;
          const imgRes = await fetch(imageSearchUrl, {
            headers: { "User-Agent": USER_AGENT }
          });
          if (imgRes.ok) {
            const imgHtml = await imgRes.text();
            const rawMatches = imgHtml.match(/m="(\{[^\"]+\})"/g) || [];
            for (const m of rawMatches) {
              if (similarImages.length >= count) break;
              try {
                const clean = m.slice(3, -1).replace(/&quot;/g, '"');
                const j = JSON.parse(clean);
                similarImages.push({
                  title: j.t || "",
                  url: j.murl || "",
                  thumbnailUrl: j.turl || "",
                  sourceUrl: j.purl || "",
                  description: j.desc || ""
                });
              } catch {}
            }
          }
        } catch {}
      }

      return res.json({
        status: true,
        image_url: imageUrl,
        recognizedQuery,
        bcid,
        count: similarImages.length,
        similar_images: similarImages,
        api_time: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[bing-visual] ${err.message || err}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses Bing Visual Search.",
        api_time: `${Date.now() - startTime}ms`
      });
    }
  }
};
