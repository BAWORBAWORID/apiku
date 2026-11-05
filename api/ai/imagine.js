import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const BASE_URL = 'https://imagine-ai-dot-calaiproject-471016.uc.r.appspot.com';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_ATTEMPTS = 40;
const TERMINAL_STATES = new Set(['completed', 'failed', 'error']);

export const STYLES = Object.freeze([
  'None', 'Classic', 'Cyberpunk', 'Anime', 'Model Shoot', 'AI Avatar',
  'Royal Portrait', 'Superhero', 'Comic Book', 'Warrior', 'Disney',
  'GTA Style', 'AI Selfie', 'Action Figure', 'Lego Portrait', 'Cartoon',
  'AI Cosplay', 'Military', 'Tattoo Look', 'Pet Portrait', 'AI Haircut',
]);

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function extractErrorDetail(json, raw) {
  const detail = json ? json.detail : null;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return String(raw).slice(0, 300);
}

async function request(path, options = {}) {
  const { method = 'GET', body, headers = {}, timeout = DEFAULT_TIMEOUT_MS } = options;
  const timer = withTimeout(timeout);
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: timer.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    let json = null;
    if (contentType.includes('json')) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status + ' ' + path + ': ' + extractErrorDetail(json, raw));
      err.status = res.status;
      err.detail = json ? json.detail : raw;
      throw err;
    }
    return json === null ? raw : json;
  } finally {
    timer.done();
  }
}

async function toBlobPart(input) {
  if (typeof input === 'string') {
    const buf = await readFile(input);
    return { blob: new Blob([buf]), filename: basename(input) };
  }
  if (input instanceof Uint8Array) {
    return { blob: new Blob([input]), filename: 'image' };
  }
  if (input instanceof Blob) {
    return { blob: input, filename: input.name || 'image' };
  }
  throw new TypeError('Image input must be a file path, Buffer/Uint8Array, or Blob');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getStyles() {
  return request('/styles');
}

export async function validateImage(image) {
  const entry = await toBlobPart(image);
  const form = new FormData();
  form.append('file', entry.blob, entry.filename);
  return request('/validate', { method: 'POST', body: form, timeout: 60000 });
}

export async function uploadImages(images) {
  if (!Array.isArray(images) || images.length < 2 || images.length > 10) {
    throw new RangeError('uploadImages requires between 2 and 10 images');
  }
  const entries = await Promise.all(images.map(toBlobPart));
  const form = new FormData();
  for (const entry of entries) {
    form.append('files', entry.blob, entry.filename);
  }
  const data = await request('/upload/images', {
    method: 'POST',
    body: form,
    timeout: 180000,
  });
  if (!data || !data.session_id) throw new Error('Upload succeeded but no session_id returned');
  return { session_id: data.session_id };
}

export async function requestGeneration(params) {
  if (!params || !params.session_id) throw new TypeError('session_id is required');
  if (!params.style_id) throw new TypeError('style_id is required');
  if (typeof params.user_prompt !== 'string' || !params.user_prompt.trim()) {
    throw new TypeError('user_prompt must be a non-empty string');
  }
  return request('/generate/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: params.session_id,
      style_id: params.style_id,
      user_prompt: params.user_prompt,
    }),
    timeout: 60000,
  });
}

export async function getResult(job_id) {
  if (!job_id) throw new TypeError('job_id is required');
  return request('/generate/result/' + encodeURIComponent(job_id), { timeout: 60000 });
}

export async function waitForResult(job_id, options = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const attempts = options.attempts ?? DEFAULT_POLL_ATTEMPTS;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await getResult(job_id);
    if (TERMINAL_STATES.has(last.status)) return last;
    await sleep(intervalMs);
  }
  return last;
}

export async function downloadImage(url) {
  if (!url) throw new TypeError('url is required');
  const timer = withTimeout(DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: timer.signal });
    if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      size: buffer.length,
    };
  } finally {
    timer.done();
  }
}

export async function generate(options) {
  if (!options) throw new TypeError('options is required');
  const uploaded = await uploadImages(options.images);
  const queued = await requestGeneration({
    session_id: uploaded.session_id,
    style_id: options.styleId,
    user_prompt: options.prompt,
  });
  const final = await waitForResult(queued.job_id, {
    intervalMs: options.intervalMs,
    attempts: options.attempts,
  });
  let image = null;
  if (final.result_url) {
    image = await downloadImage(final.result_url);
  }
  return {
    session_id: uploaded.session_id,
    job_id: queued.job_id,
    status: final.status,
    result_url: final.result_url ?? null,
    metadata: final.metadata ?? null,
    image,
  };
}

export default {
  BASE_URL,
  STYLES,
  getStyles,
  validateImage,
  uploadImages,
  requestGeneration,
  getResult,
  waitForResult,
  downloadImage,
  generate,
};