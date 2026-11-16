/**
 * Bing Search — Bing Web Search
 * Source: https://gist.githubusercontent.com/ayashiiiyo/f9c6b2963c49962fab92b009cb4689cc/raw/c20644a25389bb14e9e539557973e328c591f1cf/bing.mjs
 * API: https://www.bingapis.com/api/v7/search
 *
 * Endpoint ini melakukan pencarian web menggunakan Bing Search API.
 */

const SEARCH_APPID = "8B3803673894068AC59BD9DA9BC2B4D382C6227E";
const BING_APIS_BASE = "https://www.bingapis.com/api/v7";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function decodeBingUrl(url) {
  const match = url.match(/(?:[?&]|&amp;)u=a1([a-zA-Z0-9_\\-]+)/);
  if (!match) return url;
  try {
    let b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return url;
  }
}

export default {
  name: "Bing Search",
  description:
    "Pencarian web menggunakan Bing Search API. " +
    "Kirim query, dapat hasil pencarian web dari Bing.",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query"],

  paramsSchema: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian",
      example: "bisa apa"
    },
    count: {
      type: "number",
      required: false,
      description: "Jumlah hasil (default: 10, maks: 50)",
      default: 10
    },
    offset: {
      type: "number",
      required: false,
      description: "Offset hasil (default: 0)",
      default: 0
    },
    lang: {
      type: "string",
      required: false,
      description: "Bahasa (default: id)",
      default: "id"
    },
    country: {
      type: "string",
      required: false,
      description: "Negara (default: ID)",
      default: "ID"
    }
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.body, ...req.query };
      const query = String(params.query ?? "").trim();
      const count = Math.min(Number(params.count) || 10, 50);
      const offset = Math.max(Number(params.offset) || 0, 0);
      const lang = String(params.lang ?? "id").toLowerCase();
      const country = String(params.country ?? "ID").toUpperCase();

      if (!query) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi.",
          api_time: `${Date.now() - startTime}ms`
        });
      }

      try {
        const urlParams = new URLSearchParams({
          appid: SEARCH_APPID,
          q: encodeURIComponent(query),
          cc: country,
          setlang: lang,
          responseFilter: "Webpages",
          count: String(count),
          offset: String(offset)
        });
        const apiRes = await fetch(`${BING_APIS_BASE}/search?${urlParams.toString()}`, {
          headers: { "User-Agent": USER_AGENT }
        });
        if (apiRes.ok) {
          const data = await apiRes.json();
          const pages = data.webPages?.value || [];
          if (pages.length > 0) {
            return res.json({
              status: true,
              query,
              count: pages.length,
              results: pages.slice(0, count).map((item) => ({
                title: item.name || "",
                url: item.url || "",
                snippet: item.snippet || "",
                dateLastCrawled: item.dateLastCrawled || ""
              })),
              api_time: `${Date.now() - startTime}ms`,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch {}

      // Fallback ke Bing web search langsung
      const fallbackUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${lang}&cc=${country}&first=${offset + 1}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { "User-Agent": USER_AGENT }
      });
      if (!fallbackRes.ok) {
        throw new Error(`Bing Search HTTP ${fallbackRes.status}`);
      }
      const html = await fallbackRes.text();
      const blocks = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/g) || [];

      return res.json({
        status: true,
        query,
        count: blocks.length,
        results: blocks.slice(0, count).map((b) => {
          const h2Match = b.match(/<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
          const link = h2Match ? decodeBingUrl(h2Match[1]) : "";
          const title = h2Match ? h2Match[2].replace(/<[^>]+>/g, "").trim() : "";
          const pMatch = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
          const snippet = pMatch ? pMatch[1].replace(/<[^>]+>/g, "").trim() : "";
          return { title, url: link, snippet };
        }),
        api_time: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[bing-search] ${err.message || err}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses Bing Search.",
        api_time: `${Date.now() - startTime}ms`
      });
    }
  }
};
