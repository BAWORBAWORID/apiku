import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const BASE_URL = 'https://api2.ashirwadinfotech.com:22993';

// ─── Blob dari URL / path file (tanpa require, ESM) ──────────────────────────
async function toBlob(input) {
  if (/^https?:\/\//i.test(input)) {
    let res = await fetch(input);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      const html = await res.text();
      const m =
        html.match(/<img[^>]+id=["']img_preview["'][^>]+src=["']([^"']+)["']/i) ||
        html.match(/<a[^>]+class=["']download["'][^>]+href=["']([^"']+)["']/i);
      if (m) res = await fetch(m[1]);
    }
    return await res.blob();
  }
  const p = path.resolve(process.cwd(), input);
  if (!fs.existsSync(p)) throw new Error(`file tidak ditemukan: ${input}`);
  return new Blob([fs.readFileSync(p)]);
}

// ─── device session ──────────────────────────────────────────────────────────
async function createDeviceSession() {
  const id = randomBytes(8).toString('hex');
  const form = new FormData();
  form.append('android_id', id);
  form.append('app_id', 'dalle2-bhargav');
  form.append('in_app', '');
  form.append('in_app_sku', '');
  form.append('app_version', '20');
  form.append('package_name', 'com.bhargav.nanobananaai');
  form.append('is_premium', 'false');
  form.append('fcm_token', '');
  form.append('country_code', 'US');

  const res = await fetch(`${BASE_URL}/api/image/android-app-config/`, {
    method: 'POST',
    headers: { 'User-Agent': 'okhttp/4.12.0' },
    body: form,
  });
  if (!res.ok) throw new Error('Device initialization failed');
  return id;
}

// ─── polling job ─────────────────────────────────────────────────────────────
async function pollJob(jobId, timeoutMs = 120000) {
  const start = Date.now();
  const pollUrl = `${BASE_URL}/api/image/image-generator/${jobId}/`;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(pollUrl, {
      headers: { 'User-Agent': 'okhttp/4.12.0' },
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') return data.output;
    if (data.status === 'FAILED')
      throw new Error(data.error || 'Generation failed');
  }
  throw new Error('Polling timeout');
}

// ─── eksekusi tugas ──────────────────────────────────────────────────────────
async function executeTask({ imageBlob, prompt = '', processType, extraFields = {}, timeoutMs = 120000 }) {
  const androidId = await createDeviceSession();
  const form = new FormData();
  if (imageBlob) form.append('image', imageBlob, 'input.png');
  form.append('prompt', prompt);
  form.append('app_id', 'dalle2-bhargav');
  form.append('android_id', androidId);
  form.append('is_premium', 'false');
  form.append('app_version', '20');
  form.append('process_type', processType);
  form.append('image_style', extraFields.style || '');
  form.append('aspect_ratio', extraFields.aspectRatio || 'square');
  form.append('scale', String(extraFields.scale || 12));
  form.append('steps', String(extraFields.steps || 20));
  form.append('enhance', 'false');
  form.append('baby_gender', '');
  form.append('baby_age', '');
  form.append('cloth_type', '');
  form.append('room_style', '');
  form.append('interior_style', '');
  form.append('color_palette', '');
  form.append('is_ref_image', imageBlob ? 'true' : 'false');
  form.append('name', '');
  form.append('accessories', '');
  form.append('country_code', 'US');
  form.append('trend_name', extraFields.trendName || processType);
  form.append('use_queue', 'true');

  for (const [k, v] of Object.entries(extraFields)) {
    if (!['style', 'aspectRatio', 'scale', 'steps', 'trendName'].includes(k)) {
      form.set(k, String(v));
    }
  }

  const res = await fetch(`${BASE_URL}/api/image/image-generator/`, {
    method: 'POST',
    headers: { 'User-Agent': 'okhttp/4.12.0' },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.[0] || data.output?.[0] || 'Request failed');
  }

  const url = await pollJob(data.job_id, timeoutMs);
  return { success: true, url, jobId: data.job_id };
}

// ─── endpoint ────────────────────────────────────────────────────────────────
export default {
  name: 'NanoBanana AI',
  description:
    'AI image edit / generate via NanoBanana backend (api2.ashirwadinfotech.com:22993). ' +
    'Kirim url gambar + prompt, balasan berupa JSON berisi URL hasil (bukan binary).',
  category: 'Image',
  methods: ['GET', 'POST'],
  params: ['url', 'prompt', 'type'],

  paramsSchema: {
    url: {
      type: 'string',
      required: true,
      description: 'URL gambar sumber',
      example: 'https://example.com/photo.jpg',
    },
    prompt: {
      type: 'string',
      required: false,
      description: 'Instruksi edit (default: enhance foto)',
      default: 'enhance this photo, high quality, hd, detailed',
    },
    type: {
      type: 'string',
      required: false,
      description: 'Mode: img2img | removebg | upscale | text',
      default: 'img2img',
      enum: ['img2img', 'removebg', 'upscale', 'text'],
    },
  },

  async run(req, res) {
    const startTime = Date.now();
    try {
      const params = { ...req.body, ...req.query };
      const url = String(params.url ?? '').trim();
      const prompt = String(params.prompt ?? 'enhance this photo, high quality, hd, detailed').trim();
      const type = String(params.type ?? 'img2img').toLowerCase();
      const scale = Number(params.scale) || 2;

      if (!url && type !== 'text') {
        return res.status(400).json({
          status: false,
          message: 'Parameter url wajib diisi (kecuali type=text).',
        });
      }

      let result;
      switch (type) {
        case 'text': {
          if (!prompt) throw new Error('prompt wajib untuk type=text');
          result = await executeTask({ prompt, processType: 'text_to_image' });
          break;
        }
        case 'img2img': {
          const imageBlob = await toBlob(url);
          result = await executeTask({ imageBlob, prompt, processType: 'image_to_image' });
          break;
        }
        case 'removebg': {
          const imageBlob = await toBlob(url);
          result = await executeTask({
            imageBlob,
            processType: 'remove_bg',
            extraFields: { trendName: 'Remove Background' },
          });
          break;
        }
        case 'upscale': {
          const imageBlob = await toBlob(url);
          result = await executeTask({
            imageBlob,
            processType: 'image_upscale',
            extraFields: { upscale_value: scale, trendName: 'Image Enhance' },
          });
          break;
        }
        default:
          return res.status(400).json({
            status: false,
            message: 'type tidak dikenal. Pilih: img2img | removebg | upscale | text',
          });
      }

      // Respon JSON SAJA (bukan binary) — format: { status, prompt, result, api_time }
      return res.json({
        status:    true,
        prompt,
        result,
        api_time:  `${Date.now() - startTime}ms`,
      });
    } catch (err) {
      console.error(`[nanobanana] ${err.message || err}`);
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal memproses NanoBanana.',
        api_time: `${Date.now() - startTime}ms`,
      });
    }
  },
};
