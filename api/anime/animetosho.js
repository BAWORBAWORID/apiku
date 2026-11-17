import * as cheerio from "cheerio";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function scrape(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Parameter 'url' wajib (URL halaman AnimeTosho).");
  }
  const targetUrl = url.trim();
  if (!/^https?:\/\/(www\.)?animetosho\.org\/view\//i.test(targetUrl)) {
    throw new Error("URL harus halaman AnimeTosho (/view/...).");
  }

  const res = await fetch(targetUrl, {
    headers: { "User-Agent": CHROME_UA, Referer: "https://animetosho.org/" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`AnimeTosho HTTP ${res.status}`);
  }
  const html = await res.text();

  const $ = cheerio.load(html);
  let title = $("title").first().text().trim();
  title = title
    .replace(/\s*\|\s*Anime Tosho.*$/i, "")
    .replace(/\s*-\s*Anime Tosho.*$/i, "")
    .trim();

  const thumbnail = $('meta[property="og:image"]').attr("content") || "";

  const authorMatch = title.match(/^\[([^\]]+)\]/);
  const author = authorMatch ? authorMatch[1] : "AnimeTosho";

  const downloads = [];
  const seen = new Set();

  $("a").each((_, a) => {
    const href = $(a).attr("href");
    const text = $(a).text().trim();
    if (
      href &&
      (href.includes("multiup") ||
        href.includes("storage") ||
        href.includes(".torrent") ||
        href.startsWith("magnet:"))
    ) {
      if (!seen.has(href)) {
        seen.add(href);
        let quality = "Direct Download";
        if (href.startsWith("magnet:")) quality = "Magnet URI";
        else if (href.includes(".torrent")) quality = "Torrent File";
        else if (text) quality = `DDL (${text})`;

        downloads.push({
          type: "video",
          quality,
          url: href,
        });
      }
    }
  });

  if (downloads.length === 0) {
    throw new Error("Tidak ada mirror/torrent ditemukan di halaman ini (rilis mungkin sudah dihapus).");
  }

  return {
    title,
    author,
    thumbnail,
    type: "video",
    downloads,
  };
}

export default {
  name: "AnimeTosho",
  description: "Ambil link download (torrent, magnet, DDL/mirror) dari halaman rilis AnimeTosho",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL halaman AnimeTosho (https://animetosho.org/view/...)",
      example: "https://animetosho.org/view/lupin-iii-legend-gold-babylon-1985-bdrip-1920x1080p.n2107640",
    },
  },

  async run(req, res) {
    const start = Date.now();
    const q = { ...(req.body || {}), ...(req.query || {}) };
    const url = String(q.url || "").trim();
    if (!url) {
      return res.status(400).json({ status: false, message: "Parameter 'url' wajib." });
    }

    try {
      const result = await scrape(url);
      return res.json({
        status: true,
        result,
        metadata: { processing_time: `${Date.now() - start}ms` },
        attribution: "@zyvorapi",
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err?.message || "Gagal mengambil data",
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  },
};
