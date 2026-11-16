
import fs from "fs";
import path from "path";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "../../src/utils/logger.js";

const API_KEY = "AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0";

const BASE_URL =
  "https://www.googleapis.com/identitytoolkit/v3/relyingparty";

const FIREBASE_ORIGIN = "https://alight-creative.firebaseapp.com";

const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Referer": `${FIREBASE_ORIGIN}/`,
  "Origin": FIREBASE_ORIGIN,
  "X-Android-Package": "com.alightcreative.motion",
  "X-Android-Cert": "ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8",
  "User-Agent":
    "Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)",
};

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.loadProxies();
  }

  detectProtocol(url) {
    const lower = url.toLowerCase();

    if (lower.startsWith("socks5://")) return "socks5";
    if (lower.startsWith("socks4://")) return "socks4";
    if (lower.startsWith("https://")) return "https";

    return "http";
  }

  loadProxies() {
    const list = [];
    const proxyDir = path.join(process.cwd(), "proxy");
    const proxyFile = path.join(process.cwd(), "proxy.txt");

    if (fs.existsSync(proxyDir)) {
      try {
        const files = fs.readdirSync(proxyDir)
          .filter((f) => f.endsWith(".txt"));

        for (const file of files) {
          const content = fs.readFileSync(
            path.join(proxyDir, file),
            "utf8"
          );

          const lines = content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));

          for (const line of lines) {
            const name = file.toLowerCase();

            const protocol = name.includes("sock5")
              ? "socks5"
              : name.includes("sock4")
                ? "socks4"
                : "http";

            const url = /^(socks[45]|https?):\/\//i.test(line)
              ? line
              : `${protocol}://${line}`;

            list.push({ url });
          }
        }
      } catch (error) {
        logger.error(`[AM SEND] Proxy directory: ${error.message}`);
      }
    }

    if (fs.existsSync(proxyFile)) {
      try {
        const content = fs.readFileSync(proxyFile, "utf8");

        content.split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
          .forEach((line) => {
            const url = /^(socks[45]|https?):\/\//i.test(line)
              ? line
              : `http://${line}`;

            list.push({ url });
          });
      } catch (error) {
        logger.error(`[AM SEND] Proxy file: ${error.message}`);
      }
    }

    this.proxies = list;
  }

  getRotatedProxy() {
    if (!this.proxies.length) return null;

    const proxy = this.proxies[
      this.currentIndex % this.proxies.length
    ];

    this.currentIndex++;
    return proxy;
  }

  createAgent(proxyUrl) {
    if (!proxyUrl) return null;

    try {
      const protocol = this.detectProtocol(proxyUrl);

      if (protocol.startsWith("socks")) {
        return new SocksProxyAgent(proxyUrl);
      }

      return new HttpsProxyAgent(proxyUrl);
    } catch {
      return null;
    }
  }
}

const proxyManager = new ProxyManager();

function createRequestConfig() {
  const proxy = proxyManager.getRotatedProxy();

  const config = {
    headers: HEADERS,
    timeout: 30000,
    validateStatus: () => true,
  };

  if (proxy) {
    const agent = proxyManager.createAgent(proxy.url);

    if (!agent) {
      throw new Error("Gagal membuat proxy agent");
    }

    config.httpAgent = agent;
    config.httpsAgent = agent;
    config.proxy = false;
  }

  return config;
}

async function firebaseRequest(endpoint, payload) {
  if (!API_KEY) {
    throw new Error("FIREBASE_API_KEY belum dikonfigurasi");
  }

  const url = `${BASE_URL}/${endpoint}?key=${API_KEY}`;

  const response = await axios.post(
    url,
    payload,
    createRequestConfig()
  );

  if (response.status < 200 || response.status >= 300) {
    const message =
      response.data?.error?.message ||
      `Firebase HTTP ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return response.data;
}

async function sendMagicLink(email) {
  try {
    // Stage 1: Create Auth URI
    await firebaseRequest("createAuthUri", {
      identifier: email,
      continueUri: "http://localhost",
    });

    // Stage 2: Send email verification link
    const result = await firebaseRequest(
      "getOobConfirmationCode",
      {
        requestType: 6,
        email,
        androidInstallApp: true,
        canHandleCodeInApp: true,
        continueUrl:
          "https://alightcreative.com?ui_sid=0366624874&ui_sd=0",
        iosBundleId: "com.alightcreative.motion",
        androidPackageName: "com.alightcreative.motion",
        androidMinimumVersion: "585",
        clientType: "CLIENT_TYPE_ANDROID",
      }
    );

    return {
      success: true,
      message: "Link berhasil dikirim.",
      email,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      status: error.status,
    };
  }
}

export default {
  name: "AlightMotion Send",
  description: "Kirim magic link",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email"],

  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email tujuan magic link",
      example: "user@email.com",
    },
  },

  async run(req, res) {
    const { email } = {
      ...req.query,
      ...req.body,
    };

    if (
      !email ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return res.status(400).json({
        status: false,
        message: "Parameter email wajib diisi dan harus valid",
      });
    }

    try {
      const result = await sendMagicLink(email.trim());

      if (!result.success) {
        logger.error(`[AM SEND] ${result.error}`);

        return res.status(result.status || 502).json({
          status: false,
          message: result.error,
        });
      }

      return res.json({
        status: true,
        message: result.message,
        result: {
          email: result.email,
        },
      });
    } catch (error) {
      logger.error(`[AM SEND] ${error.message}`);

      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },
};
