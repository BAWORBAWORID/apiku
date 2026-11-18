/**
 * NSFW Rule34 API (Direct Image Response)
 * Search Rule34 and return a random image as direct binary (no JSON link).
 *
 * Endpoint:
 *   GET /api/nsfw/rule34?query=<tags>
 *   GET /api/nsfw/rule34?q=<tags>
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import axios from "axios";

let config = {};
try {
  ({ config } = await import("#root/config.js"));
} catch {}

const USER_ID =
  config?.apikey?.rule34?.user_id || process.env.RULE34_USER_ID || "7010186";
const API_KEY =
  config?.apikey?.rule34?.api_key ||
  process.env.RULE34_API_KEY ||
  "dbcb6813a47b997a07ceedbe4eaef3b0e38c0d0fdb5665642622e49af6b2239c9232945c552358cde2cd92bf377ed7b33cf1b784993aa121b2c45b9468bcde35";
const API_URL = "https://api.rule34.xxx/index.php";

async function searchRule34(query = "", { limit = 20 } = {}) {
  const tags = String(query).trim().split(/\s+/).filter(Boolean).join(" ");
  if (!tags) throw new Error('Parameter "query" diperlukan');

  const { data } = await axios.get(API_URL, {
    params: {
      page: "dapi",
      s: "post",
      q: "index",
      json: 1,
      limit: limit * 2,
      tags,
      user_id: USER_ID,
      api_key: API_KEY,
    },
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!Array.isArray(data) || !data.length) {
    throw new Error(`Tidak ditemukan hasil untuk "${tags}"`);
  }

  const images = data.filter(
    (p) => p?.file_url && /\.(jpe?g|png)$/i.test(p.file_url)
  );

  if (!images.length) {
    throw new Error(`Tidak ditemukan gambar untuk "${tags}"`);
  }

  return images.slice(0, limit).map((p) => ({
    id: p.id,
    file_url: p.file_url,
    score: p.score || 0,
    rating: p.rating || "unknown",
  }));
}

export default {
  name: "NSFW Rule34",
  description: "Cari gambar Rule34 berdasarkan tag dan kirim langsung sebagai gambar (jpg/png)",
  category: "NSFW",
  methods: ["GET"],
  params: ["query"],

  async run(req, res) {
    try {
      const query =
        req.query?.query ||
        req.query?.q ||
        req.query?.tags ||
        req.query?.search ||
        "";

      if (!String(query).trim()) {
        return res
          .status(400)
          .json({ status: false, message: 'Parameter "query" diperlukan' });
      }

      const posts = await searchRule34(query, { limit: 20 });
      const candidates = [...posts].sort(() => Math.random() - 0.5).slice(0, 5);

      for (const post of candidates) {
        try {
          const resp = await fetch(post.file_url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Referer: "https://rule34.xxx/",
            },
            redirect: "follow",
          });

          if (!resp.ok) continue;

          const arrayBuf = await resp.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          if (!buffer.length) continue;

          let contentType = resp.headers.get("content-type") || "";
          if (!/^image\//i.test(contentType)) {
            contentType = /\.png(\?|$)/i.test(post.file_url)
              ? "image/png"
              : "image/jpeg";
          }

          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Length", buffer.length);
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
          );
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.setHeader("Surrogate-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Vary", "*");
          res.setHeader("X-Rule34-Post-Id", String(post.id || ""));

          return res.end(buffer);
        } catch {
          // coba kandidat berikutnya
        }
      }

      return res
        .status(502)
        .json({ status: false, message: "Gagal mengambil gambar dari sumber" });
    } catch (err) {
      const msg = err?.message || "Service unavailable";
      const code = /Parameter "query" diperlukan/.test(msg) ? 400 : 503;
      return res.status(code).json({ status: false, message: msg });
    }
  },
};
