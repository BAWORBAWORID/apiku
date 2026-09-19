import https from "axios";

const _cfg = {
  home: "https://klickpin.com/",
  down: "https://klickpin.com/download",
  bootstrap: "https://form-bootstrap.klickpin.com/",
  bootstrapFallback: "https://klickpin.com/form-bootstrap.php",
  csrf: "https://csrf-token.klickpin.com/"
};

function jar(res, prev = "") {
  const set = res.headers["set-cookie"] || [];
  const merged = set.map(c => c.split(";")[0]);
  const old = prev ? prev.split("; ") : [];
  const keys = new Set(merged.map(c => c.split("=")[0]));
  return [...merged, ...old.filter(c => !keys.has(c.split("=")[0]))].join("; ");
}

async function klickpinSrc(pinUrl) {
  try {
    const home = await https.get(_cfg.home);
    let cookie = jar(home);

    let bootstrap;
    try {
      const res = await https.get(_cfg.bootstrap + "?t=" + Date.now(), {
        headers: { "Accept": "application/json", "X-KlickPin-HMAC": "1", "Origin": "https://klickpin.com", "Referer": "https://klickpin.com/", "Cookie": cookie }
      });
      bootstrap = res.data;
      cookie = jar(res, cookie);
    } catch {
      const res = await https.get(_cfg.bootstrapFallback + "?t=" + Date.now(), {
        headers: { "Accept": "application/json", "X-KlickPin-Bootstrap": "1", "Origin": "https://klickpin.com", "Referer": "https://klickpin.com/", "Cookie": cookie }
      });
      bootstrap = res.data;
      cookie = jar(res, cookie);
    }

    if (!bootstrap?.csrf_token) {
      const res = await https.get(_cfg.csrf + "?t=" + Date.now(), {
        headers: { "Origin": "https://klickpin.com", "Referer": "https://klickpin.com/", "Cookie": cookie }
      });
      bootstrap = { ...bootstrap, csrf_token: res.data.csrf_token };
      cookie = jar(res, cookie);
    }

    const signRes = await https.post(
      _cfg.bootstrap.replace(/\/+$/, "") + "/sign-resolver",
      { url: pinUrl, csrf_token: bootstrap.csrf_token },
      { headers: { "Content-Type": "application/json", "Origin": "https://klickpin.com", "Referer": "https://klickpin.com/", "Cookie": cookie } }
    );
    const sign = signRes.data;
    cookie = jar(signRes, cookie);

    const resolverUrl = sign.workerUrl
      + "?url=" + encodeURIComponent(pinUrl)
      + "&exp=" + encodeURIComponent(sign.exp)
      + "&nonce=" + encodeURIComponent(sign.nonce)
      + "&sig=" + encodeURIComponent(sign.sig);

    const resolvedRes = await https.get(resolverUrl, {
      headers: { "Origin": "https://klickpin.com", "Referer": "https://klickpin.com/", "Cookie": cookie }
    });
    const resolved = resolvedRes.data;
    const finalUrl = resolved.finalUrl || resolved.url || resolved.resolvedUrl;

    const params = new URLSearchParams({
      csrf_token: bootstrap.csrf_token,
      url: finalUrl,
      original_short_url: pinUrl,
      title_hint: bootstrap.title || ""
    });

    const { data: html } = await https.post(_cfg.down, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://klickpin.com", "Referer": "https://klickpin.com/", "Cookie": cookie }
    });

    const image = html.match(/data-download-url="([^"]+)"/i);
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1].trim() || bootstrap.title).split(" | ")[0].replace(/-Pin-\d+.*$/i, "").trim();

    if (!image) throw new Error("failed url download");

    return {
      title,
      image: image[1]
    };
  } catch (e) {
    throw e.response?.data || e.message;
  }
}

export default {
  name: "Pinterest",
  description: "Download media dari Pinterest",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { 
      type: "string", 
      required: true, 
      description: "Link Pinterest", 
      example: "https://pin.it/5QxuDBsGK", 
      minLength: 1, 
      maxLength: 200 
    }
  },
  async run(req, res) {
    const { url } = { ...req.query, ...req.body };
    
    if (!url) {
        return res.status(400).json({
            success: false,
            error: "Parameter 'url' wajib diisi"
        });
    }

    try {
        const data = await klickpinSrc(url);
        return res.json({
            success: true,
            result: data
        });
    } catch (e) {
        return res.status(500).json({
            success: false,
            error: typeof e === 'string' ? e : e.message
        });
    }
  }
};
