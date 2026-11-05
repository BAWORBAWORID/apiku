/**
 * Netflix Token Generator
 * GET /api/fun/netflix
 * Source: nftokengenkuu.vercel.app (primary) | token-netflix.vercel.app (fallback)
 */

const SOURCE_PRIMARY   = "https://nftokengenkuu.vercel.app/api/generate";
const SOURCE_FALLBACK  = "https://token-netflix.vercel.app/api/generate";

function buildLinks(token) {
  return {
    android: `https://netflix.com/unsupported?nftoken=${token}`,
    pc:      `https://netflix.com/?nftoken=${token}`,
    tv:      `https://netflix.com/tv2?nftoken=${token}`,
  };
}

/** Ambil token dari nftokengenkuu (format baru) */
async function fetchPrimary() {
  const res = await fetch(SOURCE_PRIMARY, {
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Primary HTTP ${res.status}`);
  const json = await res.json();
  if (!json.status || !json.data?.token) throw new Error("Primary: token kosong");

  const d = json.data;
  return {
    token:    d.token,
    raw_url:  d.raw_url || null,
    expires:  d.expires || null,
    links:    d.links ? {
      android: d.links.mobile  || buildLinks(d.token).android,
      pc:      d.links.desktop || buildLinks(d.token).pc,
      tv:      d.links.tv      || buildLinks(d.token).tv,
    } : buildLinks(d.token),
    details:  d.details || null,
  };
}

/** Ambil token dari token-netflix (format lama, fallback) */
async function fetchFallback() {
  const res = await fetch(SOURCE_FALLBACK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: 1, stream: false }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
  const json = await res.json();
  const item = Array.isArray(json.data) ? json.data[0] : null;
  if (!item?.token) throw new Error("Fallback: token kosong");

  return {
    token:   item.token,
    raw_url: null,
    expires: item.expiry || null,
    links:   buildLinks(item.token),
    details: null,
  };
}

export default {
  name:        "Netflix Token Generator",
  description: "Generate Netflix token gratis (dual-source)",
  category:    "Fun",
  methods:     ["GET"],
  params:      [],
  paramsSchema: {},

  async run(req, res) {
    let result = null;
    let error  = null;

    try {
      result = await fetchPrimary();
    } catch (e) {
      error = `Primary failed: ${e.message}`;
      try {
        result = await fetchFallback();
      } catch (e2) {
        return res.json({
          status:  false,
          message: `Semua source gagal. ${error} | Fallback: ${e2.message}`,
        });
      }
    }

    return res.json({
      status: true,
      result,
    });
  },
};
