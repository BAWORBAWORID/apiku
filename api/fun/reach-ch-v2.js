/**
 * Reach CH v2 — WhatsApp Channel Reaction
 * Provider: api-cloud.my.id (Kaze) — endpoint /tools/rchv2
 * Status  : VIP (dikonfigurasi lewat configuration.json endpointsStatus)
 *
 * GET/POST /api/fun/reach-ch-v2?link=<wa-channel-post>&emoji=<emoji[,emoji...]>
 */

import logger from '../../src/utils/logger.js';

const RCH_API = 'https://api-cloud.my.id/tools/rchv2';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/** Parse input emoji (string tunggal, dipisah koma, atau multiple grapheme). */
function parseEmojis(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const str = String(raw).trim();
  if (!str) return [];
  if (str.includes(',')) {
    return str.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segs = [...segmenter.segment(str)].map((s) => s.segment).filter((s) => s.trim());
  return segs.length ? segs : [str];
}

/** Kirim reaksi ke endpoint upstream rchv2. */
async function sendReaction(url, emojis) {
  const endpoint = `${RCH_API}?link=${encodeURIComponent(url)}&emoji=${encodeURIComponent(emojis.join(','))}`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(25000),
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data, endpoint };
}

export default {
  name: 'Reach CH v2',
  description: 'Kirim reaksi emoji ke postingan WhatsApp Channel via rchv2 (multi-emoji, fast)',
  category: 'Fun',
  methods: ['GET', 'POST'],
  params: ['link', 'emoji'],
  paramsSchema: {
    link: {
      type: 'string',
      required: true,
      description: 'Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/xxx/123)',
      example: 'https://whatsapp.com/channel/0029Vb8kYQcK5cDFoQ3NAK2x/141',
    },
    emoji: {
      type: 'string',
      required: true,
      description: 'Emoji reaksi (bisa banyak, pisah koma)',
      example: '🥵',
    },
  },

  async run(req, res) {
    const start = Date.now();
    try {
      const params = { ...req.query, ...req.body };
      const url = String(params.link || params.url || '').trim();
      const emojis = parseEmojis(params.emoji || params.emojis || '');

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'link' wajib diisi.",
        });
      }

      // Proteksi saluran terlindungi (sama seperti reach-ch)
      const channelId = (url.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i) || [])[1];
      if (channelId === '0029Vb8vO7o2f3EEsjefzm0w') {
        logger.warn(`[REACH-CH-V2] Akses ditolak: saluran ${channelId} dilindungi.`);
        return res.status(403).json({
          status: false,
          protected: true,
          channel_id: channelId,
          message: 'Saluran ini dilindungi (Protected Channel).',
        });
      }

      if (!emojis.length) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'emoji' wajib diisi.",
        });
      }

      if (!/^https?:\/\/(www\.)?whatsapp\.com\/channel\/[^/]+\/\d+/i.test(url)) {
        return res.status(400).json({
          status: false,
          message: 'Format URL tidak valid. Contoh: https://whatsapp.com/channel/0029Vb8EfuN35fM5AX25AT1W/1360',
        });
      }

      logger.info(`[REACH-CH-V2] Kirim reaksi [${emojis.join(', ')}] ke ${url}`);

      const { status, data } = await sendReaction(url, emojis);
      const r = data?.result || {};

      if (status !== 200 || !data?.status) {
        return res.status(status >= 400 ? status : 502).json({
          status: false,
          message: data?.message || `Upstream HTTP ${status}`,
        });
      }

      return res.json({
        status: true,
        message: r.message || 'Reaksi berhasil dikirim',
        link: r.link || url,
        emoji: r.emoji || emojis,
        total: r.total ?? null,
        sukses: r.sukses ?? null,
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    } catch (err) {
      logger.error(`[REACH-CH-V2] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal mengirim reaction.',
        responseTime: `${Date.now() - start}ms`,
      });
    }
  },
};
