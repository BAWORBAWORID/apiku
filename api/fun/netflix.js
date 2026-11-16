
/**
 * Netflix Token Generator
 * GET /api/fun/netflix
 * Source 1: nftokengenkuu.vercel.app (primary)
 * Source 2: token-netflix.vercel.app (fallback)
 * Source 3: nftokengenjiyyad.vercel.app (fallback 2)
 */

const SOURCE_PRIMARY = "https://nftokengenkuu.vercel.app/api/generate";
const SOURCE_FALLBACK = "https://token-netflix.vercel.app/api/generate";
const SOURCE_THIRD = "https://nftokengenjiyyad.vercel.app/api/generate";

function buildLinks(token) {
  return {
    android: `https://netflix.com/unsupported?nftoken=${token}`,
    pc: `https://netflix.com/?nftoken=${token}`,
    tv: `https://netflix.com/tv2?nftoken=${token}`,
  };
}

/** Source 1: nftokengenkuu (GET) */
async function fetchPrimary() {
  const res = await fetch(SOURCE_PRIMARY, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`Primary HTTP ${res.status}`);

  const json = await res.json();
  if (!json.status || !json.data?.token) {
    throw new Error("Primary: token kosong");
  }

  const d = json.data;
  const links = buildLinks(d.token);

  return {
    token: d.token,
    raw_url: d.raw_url || null,
    expires: d.expires || null,
    links: d.links ? {
      android: d.links.mobile || links.android,
      pc: d.links.desktop || links.pc,
      tv: d.links.tv || links.tv,
    } : links,
    details: d.details || null,
  };
}

/** Source 2: token-netflix (POST) */
async function fetchFallback() {
  const res = await fetch(SOURCE_FALLBACK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      count: 1,
      stream: false,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);

  const json = await res.json();
  const item = Array.isArray(json.data) ? json.data[0] : null;

  if (!item?.token) throw new Error("Fallback: token kosong");

  return {
    token: item.token,
    raw_url: null,
    expires: item.expiry || null,
    links: buildLinks(item.token),
    details: null,
  };
}

/** Source 3: nftokengenjiyyad (POST) */
async function fetchThird() {
  const res = await fetch(SOURCE_THIRD, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`Third HTTP ${res.status}`);

  const json = await res.json();

  if (!json.status || !json.result?.token) {
    throw new Error("Third: token kosong");
  }

  const d = json.result;
  const links = buildLinks(d.token);

  return {
    token: d.token,
    raw_url: null,
    expires: d.expiry || null,
    links: d.links ? {
      android: d.links.android || links.android,
      pc: d.links.pc || links.pc,
      tv: d.links.tv || links.tv,
    } : links,
    details: {
      time: json.time || null,
      type: d.type || null,
    },
  };
}

export default {
  name: "Netflix Token Generator",
  description: "Generate Netflix token gratis (triple-source)",
  category: "Fun",
  methods: ["GET"],
  params: [],
  paramsSchema: {},

  async run(req, res) {
    const errors = [];
    const sources = [
      ["Primary", fetchPrimary],
      ["Fallback", fetchFallback],
      ["Third", fetchThird],
    ];

    for (const [name, fetcher] of sources) {
      try {
        const result = await fetcher();

        return res.json({
          status: true,
          result,
        });
      } catch (error) {
        errors.push(`${name}: ${error.message}`);
      }
    }

    return res.json({
      status: false,
      message: "Semua source gagal.",
      errors,
    });
  },
};

