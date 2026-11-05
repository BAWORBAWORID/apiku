import fs from "fs";
import path from "path";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import logger from "../../src/utils/logger.js";

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.loadProxies();
  }

  detectProtocol(urlStr) {
    const lower = urlStr.toLowerCase();
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
        const files = fs.readdirSync(proxyDir).filter((f) => f.endsWith(".txt"));
        for (const f of files) {
          const content = fs.readFileSync(path.join(proxyDir, f), "utf8");
          const lines = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
          lines.forEach((line) => {
            const proto = f.toLowerCase().includes("sock5") ? "socks5" : f.toLowerCase().includes("sock4") ? "socks4" : "http";
            const fullUrl = /^(socks[45]|https?):\/\//i.test(line) ? line : `${proto}://${line}`;
            list.push({ url: fullUrl, protocol: this.detectProtocol(fullUrl) });
          });
        }
      } catch (_) {}
    }

    if (fs.existsSync(proxyFile)) {
      try {
        const content = fs.readFileSync(proxyFile, "utf8");
        const lines = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
        lines.forEach((line) => {
          const fullUrl = /^(socks[45]|https?):\/\//i.test(line) ? line : `http://${line}`;
          list.push({ url: fullUrl, protocol: this.detectProtocol(fullUrl) });
        });
      } catch (_) {}
    }

    this.proxies = list;
  }

  getRotatedProxy() {
    if (!this.proxies.length) return null;
    const proxy = this.proxies[this.currentIndex % this.proxies.length];
    this.currentIndex++;
    return proxy;
  }

  createAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
      const proto = this.detectProtocol(proxyUrl);
      if (proto.startsWith("socks")) {
        return new SocksProxyAgent(proxyUrl);
      }
      return new HttpsProxyAgent(proxyUrl);
    } catch (_) {
      return null;
    }
  }
}

const proxyManager = new ProxyManager();

function generateRandomIp() {
  return [
    Math.floor(Math.random() * 200) + 20,
    Math.floor(Math.random() * 250) + 1,
    Math.floor(Math.random() * 250) + 1,
    Math.floor(Math.random() * 250) + 1,
  ].join(".");
}

function getRotatedHeaders(customIp) {
  const ip = customIp || generateRandomIp();
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Origin": "https://am-premiumms.ai.studio",
    "Referer": "https://am-premiumms.ai.studio/",
    "X-Forwarded-For": ip,
    "X-Real-IP": ip,
    "Client-IP": ip,
    "X-Client-IP": ip,
    "CF-Connecting-IP": ip,
    "True-Client-IP": ip,
    "X-Cluster-Client-IP": ip,
  };
}

const BASE_URL = "https://am-premiumms.ai.studio";

async function verifyMagicLink(email, link) {
  const maxRetries = Math.max(3, proxyManager.proxies.length || 3);
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const spoofIp = generateRandomIp();
    const proxyItem = proxyManager.getRotatedProxy();
    const agent = proxyItem ? proxyManager.createAgent(proxyItem.url) : null;

    const config = {
      headers: getRotatedHeaders(spoofIp),
      timeout: 35000,
      validateStatus: () => true,
    };

    if (agent) {
      config.httpAgent = agent;
      config.httpsAgent = agent;
    }

    try {
      const res = await axios.post(
        `${BASE_URL}/api/verify-link`,
        {
          email: email.trim(),
          magicLink: link.trim(),
        },
        config
      );

      if (res.data?.success || res.data?.status) {
        return {
          success: true,
          message: res.data.message || "Premium berhasil diaktifkan!",
          data: res.data,
          ip: spoofIp,
        };
      }

      // If backend returns business error (e.g. invalid code / expired)
      if (res.status === 400 || res.data?.status === false) {
        return {
          success: false,
          error: res.data?.message || "Kode magic link tidak valid atau sudah digunakan.",
          status: res.status || 400,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    success: false,
    error: lastError?.message || "Gagal menghubungi service verifikasi",
  };
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
      return res.status(400).json({
        status: false,
        message: "Parameter 'email' wajib diisi dan harus valid",
      });
    }

    if (!link || typeof link !== "string" || link.length < 10) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'link' wajib diisi (full magic link verifikasi)",
      });
    }

    try {
      const result = await verifyMagicLink(email.trim(), link.trim());
      if (!result.success) {
        const httpStatus = result.status || 400;
        return res.status(httpStatus).json({
          status: false,
          message: result.error || "Verifikasi gagal",
        });
      }

      return res.json({
        status: true,
        message: result.message || "Premium berhasil diaktifkan",
        result: {
          email: result.data?.data?.email || result.data?.email || email.trim(),
          uid: result.data?.data?.uid || result.data?.uid || null,
          validUntil: result.data?.data?.validUntil || result.data?.validUntil || null,
        },
      });
    } catch (err) {
      logger.error(`[AM VERIFY] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message,
      });
    }
  },
};
