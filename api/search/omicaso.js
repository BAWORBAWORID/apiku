/**
 * Omicaso Manga Catalog — omicaso.org (API internal api/manga.php)
 * Endpoint: /api/search/omicaso
 *
 * GET  /api/search/omicaso?q=<query>&page=1        — search
 * GET  /api/search/omicaso                         — katalog terbaru (page 1)
 * GET  /api/search/omicaso?genre=action&page=1     — filter genre
 * GET  /api/search/omicaso?slug=<slug>             — detail manga + chapters
 * GET  /api/search/omicaso?stats=1                 — statistik katalog
 * POST /api/search/omicaso  (JSON: { q | genre | slug, page })
 */

const BASE = "https://omicaso.org";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

async function api(params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}/api/manga.php?${qs}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function mapItem(it) {
  return {
    id: it.id || null,
    title: it.title,
    alternative_name: it.alternative_name || null,
    slug: it.slug,
    cover: it.cover || null,
    description: it.description || null,
    url: `${BASE}/manga.php?slug=${it.slug}`,
  };
}

export default {
  name: "Omicaso Manga Catalog",
  description: "Katalog manga/manhwa omicaso.org: search, filter genre, detail + daftar chapter (bahasa Indonesia)",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["q", "genre", "slug", "page", "stats"],
  paramsSchema: {
    q: { type: "string", required: false, description: "Search query manga", example: "one piece" },
    genre: { type: "string", required: false, description: "Filter genre (action, romance, drama, dll)" },
    slug: { type: "string", required: false, description: "Slug manga untuk detail + daftar chapter", example: "one-piece" },
    page: { type: "number", required: false, description: "Halaman katalog (default 1)", default: 1 },
    stats: { type: "boolean", required: false, description: "true = statistik katalog saja" },
  },

  async run(req, res) {
    const q = { ...req.query, ...req.body };
    const page = parseInt(q.page) || 1;

    try {
      // stats
      if (q.stats === "1" || q.stats === "true") {
        const d = await api({ page: 1 });
        return res.json({
          status: true,
          source: "omicaso.org",
          total: d.counts.all,
          general: d.counts.general,
          adult: d.counts.adult,
        });
      }

      // detail + chapters
      if (q.slug) {
        const r = await fetch(`${BASE}/manga.php?slug=${encodeURIComponent(q.slug)}`, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(45000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const html = await r.text();
        const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1]?.trim();
        const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
        const chapters = [...html.matchAll(/href="([^"]*chapter-[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
        const unique = [...new Set(chapters)];
        return res.json({
          status: true,
          source: "omicaso.org",
          title: title || q.slug,
          slug: q.slug,
          description: desc || null,
          url: `${BASE}/manga.php?slug=${q.slug}`,
          chapters_found: unique.length,
          chapters: unique,
        });
      }

      // search / genre / list
      const params = { page };
      if (q.q) params.q = String(q.q).trim();
      if (q.genre) params.genre = String(q.genre).trim();

      const d = await api(params);
      return res.json({
        status: true,
        source: "omicaso.org",
        mode: q.q ? "search" : q.genre ? `genre:${d.genre_name || q.genre}` : "latest",
        query: q.q || null,
        genre: d.genre_name || q.genre || null,
        page: d.page,
        total: d.total,
        has_more: d.has_more,
        counts: d.counts || null,
        items: (d.items || []).map(mapItem),
      });
    } catch (err) {
      return res.status(500).json({ status: false, error: err?.message || String(err) });
    }
  },
};
