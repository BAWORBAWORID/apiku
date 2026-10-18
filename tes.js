import crypto from 'node:crypto';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function extractSlug(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
    const segments = path.split('/');
    return segments[segments.length - 1] || '';
  } catch {
    return inputUrl.replace(/https?:\/\/[^\/]+/, '').replace(/^\/+|\/+$/g, '');
  }
}

class CookieManager {
  constructor() {
    this.jar = new Map();
  }

  save(response) {
    const list = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')];
    for (const item of list) {
      if (!item) continue;
      const [pair] = item.split(';');
      const [key, value] = pair.split('=');
      if (key && value) {
        this.jar.set(key.trim(), value.trim());
      }
    }
  }

  get(key) {
    return this.jar.get(key) || null;
  }

  header() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function buildToken(xsrfCookie) {
  const decoded = decodeURIComponent(xsrfCookie || '');
  const dummyHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  const payload = '#' + Buffer.from(dummyHash).toString('base64');
  return decoded.slice(0, 128 - payload.length) + payload;
}

export async function bypassAdlinksumo(targetUrl, options = {}) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Valid Adlinksumo URL string is required');
  }

  const slug = extractSlug(targetUrl);
  if (!slug) {
    throw new Error('Could not extract shortlink slug from input URL');
  }

  const startTime = Date.now();
  const timeoutMs = options.timeout || 20000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const cookieManager = new CookieManager();

    const initialRes = await fetch(`https://adlinksumo.com/${slug}`, {
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    cookieManager.save(initialRes);
    const initialHtml = await initialRes.text();

    const rayIdMatch = initialHtml.match(/name="ray_id"\s+value="([^"]+)"/);
    const rayId = rayIdMatch ? rayIdMatch[1] : null;
    const aliasMatch = initialHtml.match(/name="alias"\s+value="([^"]+)"/);
    const alias = aliasMatch ? aliasMatch[1] : slug;

    if (!rayId) {
      const readyLinkMatch = initialHtml.match(/window\.location\.href\s*=\s*"([^"]+)"/);
      if (readyLinkMatch) {
        return {
          success: true,
          slug,
          original_url: targetUrl,
          destination_url: readyLinkMatch[1].replace(/\\/g, ''),
          execution_time_ms: Date.now() - startTime
        };
      }
      throw new Error('Failed to extract ray_id challenge from Adlinksumo initial page');
    }

    const redirectUrl = `https://kalimbachords.net/redirect.php?ray_id=${encodeURIComponent(rayId)}&alias=${encodeURIComponent(alias)}`;
    const redirectRes = await fetch(redirectUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Referer': `https://adlinksumo.com/${slug}`
      },
      signal: controller.signal
    });

    cookieManager.save(redirectRes);
    const articlePath1 = redirectRes.headers.get('location');
    if (!articlePath1) {
      throw new Error('Failed to follow initial redirect to safelink article');
    }

    const articleRes1 = await fetch(`https://kalimbachords.net${articlePath1}`, {
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Cookie': cookieManager.header(),
        'Referer': `https://adlinksumo.com/${slug}`
      },
      signal: controller.signal
    });

    cookieManager.save(articleRes1);

    const token1 = buildToken(cookieManager.get('XSRF-TOKEN'));
    const sessionRes1 = await fetch('https://kalimbachords.net/api/session', {
      method: 'POST',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Content-Type': 'application/json',
        'Cookie': cookieManager.header(),
        'Referer': `https://kalimbachords.net${articlePath1}`
      },
      body: JSON.stringify({ _token: token1 }),
      signal: controller.signal
    });

    cookieManager.save(sessionRes1);
    const sessionData1 = await sessionRes1.json();

    const verifyPayload = { _a: 0 };
    if (sessionData1?.captcha === 'turnstile' && options.turnstileToken) {
      verifyPayload.captcha = options.turnstileToken;
    }

    const verifyRes = await fetch('https://kalimbachords.net/api/verify', {
      method: 'POST',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Content-Type': 'application/json',
        'Cookie': cookieManager.header(),
        'Referer': `https://kalimbachords.net${articlePath1}`
      },
      body: JSON.stringify(verifyPayload),
      signal: controller.signal
    });

    cookieManager.save(verifyRes);
    const verifyData = await verifyRes.json();
    if (!verifyData?.target) {
      throw new Error('Verification failed: target URL not returned by safelink API');
    }

    const redirectRes2 = await fetch(verifyData.target, {
      redirect: 'manual',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Cookie': cookieManager.header(),
        'Referer': `https://kalimbachords.net${articlePath1}`
      },
      signal: controller.signal
    });

    cookieManager.save(redirectRes2);
    const articlePath2 = redirectRes2.headers.get('location');
    if (!articlePath2) {
      throw new Error('Failed to follow second redirect to final safelink article');
    }

    const articleRes2 = await fetch(`https://kalimbachords.net${articlePath2}`, {
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Cookie': cookieManager.header()
      },
      signal: controller.signal
    });

    cookieManager.save(articleRes2);

    const token2 = buildToken(cookieManager.get('XSRF-TOKEN'));
    const sessionRes2 = await fetch('https://kalimbachords.net/api/session', {
      method: 'POST',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Content-Type': 'application/json',
        'Cookie': cookieManager.header(),
        'Referer': `https://kalimbachords.net${articlePath2}`
      },
      body: JSON.stringify({ _token: token2 }),
      signal: controller.signal
    });

    cookieManager.save(sessionRes2);

    const key = Math.floor(Math.random() * 1000);
    const size = `${(1920 + key) * 2}.${(1080 + key) * 2}`;
    const goRes = await fetch('https://kalimbachords.net/api/go', {
      method: 'POST',
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Content-Type': 'application/json',
        'Cookie': cookieManager.header(),
        'Referer': `https://kalimbachords.net${articlePath2}`
      },
      body: JSON.stringify({ key, size, ado: null }),
      signal: controller.signal
    });

    cookieManager.save(goRes);
    const goData = await goRes.json();
    if (!goData?.url) {
      throw new Error('Failed to generate final ready URL from safelink gateway');
    }

    const readyRes = await fetch(goData.url, {
      headers: {
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
        'Referer': `https://kalimbachords.net${articlePath2}`
      },
      signal: controller.signal
    });

    const readyHtml = await readyRes.text();
    const finalMatch = readyHtml.match(/window\.location\.href\s*=\s*"([^"]+)"/);
    if (!finalMatch) {
      throw new Error('Failed to extract destination URL from final ready page');
    }

    const destinationUrl = finalMatch[1].replace(/\\/g, '');

    return {
      success: true,
      slug,
      original_url: targetUrl,
      gateway_url: goData.url,
      destination_url: destinationUrl,
      execution_time_ms: Date.now() - startTime
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default {
  bypassAdlinksumo
};
// CLI / Test Runner
const target = process.argv[2] || 'https://adlinksumo.com/demo';
console.log('=== Testing Adlinksumo Bypasser ===');
console.log('Target URL:', target);

bypassAdlinksumo(target)
  .then((res) => console.log('Bypass Success:', res))
  .catch((err) => console.error('Bypass Result/Error:', err.message));
