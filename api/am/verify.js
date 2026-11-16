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

async function verifyMagicLink(email, link) {
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(
        `${BASE_URL}/api/verify`,
        { email: email.trim(), magicLink: link.trim() },
        { headers: getSpoofHeaders(), timeout: 35000, validateStatus: () => true }
      );

      if (res.data?.status) {
        return { success: true, data: res.data };
      }

      if (res.status === 400 || res.data?.status === false) {
        return { success: false, error: res.data?.message || "Magic link tidak valid atau sudah digunakan", status: res.status || 400 };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return { success: false, error: lastError?.message || "Gagal menghubungi service verifikasi" };
}

export default {
  name: "AlightMotion Verify",
  description: "Verifikasi magic link email dan aktivasi Alight Motion Premium VIP",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email", "link"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email yang menerima magic link verifikasi",
      example: "user@email.com",
    },
    link: {
      type: "string",
      required: true,
      description: "Full link magic link yang didapat dari email",
      example: "https://alight-creative.firebaseapp.com/__/auth/links?link=...",
    },
  },
  async run(req, res) {
    const { email, link } = { ...req.query, ...req.body };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ status: false, message: "Parameter 'email' wajib diisi dan harus valid" });
    }

    if (!link || typeof link !== "string" || link.length < 10) {
      return res.status(400).json({ status: false, message: "Parameter 'link' wajib diisi (full magic link verifikasi)" });
    }

    try {
      const result = await verifyMagicLink(email.trim(), link.trim());
      if (!result.success) {
        return res.status(result.status || 400).json({ status: false, message: result.error || "Verifikasi gagal" });
      }

      return res.json({
        status: true,
        message: result.data?.message || "Premium berhasil diaktifkan",
        result: {
          email: result.data?.email || email.trim(),
          uid: result.data?.uid || null,
          orderId: result.data?.orderId || null,
          validUntil: result.data?.validUntil || null,
        },
      });
    } catch (err) {
      logger.error(`[AM VERIFY] Error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message });
    }
  },
};
