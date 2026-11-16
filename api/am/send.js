import axios from "axios";
import logger from "../../src/utils/logger.js";

const BASE_URL = "https://amgen30bjiyyad.vercel.app";

function generateRandomIp() {
  return [
    Math.floor(Math.random() * 200) + 20,
    Math.floor(Math.random() * 250) + 1,
    Math.floor(Math.random() * 250) + 1,
    Math.floor(Math.random() * 250) + 1,
  ].join(".");
}

function getSpoofHeaders() {
  const ip = generateRandomIp();
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin": BASE_URL,
    "Referer": `${BASE_URL}/`,
    "X-Forwarded-For": ip,
    "X-Real-IP": ip,
    "Client-IP": ip,
    "X-Client-IP": ip,
    "CF-Connecting-IP": ip,
    "True-Client-IP": ip,
    "X-Cluster-Client-IP": ip,
  };
}

async function sendMagicLink(email) {
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(
        `${BASE_URL}/api/send`,
        { email: email.trim() },
        { headers: getSpoofHeaders(), timeout: 30000, validateStatus: () => true }
      );

      if (res.data?.status) {
        return { success: true, message: res.data.message, email: res.data.email || email };
      }

      if (res.status === 400 || res.status === 429) {
        return { success: false, error: res.data?.message || `HTTP ${res.status}`, status: res.status };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return { success: false, error: lastError?.message || "Gagal menghubungi service" };
}

export default {
  name: "AlightMotion Send",
  description: "Kirim magic link email verifikasi Alight Motion",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email tujuan untuk magic link verifikasi",
      example: "user@email.com",
    },
  },
  async run(req, res) {
    const { email } = { ...req.query, ...req.body };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'email' wajib diisi dan harus valid",
      });
    }

    try {
      const result = await sendMagicLink(email.trim());
      if (!result.success) {
        return res.status(result.status || 502).json({
          status: false,
          message: result.error || "Gagal mengirim magic link",
        });
      }
      return res.json({
        status: true,
        message: result.message || "Link verifikasi berhasil dikirim",
        result: { email: result.email || email.trim() },
      });
    } catch (err) {
      logger.error(`[AM SEND] Error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
