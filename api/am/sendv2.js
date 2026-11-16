
import axios from "axios";
import logger from "../../src/utils/logger.js";

const BASE_URL =
  "https://satriam.satriadeveloperz.workers.dev/api/satriam";

const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent": "Zyvor/1.0"
};

async function sendMagicLink(email) {
  try {
    const response = await axios.post(
      `${BASE_URL}/send-link`,
      {
        email: email.trim()
      },
      {
        headers: HEADERS,
        timeout: 30000,
        validateStatus: () => true
      }
    );

    const data = response.data;

    if (response.status >= 200 && response.status < 300) {
      return {
        success: data?.success ?? data?.status ?? true,
        message: data?.message || "Link berhasil dikirim.",
        email: data?.email || email.trim(),
        data
      };
    }

    return {
      success: false,
      error: data?.message || `HTTP ${response.status}`,
      status: response.status
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      status: error.response?.status
    };
  }
}

export default {
  name: "AlightMotion Send v2",
  description: "Kirim magic link email verifikasi Alight Motion",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email"],

  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email tujuan untuk magic link verifikasi",
      example: "user@email.com"
    }
  },

  async run(req, res) {
    const { email } = {
      ...req.query,
      ...req.body
    };

    if (
      !email ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'email' wajib diisi dan harus valid"
      });
    }

    try {
      const result = await sendMagicLink(email);

      if (!result.success) {
        logger.error(`[AM SEND] ${result.error}`);

        return res.status(result.status || 502).json({
          status: false,
          message: result.error || "Gagal mengirim magic link"
        });
      }

      return res.json({
        status: true,
        message: result.message,
        result: {
          email: result.email
        }
      });

    } catch (err) {
      logger.error(`[AM SEND] Error: ${err.message}`);

      return res.status(500).json({
        status: false,
        message: err.message
      });
    }
  }
};
