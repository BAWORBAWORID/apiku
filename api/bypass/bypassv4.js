/**
 * SFL Bypass V4 — bypass shortlink sfl.gl via sflllxbypass2.vercel.app (SFL Bypass 2.0, JIYYAD TOOLS)
 * Endpoint: /api/bypass/bypassv4
 *
 * GET  /api/bypass/bypassv4?url=<safelink-url>
 * GET  /api/bypass/bypassv4                        (pakai contoh default)
 * POST /api/bypass/bypassv4  (JSON: { url })
 */

const BYPASS_API = "https://sflllxbypass2.vercel.app/api/bypass";
const DEFAULT_URL = "https://sfl.gl/mQdE";

export default {
  name: "SFL Bypass V4",
  description: "Bypass shortlink sfl.gl via SFL Bypass 2.0 (sflllxbypass2.vercel.app)",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL safelink yang mau di-bypass",
      default: DEFAULT_URL,
      example: "https://sfl.gl/mQdE",
    },
  },

  async run(req, res) {
    const q = { ...req.query, ...req.body };
    const url = String(q.url || DEFAULT_URL).trim();

    if (!url.startsWith("http")) {
      return res.status(400).json({ status: false, message: "Parameter url tidak valid" });
    }

    try {
      const r = await fetch(BYPASS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(90000),
      });
      const d = await r.json();

      if (d?.status && d?.result?.destination_url) {
        return res.json({
          status: true,
          credit: "sflllxbypass2.vercel.app (JIYYAD TOOLS)",
          input: url,
          result: {
            short_url: d.result.short_url || url,
            destination_url: d.result.destination_url,
          },
          time: d.time || null,
        });
      }

      return res.status(400).json({
        status: false,
        message: d?.error || "Gagal bypass. Link mungkin tidak didukung atau server tujuan tidak merespon.",
        time: d?.time || null,
      });
    } catch (err) {
      return res.status(500).json({ status: false, error: err?.message || String(err) });
    }
  },
};
