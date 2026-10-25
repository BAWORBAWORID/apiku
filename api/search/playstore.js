const safeGet = (obj, ...keys) => {
  return keys.reduce((acc, key) => {
    if (acc === null || acc === undefined) return null;
    if (Array.isArray(acc) && typeof key === "number" && key < acc.length) return acc[key];
    return null;
  }, obj);
};

function extractApps(content) {
  const lines = content.split("\n");
  const outer = JSON.parse(lines[2]);
  const innerStr = outer[0][2];
  const inner = JSON.parse(innerStr);
  const apps = inner[0][1][0][0][0];

  return apps.map((app, i) => ({
    no: i + 1,
    name: safeGet(app, 2),
    developer: safeGet(app, 4, 0, 0, 0),
    description: safeGet(app, 4, 1, 1, 1, 1),
    rating: safeGet(app, 6, 0, 2, 1, 0),
    rating_value: safeGet(app, 6, 0, 2, 1, 1),
    package_id: safeGet(app, 12, 0),
    play_store_url: safeGet(app, 9, 4, 2) ? `https://play.google.com${safeGet(app, 9, 4, 2)}` : null,
    icon_url: safeGet(app, 1, 1, 0, 3, 2),
  }));
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanHtml(html) {
  if (!html) return "";
  return decodeHtmlEntities(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim()
  );
}

/**
 * Scrape detail aplikasi Google Play Store secara lengkap & real-time
 * @param {string} input - URL Play Store atau Package ID (contoh: com.snowcorp.stickerly.android)
 * @returns {Promise<Object>} Metadata aplikasi Google Play Store
 */
async function scrapePlayStoreDetail(input) {
  if (!input || typeof input !== "string" || !input.trim()) {
    throw new Error("Parameter URL Google Play Store atau Package ID wajib disertakan.");
  }

  const raw = input.trim();
  const pkgMatch =
    raw.match(/[?&]id=([a-zA-Z0-9._]+)/) ||
    raw.match(/details\/([a-zA-Z0-9._]+)/) ||
    raw.match(/^([a-zA-Z0-9._]+)$/);

  if (!pkgMatch) {
    throw new Error("Format Package ID atau URL Google Play Store tidak valid. Contoh: com.snowcorp.stickerly.android");
  }
  const packageId = pkgMatch[1];

  const targetUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&hl=id&gl=ID`;
  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Aplikasi dengan package ID "${packageId}" tidak ditemukan di Google Play Store.`);
    }
    throw new Error(`Google Play Store merespons status HTTP ${res.status}.`);
  }

  const html = await res.text();

  // 1. Ekstrak Structured Data Schema (ld+json)
  let ld = {};
  const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (ldMatch) {
    try {
      ld = JSON.parse(ldMatch[1]);
    } catch {}
  }

  // 2. Ekstrak Data Engine Internal Google Play (ds:5)
  let appInfo = null;
  const afMatch = html.match(
    /AF_initDataCallback\s*\(\s*\{key:\s*[\x27"]ds:5[\x27"][\s\S]*?data:\s*([\s\S]*?)\s*,\s*sideChannel:/
  );
  if (afMatch) {
    try {
      const parsedAf = JSON.parse(afMatch[1]);
      appInfo = parsedAf[1]?.[2] || null;
    } catch {}
  }

  const title = appInfo?.[0]?.[0] || ld.name || "Aplikasi Android";
  const summary = cleanHtml(appInfo?.[73]?.[0]?.[1] || ld.description || "");
  const fullDescription = cleanHtml(appInfo?.[72]?.[0]?.[1] || ld.description || summary);

  const icon = appInfo?.[95]?.[0]?.[3]?.[2] || ld.image || "";
  const headerImage = appInfo?.[96]?.[0]?.[3]?.[2] || null;
  const screenshots = (appInfo?.[78]?.[0] || [])
    .map((x) => x?.[3]?.[2])
    .filter(Boolean);

  const ratingScore = parseFloat(ld.aggregateRating?.ratingValue || appInfo?.[51]?.[0]?.[1] || "0");
  const ratingCount = parseInt(ld.aggregateRating?.ratingCount || "0", 10) || 0;

  const installsFormatted = appInfo?.[13]?.[0] || "100.000+";
  const installsExact = appInfo?.[13]?.[1] || 0;

  const rawCategory = appInfo?.[79]?.[0]?.[0] || ld.applicationCategory || "";
  const categoryName = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
  const categoryId = appInfo?.[79]?.[0]?.[2] || ld.applicationCategory || "";

  const developerName = appInfo?.[37]?.[0] || ld.author?.name || "Developer";
  const developerUrl = ld.author?.url || null;
  const developerEmail = appInfo?.[69]?.[1]?.[0] || null;
  const developerAddress = appInfo?.[69]?.[2]?.[0] || null;

  const offersPrice = ld.offers?.[0]?.price;
  const price = !offersPrice || offersPrice === "0" ? "Gratis" : `${ld.offers?.[0]?.priceCurrency || ""} ${offersPrice}`.trim();
  const contentRating = ld.contentRating || appInfo?.[77]?.[0] || "Semua Umur";
  const updatedAt = appInfo?.[145]?.[0]?.[0] || "-";
  const whatsNew = cleanHtml(appInfo?.[144]?.[1]?.[1] || "");

  return {
    package_id: packageId,
    title,
    summary,
    description: fullDescription,
    category: {
      name: categoryName,
      id: categoryId,
    },
    developer: {
      name: developerName,
      website: developerUrl,
      email: developerEmail,
      address: developerAddress,
    },
    rating: {
      score: ratingScore ? Number(ratingScore.toFixed(2)) : 0,
      reviews_count: ratingCount,
      reviews_formatted:
        ratingCount >= 1e6
          ? (ratingCount / 1e6).toFixed(1) + "M"
          : ratingCount >= 1e3
          ? (ratingCount / 1e3).toFixed(1) + "K"
          : String(ratingCount),
    },
    installs: {
      formatted: installsFormatted,
      approximate: installsExact,
    },
    price,
    content_rating: contentRating,
    updated_at: updatedAt,
    whats_new: whatsNew || null,
    media: {
      icon,
      header_image: headerImage,
      screenshots,
    },
    playstore_url: `https://play.google.com/store/apps/details?id=${packageId}`,
  };
}

export default {
  name: "Play Store",
  description: "Cari aplikasi dan ambil detail lengkap aplikasi (reviews, rating, developer, screenshots) di Google Play Store",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "id", "action", "limit"],

  paramsSchema: {
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian aplikasi, atau Package ID/URL aplikasi",
      example: "whatsapp",
    },
    id: {
      type: "string",
      required: false,
      description: "Package ID atau URL Google Play Store untuk mengambil detail lengkap",
      example: "com.whatsapp",
    },
    action: {
      type: "string",
      required: false,
      default: "search",
      enum: ["search", "detail"],
      description: "Pilihan aksi: 'search' (cari aplikasi) atau 'detail' (detail lengkap aplikasi)",
      example: "search",
    },
    limit: {
      type: "number",
      required: false,
      default: 10,
      description: "Jumlah hasil pencarian (default: 10, khusus action search)",
      example: 10,
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const rawAction = params.action ? String(params.action).trim().toLowerCase() : "";
      const targetId = params.id || params.package_id || params.url;
      const query = params.query ? String(params.query).trim() : "";
      const limit = parseInt(params.limit, 10) || 10;

      // Deteksi mode detail:
      // 1. action === "detail"
      // 2. id / package_id / url disertakan
      // 3. query berbentuk URL Play Store (play.google.com/store/apps/details?id=...)
      const isPlayStoreUrl = query.includes("play.google.com/store/apps/details");
      const isDetailMode = rawAction === "detail" || !!targetId || isPlayStoreUrl;

      if (isDetailMode) {
        const detailTarget = targetId || query;
        if (!detailTarget) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'id', 'package_id', 'url', atau 'query' wajib diisi untuk melihat detail aplikasi",
            timestamp: Date.now(),
          });
        }

        const data = await scrapePlayStoreDetail(detailTarget);
        return res.json({
          status: true,
          action: "detail",
          result: data,
          timestamp: Date.now(),
        });
      }

      // Mode search
      if (!query) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi untuk mencari aplikasi",
          timestamp: Date.now(),
        });
      }

      const data = new URLSearchParams();
      data.append(
        "f.req",
        `[[\n                ["lGYRle","[[[],[[10,[10,50]],true,null,[96,27,4,8,57,30,110,11,16,49,1,9,12,104,55,56,51,10,34,31,145],[null,null,[[null,null,[[[]]]],[null,[[[]]]],[null,[[[]]]],[null,[[[]]]],null,null,null,null,[[[[]]]],[[[[]]]]],[[[[7,1],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,31],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,104],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,9],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,8],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,27],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,49],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,12],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,65],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,110],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,88],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,11],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,56],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,55],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,96],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,122],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,72],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,71],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,64],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[7,113],[[1,73,96,103,58,92,52,112,69,19,31,101,123,74,49,80,20,10,14,79,43]]],[[9,1],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,31],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,104],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,9],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,8],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,27],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,49],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,12],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,65],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,110],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,88],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,11],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,56],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,55],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,96],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,122],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,72],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,71],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,64],[[1,7,9,24,12,31,5,10,15,27,8]]],[[9,113],[[1,7,9,24,12,31,5,10,15,27,8]]],[[17,1],[[1,7,9,25,13,31,5,10,27,8]]],[[17,31],[[1,7,9,25,13,31,5,10,27,8]]],[[17,104],[[1,7,9,25,13,31,5,10,27,8]]],[[17,9],[[1,7,9,25,13,31,5,10,27,8]]],[[17,8],[[1,7,9,25,13,31,5,10,27,8]]],[[17,27],[[1,7,9,25,13,31,5,10,27,8]]],[[17,49],[[1,7,9,25,13,31,5,10,27,8]]],[[17,12],[[1,7,9,25,13,31,5,10,27,8]]],[[17,65],[[1,7,9,25,13,31,5,10,27,8]]],[[17,110],[[1,7,9,25,13,31,5,10,27,8]]],[[17,88],[[1,7,9,25,13,31,5,10,27,8]]],[[17,11],[[1,7,9,25,13,31,5,10,27,8]]],[[17,56],[[1,7,9,25,13,31,5,10,27,8]]],[[17,55],[[1,7,9,25,13,31,5,10,27,8]]],[[17,96],[[1,7,9,25,13,31,5,10,27,8]]],[[17,122],[[1,7,9,25,13,31,5,10,27,8]]],[[17,72],[[1,7,9,25,13,31,5,10,27,8]]],[[17,71],[[1,7,9,25,13,31,5,10,27,8]]],[[17,64],[[1,7,9,25,13,31,5,10,27,8]]],[[17,113],[[1,7,9,25,13,31,5,10,27,8]]],[[10,1],[[1,7,6,9]]],[[10,31],[[1,7,6,9]]],[[10,104],[[1,7,6,9]]],[[10,9],[[1,7,6,9]]],[[10,8],[[1,7,6,9]]],[[10,27],[[1,7,6,9]]],[[10,49],[[1,7,6,9]]],[[10,12],[[1,7,6,9]]],[[10,65],[[1,7,6,9]]],[[10,110],[[1,7,6,9]]],[[10,88],[[1,7,6,9]]],[[10,11],[[1,7,6,9]]],[[10,56],[[1,7,6,9]]],[[10,55],[[1,7,6,9]]],[[10,96],[[1,7,6,9]]],[[10,122],[[1,7,6,9]]],[[10,72],[[1,7,6,9]]],[[10,71],[[1,7,6,9]]],[[10,64],[[1,7,6,9]]],[[10,113],[[1,7,6,9]]],[[1,1],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,31],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,104],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,9],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,8],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,27],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,49],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,12],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,65],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,110],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,88],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,11],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,56],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,55],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,96],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,122],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,72],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,71],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,64],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[1,113],[[1,5,14,38,19,29,7,34,4,12,11,6,30,16,10]]],[[4,1],[[1,3,5,4,7,6,11,19]]],[[4,31],[[1,3,5,4,7,6,11,19]]],[[4,104],[[1,3,5,4,7,6,11,19]]],[[4,9],[[1,3,5,4,7,6,11,19]]],[[4,8],[[1,3,5,4,7,6,11,19]]],[[4,27],[[1,3,5,4,7,6,11,19]]],[[4,49],[[1,3,5,4,7,6,11,19]]],[[4,12],[[1,3,5,4,7,6,11,19]]],[[4,65],[[1,3,5,4,7,6,11,19]]],[[4,110],[[1,3,5,4,7,6,11,19]]],[[4,88],[[1,3,5,4,7,6,11,19]]],[[4,11],[[1,3,5,4,7,6,11,19]]],[[4,56],[[1,3,5,4,7,6,11,19]]],[[4,55],[[1,3,5,4,7,6,11,19]]],[[4,96],[[1,3,5,4,7,6,11,19]]],[[4,122],[[1,3,5,4,7,6,11,19]]],[[4,72],[[1,3,5,4,7,6,11,19]]],[[4,71],[[1,3,5,4,7,6,11,19]]],[[4,64],[[1,3,5,4,7,6,11,19]]],[[4,113],[[1,3,5,4,7,6,11,19]]],[[3,1],[[1,5,14,4,10,17]]],[[3,31],[[1,5,14,4,10,17]]],[[3,104],[[1,5,14,4,10,17]]],[[3,9],[[1,5,14,4,10,17]]],[[3,8],[[1,5,14,4,10,17]]],[[3,27],[[1,5,14,4,10,17]]],[[3,49],[[1,5,14,4,10,17]]],[[3,12],[[1,5,14,4,10,17]]],[[3,65],[[1,5,14,4,10,17]]],[[3,110],[[1,5,14,4,10,17]]],[[3,88],[[1,5,14,4,10,17]]],[[3,11],[[1,5,14,4,10,17]]],[[3,56],[[1,5,14,4,10,17]]],[[3,55],[[1,5,14,4,10,17]]],[[3,96],[[1,5,14,4,10,17]]],[[3,122],[[1,5,14,4,10,17]]],[[3,72],[[1,5,14,4,10,17]]],[[3,71],[[1,5,14,4,10,17]]],[[3,64],[[1,5,14,4,10,17]]],[[3,113],[[1,5,14,4,10,17]]],[[2,1],[[1,5,7,18,4,13,16,12]]],[[2,31],[[1,5,7,18,4,13,16,12]]],[[2,104],[[1,5,7,18,4,13,16,12]]],[[2,9],[[1,5,7,18,4,13,16,12]]],[[2,8],[[1,5,7,18,4,13,16,12]]],[[2,27],[[1,5,7,18,4,13,16,12]]],[[2,49],[[1,5,7,18,4,13,16,12]]],[[2,12],[[1,5,7,18,4,13,16,12]]],[[2,65],[[1,5,7,18,4,13,16,12]]],[[2,110],[[1,5,7,18,4,13,16,12]]],[[2,88],[[1,5,7,18,4,13,16,12]]],[[2,11],[[1,5,7,18,4,13,16,12]]],[[2,56],[[1,5,7,18,4,13,16,12]]],[[2,55],[[1,5,7,18,4,13,16,12]]],[[2,96],[[1,5,7,18,4,13,16,12]]],[[2,122],[[1,5,7,18,4,13,16,12]]],[[2,72],[[1,5,7,18,4,13,16,12]]],[[2,71],[[1,5,7,18,4,13,16,12]]],[[2,64],[[1,5,7,18,4,13,16,12]]],[[2,113],[[1,5,7,18,4,13,16,12]]]]]]],[\\"${query}\\"],4,[null,1],null,null,[]]]",null,"SearchQueryBuilder@${query}"]\n            ]]`
      );

      const response = await fetch(
        "https://play.google.com/_/PlayStoreUi/data/batchexecute?hl=en&gl=ID",
        {
          method: "POST",
          headers: {
            "User-Agent": "okhttp/5.3.2",
            "Accept-Encoding": "gzip",
            "content-type": "application/x-www-form-urlencoded;charset=utf-8",
            origin: "https://play.google.com",
          },
          body: data,
        }
      );

      const text = await response.text();
      const allApps = extractApps(text);
      const apps = allApps.slice(0, limit);

      return res.json({
        status: true,
        action: "search",
        result: {
          query,
          total: apps.length,
          source: "Google Play Store",
          apps,
        },
        timestamp: Date.now(),
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Failed to search Play Store",
        timestamp: Date.now(),
      });
    }
  },
};
