import { randomUUID, createHmac } from 'node:crypto';

const SECRET = '6152b408309197fcf6acdd3416442af571b1c5f850dc0f794e15cd1023bd1e02';
const BASE_URL = 'https://lensapp.io/appbackend';
const UA = 'okhttp/4.12.0';
const BLANK_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function signHeaders() {
  const device = randomUUID().toUpperCase();
  const time = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', SECRET).update(`${time}.${device}`).digest('hex');
  return {
    'User-Agent': UA,
    'X-App-Time': time,
    'X-App-Device': device,
    'X-App-Signature': sig
  };
}

async function resolveImageBuffer(input) {
  if (!input) return Buffer.from(BLANK_JPEG, 'base64');
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const res = await fetch(input, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (input.includes('base64,')) {
      return Buffer.from(input.split('base64,')[1], 'base64');
    }
    try {
      const decoded = Buffer.from(input, 'base64');
      if (decoded.length > 32) return decoded;
    } catch {}
  }
  return Buffer.from(BLANK_JPEG, 'base64');
}

export default {
  name: "AI Lens Chat (Vision)",
  description: "Chat AI multimodal dengan dukungan Vision (kirim gambar via URL/base64) — powered by LensApp",
  category: "AI Chat",
  methods: ["GET", "POST"],
  params: ["prompt", "image"],
  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan untuk AI",
      example: "Jelaskan gambar ini"
    },
    image: {
      type: "string",
      required: false,
      description: "URL gambar / base64 (opsional, kosong = chat teks saja)",
      example: "https://example.com/foto.jpg"
    }
  },

  async run(req, res) {
    try {
      const q = { ...req.query, ...req.body };
      const prompt = q.prompt || q.text || q.message || q.q;
      const imageInput = q.image || q.imageUrl || q.url || null;

      if (!prompt) {
        return res.status(400).json({
          status: false,
          error: "Parameter 'prompt' (atau 'text') wajib diisi",
          session_id: randomUUID(),
          timestamp: new Date().toISOString(),
          attribution: "@zyvorapi"
        });
      }

      const formData = new FormData();
      if (imageInput) {
        const imageBuf = await resolveImageBuffer(imageInput);
        formData.append('image', new Blob([imageBuf], { type: 'image/jpeg' }), 'vision.jpg');
      }
      formData.append('messages', JSON.stringify([{ role: 'user', content: prompt }]));

      const apiRes = await fetch(`${BASE_URL}/chat.php`, {
        method: 'POST',
        headers: signHeaders(),
        body: formData
      });

      if (!apiRes.ok) {
        throw new Error(`Lens upstream gagal: ${apiRes.status}`);
      }

      const data = await apiRes.json();
      if (!data.success) {
        throw new Error(data.error || 'AI Vision Chat gagal');
      }

      return res.status(200).json({
        status: true,
        result: data,
        session_id: randomUUID(),
        timestamp: new Date().toISOString(),
        attribution: "@zyvorapi"
      });

    } catch (err) {
      return res.status(500).json({
        status: false,
        error: err.message,
        session_id: randomUUID(),
        timestamp: new Date().toISOString(),
        attribution: "@zyvorapi"
      });
    }
  }
};
