/**
 * Reach CH v2 — WhatsApp Channel Reaction Automation
 * Fitur : Reaksi emoji ke postingan WhatsApp Channel, tanpa captcha & tanpa API key
 * Mode  : Fast Response / Background Processing
 */

import axios from 'axios';
import logger from '../../src/utils/logger.js';

const API_URL = 'https://ntphwaiqleggrlqkshiw.supabase.co/functions/v1/quick-task';
const MAX_EMOJI = 3;
const TIMEOUT_MS = 180_000;

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

const LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/(\d+)/i;
const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?/gu;

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomIP = () => Array.from({ length: 4 }, () => randInt(1, 254)).join('.');

/**
 * Normalisasi link channel menjadi URL kanonik
 */
function parseLink(raw) {
  const m = String(raw || '').trim().match(LINK_REGEX);
  if (!m) return null;
  return {
    url: `https://whatsapp.com/channel/${m[1]}/${m[2]}`,
    channelId: m[1],
    messageId: m[2]
  };
}

/**
 * Ambil maksimal MAX_EMOJI emoji unik dari input (string bebas, bisa dipisah koma/spasi)
 */
function parseEmojis(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const joined = raw.map(String).join(' ');
    return [...new Set(joined.match(EMOJI_RE) || [])].slice(0, MAX_EMOJI);
  }
  return [...new Set(String(raw).match(EMOJI_RE) || [])].slice(0, MAX_EMOJI);
}

/**
 * Kirim reaksi emoji ke WhatsApp Channel via upstream quick-task
 */
async function sendReaction(link, emojis, customIp = null) {
  const ip = customIp || randomIP();
  const { status, data } = await axios.post(API_URL, {
    action: 'react',
    link: link,
    emojis: emojis
  }, {
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
      'X-Forwarded-For': ip,
      'X-Real-IP': ip
    },
    validateStatus: () => true
  });

  return { status, data, ip };
}

/**
 * Cek status kuota coin
 */
async function getStatus(customIp = null) {
  const ip = customIp || randomIP();
  const { status, data } = await axios.post(API_URL, {
    action: 'status'
  }, {
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
      'X-Forwarded-For': ip,
      'X-Real-IP': ip
    },
    validateStatus: () => true
  });

  return { status, data, ip };
}

export default {
  name: "Reach CH v2",
  description: "Kirim reaksi emoji otomatis ke postingan WhatsApp Channel tanpa captcha (Fast Response / Background Process)",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["url", "emoji"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      default: "",
      description: "Link postingan WhatsApp Channel (contoh: https://whatsapp.com/channel/0029Vb9GRyt6buMOcTKWse08/110)",
      example: "https://whatsapp.com/channel/0029Vb9GRyt6buMOcTKWse08/110"
    },
    emoji: {
      type: "string",
      required: true,
      default: "",
      description: `Emoji reaksi, maksimal ${MAX_EMOJI} (contoh: 💥, 🥰, atau dipisah koma jika multi emoji)`,
      example: "🥰"
    },
    wait: {
      type: "boolean",
      required: false,
      default: false,
      description: "Jika true, request akan menunggu proses selesai (sinkron). Jika false, diproses di background."
    }
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };

      // Opsi cek status koin
      if (params.action === 'status') {
        const { data, ip } = await getStatus(params.ip);
        return res.status(200).json({
          status: true,
          ipUsed: ip,
          data
        });
      }

      const rawLink = params.url || params.link || params.channelLink || '';
      const rawEmoji = params.emoji || params.emojis || '';
      const emojis = parseEmojis(rawEmoji);
      const shouldWait = params.wait === 'true' || params.wait === true || params.sync === 'true';

      if (!rawLink) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi dengan tautan postingan channel WhatsApp."
        });
      }

      const link = parseLink(rawLink);
      if (!link) {
        return res.status(400).json({
          status: false,
          message: "Format URL tidak valid. Contoh yang benar: https://whatsapp.com/channel/0029Vb9GRyt6buMOcTKWse08/110"
        });
      }

      if (!emojis.length) {
        return res.status(400).json({
          status: false,
          message: `Parameter 'emoji' wajib diisi dengan 1-${MAX_EMOJI} emoji.`
        });
      }

      logger.info(`[REACH-CH-V2] Dispatching reaksi [${emojis.join(', ')}] ke ${link.url} (wait=${shouldWait})`);

      const meta = {
        channelUrl: link.url,
        channelId: link.channelId,
        messageId: link.messageId,
        emojis
      };

      if (shouldWait) {
        const { status, data, ip } = await sendReaction(link.url, emojis, params.ip);
        if (!data || !data.success) {
          return res.status(status >= 400 ? status : 400).json({
            status: false,
            message: data?.error || data?.message || "Gagal mengirim reaksi ke channel",
            error: data
          });
        }
        return res.status(200).json({
          status: true,
          message: data.message || `Reaksi berhasil dikirim ke ${data.reacted || 0} sesi.`,
          result: {
            ...meta,
            reacted: data.reacted ?? null,
            totalSessions: data.totalSessions ?? null,
            coinLeft: data.total ?? null,
            ipUsed: ip,
            mode: "sync"
          }
        });
      }

      // Background mode
      sendReaction(link.url, emojis, params.ip)
        .then(({ status, data, ip }) => {
          if (data && data.success) {
            logger.info(`[REACH-CH-V2] Background task SUKSES [${emojis.join(', ')}] -> ${link.url} (${data.reacted} sesi, IP: ${ip})`);
          } else {
            logger.warn(`[REACH-CH-V2] Background task GAGAL (${status}): ${data?.error || data?.message || JSON.stringify(data)}`);
          }
        })
        .catch((err) => {
          logger.error(`[REACH-CH-V2] Background task ERROR: ${err.message}`);
        });

      return res.status(200).json({
        status: true,
        message: "Reaction berhasil diterima dan sedang diproses di latar belakang!",
        result: {
          ...meta,
          status: "processing",
          mode: "background"
        }
      });

    } catch (err) {
      logger.error(`[REACH-CH-V2] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Terjadi kesalahan internal saat memproses reaksi"
      });
    }
  }
};
