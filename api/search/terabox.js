/**
 * TeraBox share resolver (api/search/terabox.js)
 *
 * Strategy (fallback chain — first success wins):
 *   1. teradownloader.pro getFileUrl API family:
 *        POST https://apiwala.teradownloader.pro/api/getFileUrl/new   { link }
 *        POST https://apiwala.teradownloader.pro/api/getFileUrl       { link }
 *        POST https://apiwala.teradownloader.pro/api/getFileUrl/new2  { link }
 *      (= the endpoints the live teradownloader.pro frontend jQuery bundle
 *       calls, e.g. at /tmp/opencode/td_bundle.js the constant
 *       C_="https://apiwala.teradownloader.pro").
 *   2. TeraBox wap share page scrape — https://www.terabox.wap/share/
 *      filelist?surl=... — to prove the share is live/listable when the
 *      API hosts are Cloudflare-geo-gated from a datacenter IP (as they are
 *      from this box). Returns share metadata; the direct download is
 *      owner-gated, so wap mode reports that clearly.
 *
 * Requires Node >=18 (global fetch + AbortSignal.timeout). No npm deps.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const API_BASES = ["https://apiwala.teradownloader.pro"];
const API_PATHS = [
  "/api/getFileUrl/new",
  "/api/getFileUrl",
  "/api/getFileUrl/new2",
];
const WAP = "https://www.terabox.wap/share/filelist";

function extractSurl(input) {
  const s = String(input ?? "").trim();
  const m = s.match(/surl=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return s.replace(/^https?:\/\/[^/]+\/.*[?&]surl=/, "") || null;
}

async function shareApi(link) {
  let lastErr = null;
  for (const base of API_BASES) {
    for (const p of API_PATHS) {
      try {
        const url = base + p;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://teradownloader.pro",
            Referer: "https://teradownloader.pro/",
            "User-Agent": UA,
          },
          body: JSON.stringify({ link }),
          signal: AbortSignal.timeout(60000),
        });
        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (_) {}
        if (res.ok && data && typeof data === "object") return { host: base, data };
        lastErr = new Error(`HTTP ${res.status} @ ${p}`);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error("all api routes failed");
}

async function wapList(surl) {
  const url = `${WAP}?surl=${encodeURIComponent(surl)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(30000),
  });
  const html = await res.text();
  // slim object → byte-boundary-safe
  return {
    url,
    status: res.status,
    title: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || null,
    shareid: (html.match(/"shareid"\s*:\s*(\d+)/) || [])[1] || null,
    fids: (html.match(/"fs_id"\s*:\s*(\d+)/g) || []).map((m) =>
      +(m.match(/\d+/) || [])[0]
    ),
    fileCount: (html.match(/"fs_id"/g) || []).length,
    hasFiles: /"fs_id"/.test(html),
  };
}

async function resolve(link) {
  const start = Date.now();
  const norm = String(link ?? "").trim();
  if (!norm) {
    return {
      success: false,
      error: "no link provided",
      timestamp: new Date().toISOString(),
    };
  }
  const surl = extractSurl(norm);

  let api = null;
  let apiErr = null;
  try {
    api = await shareApi(norm);
  } catch (e) {
    apiErr = e;
  }

  let wap = null;
  let wapErr = null;
  if (api === null || (api && !(api.data && api.data.fileSize))) {
    try {
      wap = await wapList(surl || (await import("node:url").then((u) => u.fileURLToPath(new u.URL(norm)))));
    } catch (e) {
      wapErr = e;
    }
  }

  if (api && api.data) {
    const d = api.data;
    const file = {
      name:
        d.fileName ||
        d.filename ||
        d.name ||
        d.file_name ||
        d.title ||
        null,
      sizeMB:
        d.fileSizeMB ||
        d.fileSizeMb ||
        (d.fileSize ? +(d.fileSize / 1048576).toFixed(2) : null),
      downloadUrl:
        d.downloadLink ||
        d.downloadUrl ||
        d.dlink ||
        d.url ||
        d.directLink ||
        null,
      thumb: d.thumb || d.thumbUrl || d.thumbnail || null,
    };
    return {
      success: true,
      source: "api",
      apiHost: api.host,
      surl,
      file,
      rawKeys: Object.keys(d).slice(0, 30),
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }

  if (wap && (wap.hasFiles || wap.fileCount > 0)) {
    return {
      success: true,
      source: "wap",
      surl,
      wap,
      file: null,
      note:
        "Share is live and listable. Direct download requires an owner-login / " +
        "residential-browser session; API hosts are Cloudflare-geo-gated from " +
        "this deployment IP. " +
        (wapErr ? `wap error: ${wapErr.message}` : ""),
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    success: false,
    error: apiErr
      ? `api: ${apiErr.message}; wap: ${wapErr ? wapErr.message : "n/a"}`
      : `wap: ${wapErr ? wapErr.message : "no usable data"}`,
    surl,
    latencyMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}

if (process.argv[1] && process.argv[1].endsWith("terabox.js")) {
  const arg = process.argv[2];
  const jsonMode = process.argv.includes("--json");
  if (!arg) {
    console.error('Usage: node terabox.js "<share-url>" [--json]');
    process.exit(1);
  }
  resolve(arg)
    .then((out) => {
      if (jsonMode) console.log(JSON.stringify(out, null, 2));
      else {
        if (out.success && out.file) {
          console.log(`File    : ${out.file.name || "-"}`);
          console.log(`Size    : ${out.file.sizeMB != null ? out.file.sizeMB + " MB" : "-"}`);
          console.log(`Download: ${out.file.downloadUrl || "(owner-gated / API geo-blocked)"}`);
          console.log(`Source  : ${out.source}`);
        } else {
          console.log(JSON.stringify(out, null, 2));
        }
      }
    })
    .catch((e) => {
      console.error("ERR:", e.message);
      process.exit(1);
    });
}

export default {
  name: "TeraBox Resolver",
  description:
    "Resolve a TeraBox share link to file info + direct download URL (teradownloader.pro API with TeraBox wap fallback).",
  category: "SEARCH",
  methods: ["GET", "POST"],
  params: ["link"],
  paramsSchema: {
    link: {
      type: "string",
      required: true,
      description: "TeraBox / teradownloader.pro share URL",
      example: "https://www.terabox.app/wap/share/filelist?surl=abc123",
    },
  },
  async run(req, res) {
    const link = req.query?.link ?? req.body?.link ?? null;
    const out = await resolve(link);
    res.status(out.success ? 200 : 400).json(out);
  },
};
