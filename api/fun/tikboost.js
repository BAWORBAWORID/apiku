import axios from "axios";
import logger from "../../src/utils/logger.js";

async function sendRequest(tiktokUrl, quantity, token = "") {
  const data = new URLSearchParams({
    ns_action: "freetool_start",
    "freetool[id]": "3",
    "freetool[token]": token,
    "freetool[process_item]": tiktokUrl,
    "freetool[quantity]": String(quantity),
  });

  const response = await axios.post("https://tiksta.com/action/", data.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 20000,
  });

  return response.data;
}

async function boostLikes(tiktokUrl, targetLikes) {
  const maxPerDevice = 20;
  const minPerDevice = 10;

  let remaining = targetLikes;
  const devices = [];

  while (remaining > 0) {
    if (remaining >= maxPerDevice) {
      devices.push(maxPerDevice);
      remaining -= maxPerDevice;
    } else if (remaining >= minPerDevice) {
      devices.push(remaining);
      remaining = 0;
    } else {
      if (devices.length > 0 && devices[devices.length - 1] < maxPerDevice) {
        devices[devices.length - 1] += remaining;
      } else {
        devices.push(remaining);
      }
      remaining = 0;
    }
  }

  const logs = [];
  let successfulSessions = 0;

  for (let i = 0; i < devices.length; i++) {
    const qty = devices[i];
    try {
      const startRes = await sendRequest(tiktokUrl, qty, "");

      if (!startRes.statu) {
        logs.push(`Session ${i + 1} (qty: ${qty}) failed: ${startRes.alert?.text || "Gagal inisialisasi"}`);
        continue;
      }

      const token = startRes.freetool_process_token;
      const finishRes = await sendRequest(tiktokUrl, qty, token);

      if (finishRes.statu) {
        successfulSessions++;
        logs.push(`Session ${i + 1} (qty: ${qty}) successfully processed.`);
      } else {
        logs.push(`Session ${i + 1} (qty: ${qty}) failed: ${finishRes.alert?.text || "Gagal eksekusi"}`);
      }
    } catch (err) {
      logs.push(`Session ${i + 1} (qty: ${qty}) error: ${err.message}`);
    }
  }

  return {
    target: targetLikes,
    total_sessions: devices.length,
    successful_sessions: successfulSessions,
    logs,
  };
}

export default {
  name: "TikTok Like Booster (TikBoost)",
  description: "Auto boost likes/views pada video TikTok target (Maksimal 50).",
  category: "Fun",
  methods: ["GET", "POST"],
  params: ["url", "amount"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL video TikTok yang ingin di-boost",
      example: "https://vt.tiktok.com/ZSxG2tLqL/",
    },
    amount: {
      type: "number",
      required: false,
      default: 20,
      description: "Jumlah booster target (Maksimal 50)",
      example: 50,
    },
  },

  async run(req, res) {
    try {
      const { url, amount } = { ...req.query, ...req.body };

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        });
      }

      const cleanUrl = url.trim();
      const rawAmount = amount ? parseInt(amount) : 20;

      if (isNaN(rawAmount) || rawAmount < 1 || rawAmount > 50) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'amount' harus berupa angka antara 1 dan 50",
        });
      }

      logger.info(`[TIKBOOST] Boosting ${cleanUrl} with target amount: ${rawAmount}`);
      const result = await boostLikes(cleanUrl, rawAmount);

      res.json({
        status: true,
        result,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error(`TikTok Boost API Error: ${err.message}`);
      res.status(500).json({
        status: false,
        message: err.message || "Gagal menjalankan booster",
        timestamp: Date.now(),
      });
    }
  },
};
