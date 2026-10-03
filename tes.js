/**
 * GetDL Downloader & Scraper (ESM)
 * Base: https://getdl.space
 *
 * Supported Platforms:
 *   YouTube, CapCut, Pinterest, TikTok, Instagram, Facebook, X / Twitter, dll.
 *
 * Usage:
 *   node tes.js <url>
 *   node tes.js https://vt.tiktok.com/ZSxxpjmUV/
 *   node tes.js search <keyword>
 */

const BASE_URL = "https://getdl.space";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const cookieJar = new Map();

function getCookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function saveCookies(res) {
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
      ? [res.headers.get("set-cookie")]
      : [];

  for (const c of setCookies) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) {
      cookieJar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}

let sessionCache = {
  sessionId: null,
  expiresAt: 0,
};

export async function resolveRedirect(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

export async function getSession(forceNew = false) {
  if (!forceNew && sessionCache.sessionId && Date.now() < sessionCache.expiresAt) {
    return sessionCache.sessionId;
  }

  // Ambil cookie dasar dari landing page
  const homeRes = await fetch(`${BASE_URL}/en`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  saveCookies(homeRes);

  // Ambil sessionId dan getdl_sid cookie
  const sessionRes = await fetch(`${BASE_URL}/api/session`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: `${BASE_URL}/en`,
      Origin: BASE_URL,
      Cookie: getCookieHeader(),
    },
    signal: AbortSignal.timeout(15000),
  });
  saveCookies(sessionRes);

  const json = await sessionRes.json().catch(() => null);
  if (!sessionRes.ok || !json?.success || !json?.sessionId) {
    throw new Error(`Gagal inisialisasi session dari ${BASE_URL} (HTTP ${sessionRes.status})`);
  }

  sessionCache = {
    sessionId: json.sessionId,
    expiresAt: Date.now() + 30 * 60 * 1000,
  };

  return sessionCache.sessionId;
}

export async function download(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string") {
    throw new Error("Parameter URL tidak boleh kosong.");
  }

  let sessionId = await getSession();

  const makeRequest = async (url, sid) => {
    const res = await fetch(`${BASE_URL}/api/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/en`,
        Cookie: getCookieHeader(),
      },
      body: JSON.stringify({ url, sessionId: sid }),
      signal: AbortSignal.timeout(30000),
    });
    saveCookies(res);
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  let { res, json } = await makeRequest(targetUrl, sessionId);

  // Jika sesi expired atau butuh sesi baru
  if (!res.ok && json?.code === "SESSION_REQUIRED") {
    sessionId = await getSession(true);
    const retry = await makeRequest(targetUrl, sessionId);
    res = retry.res;
    json = retry.json;
  }

  // Jika gagal dan URL merupakan shortlink, coba resolve redirect-nya
  if (!res.ok && /vt\.tiktok\.com|vm\.tiktok\.com|youtu\.be|t\.co|bit\.ly/i.test(targetUrl)) {
    const resolved = await resolveRedirect(targetUrl);
    if (resolved && resolved !== targetUrl) {
      const retryResolved = await makeRequest(resolved, sessionId);
      if (retryResolved.res.ok && retryResolved.json?.success) {
        res = retryResolved.res;
        json = retryResolved.json;
      }
    }
  }

  if (!res.ok || !json?.success) {
    const errMsg = json?.error || `HTTP ${res.status}: Gagal memproses download`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.code = json?.code || "FAILED";
    err.response = json;
    throw err;
  }

  const data = json.data || {};
  return {
    success: true,
    platform: data.platform || "unknown",
    type: data.type || "video",
    title: data.title || "",
    thumbnail: data.thumbnail || null,
    author: {
      name: data.author?.name || "Unknown",
      username: data.author?.username || "",
      avatar: data.author?.avatar || null,
    },
    duration: data.duration || null,
    downloads: (data.downloads || []).map((d) => ({
      label: d.label || "Download",
      url: d.url || "",
      quality: d.quality || null,
      ext: (d.ext || "mp4").toLowerCase().replace(".", ""),
    })),
    raw: data,
  };
}

export async function searchTikTok(keyword) {
  const sessionId = await getSession();
  const res = await fetch(`${BASE_URL}/api/search/tiktok`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/en/search/tiktok`,
      Cookie: getCookieHeader(),
    },
    body: JSON.stringify({ query: keyword, sessionId }),
    signal: AbortSignal.timeout(30000),
  });
  saveCookies(res);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || `HTTP ${res.status}: Gagal search TikTok`);
  }
  return json.data;
}

// ─────────────────────────────────────────────
// CLI Test Runner
// ─────────────────────────────────────────────
const input = process.argv[2] || "https://vt.tiktok.com/ZSxxpjmUV/";
const arg = process.argv.slice(3).join(" ");

if (process.argv[1] && process.argv[1].endsWith("tes.js")) {
  (async () => {
    try {
      console.log(`=== GetDL Scraper Test (${BASE_URL}) ===`);

      if (input === "search") {
        const query = arg || "mlbb";
        console.log(`🔍 Searching TikTok for: "${query}"`);
        const searchRes = await searchTikTok(query);
        console.log(JSON.stringify(searchRes, null, 2));
      } else {
        console.log(`📥 Downloading URL: ${input}`);
        const result = await download(input);
        console.log("✅ Berhasil:");
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error("\n❌ Error dari getdl.space:");
      console.error(
        JSON.stringify(
          {
            status: err.status || 500,
            code: err.code || "UNKNOWN",
            message: err.message,
            detail: err.response,
          },
          null,
          2
        )
      );

      console.log("\n💡 Catatan Status Upstream getdl.space:");
      console.log(
        "- Server backend getdl.space saat ini memblokir/gagal meresolve scraper untuk TikTok & Instagram (Slardar WAF / IP block)."
      );
      console.log("- Platform lain di getdl.space yang sudah teruji aktif: YouTube, CapCut, Pinterest.");
    }
  })();
}