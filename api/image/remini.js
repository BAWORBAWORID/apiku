import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as jimpPkg from 'jimp';

const Jimp = jimpPkg.Jimp ?? jimpPkg.default ?? jimpPkg;

const TARGET_URL =
  'https://play.google.com/store/apps/details?id=com.bigwinepot.nwdn.international';
const APP_ID = 'com.bigwinepot.nwdn.international';
const DEFAULT_FEATURE = 'AI Photo Enhancer';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Direktori kerja endpoint (dijalankan di ~/apiku)
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'output');
const TMP_DIR = path.join(ROOT, '.cache');

function axiosClient(timeout = 60000, ua = DEFAULT_UA) {
  return axios.create({
    timeout,
    maxRedirects: 5,
    httpAgent: undefined,
    headers: {
      'User-Agent': ua,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache',
    },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1048576) return `${(b / 1048576).toFixed(2)}MB`;
  return `${(b / 1024).toFixed(1)}KB`;
}

function mkJobId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function cleanScreenshotUrl(raw) {
  let u = String(raw).replace(/&amp;/g, '&');
  u = u.split('=')[0];
  if (!/play-lh\.googleusercontent\.com\/[A-Za-z0-9_-]+/.test(u)) return null;
  return `${u}=w2560`;
}

async function fetchPage(url, { attempts = 3, timeout = 60000 } = {}) {
  const http = axiosClient(timeout);
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await http.get(url, { responseType: 'text' });
      const html = typeof res.data === 'string' ? res.data : String(res.data);
      if (res.status === 200 && html && html.length > 5000)
        return { html, status: res.status };
      lastErr = new Error(`unexpected page status ${res.status} / empty body`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(1200 * i);
  }
  throw lastErr || new Error('page fetch failed');
}

function parseProjectJson(html) {
  try {
    const $ = cheerio.load(html);
    const raw = $('script[type="application/ld+json"]').first().html();
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  const m = html.match(
    /<script type="application\/ld\+json"[^>]*>([\s\S]{20,}?)<\/script>/i,
  );
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch (_) {}
  }
  return null;
}

function parseScreenshots(html) {
  const found = [];
  const push = (u) => {
    const c = cleanScreenshotUrl(u);
    if (c && !found.includes(c)) found.push(c);
  };
  try {
    const $ = cheerio.load(html);
    $('img[alt*="creenshot" i]').each((_, el) => {
      const src =
        $(el).attr('src') ||
        $(el).attr('data-src') ||
        (($(el).attr('srcset') ?? '').split(',')[0] ?? '')
          .trim()
          .split(' ')[0];
      if (src) push(src);
    });
    $('img[itemprop="image"]').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (src) push(src);
    });
  } catch (_) {}
  const re = /play-lh\.googleusercontent\.com\/[A-Za-z0-9_-]+(?==w526-h296)/g;
  const regexed = html.match(re) || [];
  regexed.forEach((u) => push(`${u}=w526-h296`));
  return found.slice(0, 25);
}

function detectFeature(name, description) {
  const hay = `${name || ''} ${description || ''}`;
  const m = hay.match(
    /AI Photo Enhancer|Photo Enhancer|AI Enhancer|Photo Enhance/i,
  );
  return m ? m[0] : DEFAULT_FEATURE;
}

async function scrapeReminiApp(targetUrl = TARGET_URL, opts = {}) {
  const { html, status } = await fetchPage(targetUrl, opts);
  const ld = parseProjectJson(html) || {};
  const name = ld.name || null;
  const description = ld.description || null;
  const developer = ld.author && ld.author.name ? ld.author.name : null;
  const icon = ld.image || null;
  const rating =
    ld.aggregateRating && ld.aggregateRating.ratingValue
      ? ld.aggregateRating.ratingValue
      : null;
  const ratingCount =
    ld.aggregateRating && ld.aggregateRating.ratingCount
      ? ld.aggregateRating.ratingCount
      : null;
  const price =
    Array.isArray(ld.offers) &&
    ld.offers[0] &&
    ld.offers[0].price
      ? ld.offers[0].price
      : null;
  const appUrl = ld.url || targetUrl;
  const screenshots = parseScreenshots(html);
  if (!name && !description && screenshots.length === 0) {
    throw new Error('empty app data (page layout changed)');
  }
  return {
    package: APP_ID,
    url: appUrl,
    http_code: status,
    name,
    developer,
    description,
    category: ld.applicationCategory || null,
    contentRating: ld.contentRating || null,
    rating,
    ratingCount,
    price,
    currency:
      Array.isArray(ld.offers) &&
      ld.offers[0] &&
      ld.offers[0].priceCurrency
        ? ld.offers[0].priceCurrency
        : null,
    icon,
    feature: detectFeature(name, description),
    screenshots,
  };
}

function resolveInputPath(source) {
  if (/^https?:\/\//i.test(source)) return source;
  throw new Error(`source harus URL gambar (bukan path file lokal): ${source}`);
}

async function downloadIfUrl(source) {
  if (!/^https?:\/\//i.test(source))
    return { inputPath: source, originalUrl: null, fromTmp: false };
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const urlObj = new URL(source);
  let fname = path.basename(urlObj.pathname).split('?')[0] || 'download.jpg';
  if (!/\.(png|jpe?g|bmp|tiff?|gif)$/i.test(fname)) fname = `${fname}.jpg`;
  const dest = path.join(TMP_DIR, `in_${Date.now()}_${fname}`);
  const http = axiosClient(120000);
  const res = await http.get(source, {
    responseType: 'arraybuffer',
    maxContentLength: 30 * 1024 * 1024,
  });
  fs.writeFileSync(dest, Buffer.from(res.data));
  return { inputPath: dest, originalUrl: source, fromTmp: true };
}

async function localEnhance(inputPath, outPath) {
  const img = await Jimp.read(inputPath);
  const { width, height } = img.bitmap;
  if (!width || !height) throw new Error('invalid image dimensions');
  const NEW_W = Math.min(width * 2, 8000);

  if (typeof img.writeAsync === 'function') {
    img.resize(NEW_W, Jimp.AUTO || -1, Jimp.RESIZE_BICUBIC);
    img.convolution([
      [0, -0.4, 0],
      [-0.4, 2.6, -0.4],
      [0, -0.4, 0],
    ]);
    img.contrast(0.06);
    img.brightness(0.02);
    img.color([{ apply: 'saturate', params: [10] }]);
    await img.quality(92).writeAsync(outPath);
  } else {
    img.resize({ w: NEW_W });
    img.convolution([
      [0, -0.4, 0],
      [-0.4, 2.6, -0.4],
      [0, -0.4, 0],
    ]);
    img.contrast(0.06);
    img.brightness(0.02);
    img.color([{ apply: 'saturate', params: [10] }]);
    await img.write(outPath, { quality: 92 });
  }

  return { width: img.bitmap.width, height: img.bitmap.height };
}

async function deepaiRemoteEngine(inputPath, outPath, apiKey) {
  let FormDataClass;
  try {
    const mod = await import('form-data');
    FormDataClass = mod.default || mod;
  } catch (_) {
    FormDataClass = globalThis.FormData;
  }
  if (!FormDataClass) throw new Error('form-data module not found');
  const form = new FormDataClass();
  form.append('image', fs.createReadStream(inputPath));
  const http = axiosClient(180000);
  let res;
  try {
    const headers = { 'Api-Key': apiKey };
    if (typeof form.getHeaders === 'function') {
      Object.assign(headers, form.getHeaders());
    }
    res = await http.post('https://api.deepai.org/api/torch-srgan', form, {
      headers,
      validateStatus: () => true,
    });
  } catch (e) {
    throw new Error(`deepai request failed: ${e.message}`);
  }
  let d = res.data;
  if (typeof d !== 'object') {
    try {
      d = JSON.parse(String(d || '{}'));
    } catch (_) {
      d = null;
    }
  }
  if (!d || !d.output_url)
    throw new Error(d && d.status ? d.status : 'remote engine failed');
  const bin = await http.get(d.output_url, { responseType: 'arraybuffer' });
  fs.writeFileSync(outPath, Buffer.from(bin.data));
  return { engine: 'deepai', url: d.output_url };
}

async function runEnhanceEngines(inputPath, outPath) {
  const key = process.env.REMINI_DEEPAI_KEY;
  if (key) {
    try {
      return await deepaiRemoteEngine(inputPath, outPath, key);
    } catch (e) {
      console.error(
        `[engine] deepai failed: ${e.message || e} -> fallback local`,
      );
    }
  }
  let localError = null;
  for (let i = 1; i <= 2; i++) {
    try {
      const dims = await localEnhance(inputPath, outPath);
      return { engine: 'local', url: null, ...dims };
    } catch (e) {
      localError = e;
    }
  }
  throw localError || new Error('all engines failed');
}

async function enhance(source, opts = {}) {
  const start = Date.now();
  const job_id = mkJobId('enhance');
  const base = {
    status: false,
    feature: DEFAULT_FEATURE,
    original_image: null,
    enhanced_image: null,
    original_filename: null,
    output_filename: null,
    original_size: null,
    output_size: null,
    original_resolution: null,
    output_resolution: null,
    output_format: null,
    processing_time: null,
    job_id,
    error: null,
  };
  let appIdOk = null;
  try {
    let app = null;
    try {
      app = await scrapeReminiApp(TARGET_URL, {
        attempts: opts.appAttempts || 3,
        timeout: 60000,
      });
      appIdOk = `scraped ${app.http_code} (${
        (app.screenshots || []).length
      } screenshots, rating ${app.rating})`;
    } catch (e) {
      appIdOk = `scrape failed: ${e.message} -> fallback "${DEFAULT_FEATURE}"`;
    }
    base.feature = (app && app.feature) || DEFAULT_FEATURE;

    const resolved = resolveInputPath(source);
    const dl = await downloadIfUrl(resolved);
    const inputPath = dl.inputPath;
    const inStat = fs.statSync(inputPath);
    const inImg = await Jimp.read(inputPath).catch(() => null);
    if (!inImg)
      throw new Error('input is not a readable image (png/jpg/bmp/tiff/gif)');

    const original_filename = path.basename(inputPath);
    const original_image = dl.originalUrl || path.resolve(inputPath);
    const output_filename = original_filename.replace(/\.[^.]+$/, '') +
      '_hd.jpg';

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, output_filename);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

    const engine = await runEnhanceEngines(inputPath, outPath);
    const outStat = fs.statSync(outPath);
    const outImg = await Jimp.read(outPath).catch(() => null);
    if (!outImg && !engine.width)
      throw new Error('enhanced output unreadable');
    const outRes = outImg
      ? `${outImg.bitmap.width}x${outImg.bitmap.height}`
      : `${engine.width}x${engine.height}`;
    const ms = Date.now() - start;
    const result = {
      status: true,
      feature: base.feature,
      original_image: original_image,
      enhanced_image: engine.url || path.resolve(outPath),
      original_filename,
      output_filename,
      original_size: fmtBytes(inStat.size),
      output_size: fmtBytes(outStat.size),
      original_resolution: `${inImg.bitmap.width}x${inImg.bitmap.height}`,
      output_resolution: outRes,
      output_format: 'jpg',
      processing_time: `${(ms / 1000).toFixed(1)}s`,
      job_id: base.job_id,
      error: null,
    };
    if (app)
      console.log(
        `[target] ${app.name} | ${app.developer} | ${appIdOk}`,
      );
    else console.log(`[target] ${appIdOk || DEFAULT_FEATURE}`);
    if (dl.fromTmp) fs.unlinkSync(inputPath);
    return result;
  } catch (e) {
    const result = { ...base, status: false, error: String(e.message || e) };
    result.processing_time = `${((Date.now() - start) / 1000).toFixed(1)}s`;
    console.error(`[error] ${result.error}`);
    return result;
  }
}

export default {
  name:        'Remini Image Enhancer',
  description:
    'Perbaiki/kualitas foto menggunakan Remini-style AI enhancer (local Jimp + opsional DeepAI). ' +
    'Scrape data aplikasi Remini dari Play Store juga disediakan.',
  category:    'Image',
  methods:     ['POST'],
  params:      ['source', 'engine'],

  paramsSchema: {
    source: {
      type:        'string',
      required:    true,
      description: 'URL gambar (png/jpg/bmp/tiff/gif)',
      example:     'https://example.com/image.png',
    },
    engine: {
      type:        'string',
      required:    false,
      description: 'Engine enchants (local / deepai)',
      default:     'local',
      enum:        ['local', 'deepai'],
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    const params    = { ...req.body, ...req.query };
    const source    = String(params.source ?? '').trim();
    const engine    = String(params.engine ?? 'local').toLowerCase();

    if (!source) {
      return res.status(400).json({
        status:  false,
        message: 'Parameter source wajib diisi (path file atau URL gambar).',
      });
    }

    try {
      const result = await enhance(source, { engine });

      if (!result.status || !result.enhanced_image) {
        const elapsed = Date.now() - startTime;
        return res.status(500).json({
          status:  false,
          message: result.error || 'Gagal memproses gambar.',
          result: {
            api_time: `${elapsed}ms`,
            error:   result.error,
          },
        });
      }

      // Merespons image JPG hasil enhance langsung (binary)
      const enhancedPath = result.enhanced_image;
      if (typeof enhancedPath === 'string' && fs.existsSync(enhancedPath)) {
        const buffer = fs.readFileSync(enhancedPath);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Content-Disposition', `inline; filename="${result.output_filename || 'enhanced.jpg'}"`);
        return res.send(buffer);
      }

      // Fallback: merespons JSON jika file tidak ada
      const elapsed = Date.now() - startTime;
      return res.json({
        status: true,
        result: {
          ...result,
          api_time: `${elapsed}ms`,
        },
      });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      return res.status(500).json({
        status:  false,
        message: err.message || 'Gagal memproses gambar.',
        result: {
          api_time: `${elapsed}ms`,
          error:   err.message,
        },
      });
    }
  },
};
