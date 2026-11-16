/**
 * DeepChat — chat AI multi-provider via Supabase edge functions.
 * Sumber: DeepChat API client (attachment user, 2026-11-09).
 * Endpoint apiku: /api/ai/deepchat
 */

import { createHmac, createHash, randomUUID } from 'node:crypto';

const BASE_URL = 'https://uebueqfehjrruiwrbmgs.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlYnVlcWZlaGpycnVpd3JibWdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NTI0NDYsImV4cCI6MjA4ODQyODQ0Nn0.pC43b2gMMx44q7_SUfJDM_ceLaYWeMzKI4QvMwz_AxU';

let cachedSession = null;
const BOOTSTRAP_UA = 'Ktor client';

function buildSignedHeaders(endpoint, bodyStr, session) {
  const timestampSec = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const idempotencyKey = randomUUID();
  const bodySha256 = createHash('sha256').update(bodyStr, 'utf-8').digest('hex');
  const message = `POST\n${endpoint}\n${timestampSec}\n${nonce}\n${bodySha256}`;
  const secretBytes = Buffer.from(session.signingSecret, 'hex');
  const signature = createHmac('sha256', secretBytes).update(message, 'utf-8').digest('hex');

  return {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${session.accessToken}`,
    'X-Request-Timestamp': String(timestampSec),
    'X-Idempotency-Key': idempotencyKey,
    'X-Request-Signature': signature,
    'X-Request-Nonce': nonce,
    'User-Agent': BOOTSTRAP_UA,
  };
}

async function bootstrap() {
  const signupRes = await fetch(`${BASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'User-Agent': BOOTSTRAP_UA },
    body: JSON.stringify({}),
  });
  if (!signupRes.ok) throw new Error(`Anonymous auth failed: HTTP ${signupRes.status}`);
  const signupData = await signupRes.json();
  const accessToken = signupData.access_token;
  const anonUserId = signupData.user?.id;

  const createRes = await fetch(`${BASE_URL}/functions/v1/create-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${accessToken}`, 'User-Agent': BOOTSTRAP_UA },
    body: JSON.stringify({ userId: anonUserId }),
  });
  if (!createRes.ok) throw new Error(`Create user failed: HTTP ${createRes.status}`);
  const createData = await createRes.json();

  cachedSession = {
    accessToken,
    userId: anonUserId,
    signingSecret: createData.signingSecret,
    credits: createData.credits,
    creditsExpiry: createData.creditsExpiry,
  };
  return cachedSession;
}

async function requestEndpoint(endpoint, payload, isRetry = false) {
  if (!cachedSession) await bootstrap();

  const bodyStr = JSON.stringify(payload);
  const headers = buildSignedHeaders(endpoint, bodyStr, cachedSession);

  let res = await fetch(`${BASE_URL}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  if ((res.status === 401 || res.status === 402) && !isRetry) {
    for (let i = 0; i < 5; i++) {
      const claimRes = await fetch(`${BASE_URL}/functions/v1/claim-ad-reward`, {
        method: 'POST',
        headers: buildSignedHeaders('claim-ad-reward', '{}', cachedSession),
        body: '{}',
      });
      const claimData = await claimRes.json().catch(() => null);
      if (!claimData || !claimData.success) {
        await bootstrap();
        break;
      }
    }
    return requestEndpoint(endpoint, payload, true);
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`[${endpoint}] HTTP ${res.status}: ${errorText.slice(0, 300)}`);
  }

  return await res.json();
}

async function chat(message, { model } = {}) {
  const data = await requestEndpoint('send-message', {
    message: String(message).trim(),
    providerId: 'chatgpt',
    modelId: model || 'gpt-4o-mini',
  });
  return {
    reply: data.reply || '',
    model: data.model || model || 'gpt-4o-mini',
    creditsUsed: data.creditsUsed ?? 0,
    creditsRemaining: data.creditsRemaining ?? 0,
  };
}

async function generateImage(prompt) {
  const data = await requestEndpoint('generate-image', {
    prompt: String(prompt).trim(),
    providerId: 'flux',
    modelId: 'flux/schnell',
    size: '1024x1024',
    quality: 'standard',
    n: 1,
  });
  return {
    images: (data.images || []).map((img) => img.url || img),
    provider: 'flux',
    model: data.model || 'flux/schnell',
    creditsUsed: data.creditsUsed ?? 0,
    creditsRemaining: data.creditsRemaining ?? 0,
  };
}

export default {
  name: "DeepChat",
  description:
    "Chat AI (chatgpt/gpt-4o-mini dkk) & generate gambar (FLUX) via DeepChat API. Auto-bootstrap akun + kredit gratis per sesi.",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["text", "model"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pesan chat atau prompt gambar",
      example: "Jelaskan teori relativitas singkat",
      minLength: 1,
      maxLength: 8000,
    },
    model: {
      type: "string",
      required: false,
      description:
        "Model untuk chat (default gpt-4o-mini). Contoh: gpt-4o-mini, gpt-4.1, claude-haiku-4-5-20251001. Hanya berlaku untuk chat; image selalu flux/schnell.",
      example: "gpt-4o-mini",
    },
  },

  async run(req, res) {
    const action = (req.query.action || req.body?.action || "chat").toLowerCase();
    const text = req.query.text || req.body?.text || req.query.question || req.body?.question || "";
    const model = req.query.model || req.body?.model || "";

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        status: false,
        error: "text is required (string)",
      });
    }

    try {
      if (action === "image") {
        const r = await generateImage(text);
        return res.json({
          status: true,
          result: { images: r.images, provider: r.provider, model: r.model },
          session_id: req.sessionID || null,
          timestamp: new Date().toISOString(),
          attribution: "@zyvorapi",
        });
      }

      // default: chat
      const r = await chat(text, { model: model || undefined });
      return res.json({
        status: true,
        result: { reply: r.reply, model: r.model },
        session_id: req.sessionID || null,
        timestamp: new Date().toISOString(),
        attribution: "@zyvorapi",
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        error: err.message,
      });
    }
  },
};
