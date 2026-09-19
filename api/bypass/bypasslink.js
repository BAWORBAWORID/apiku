/**
 * Bypass Link API
 * 
 * Bypass shortlink services seperti sf.gl, sub2unlock, tinyurl, linkvertise, dll.
 * Menggunakan bypass.tools API
 * 
 * GET  /api/solve/bypass?url=https://linkvertise.com/...
 * POST /api/solve/bypass
 * Body: { "url": "https://linkvertise.com/..." }
 */

import crypto from "crypto";

export default {
  name: "Bypass Link",
  description: "Bypass shortlink services (sf.gl, sub2unlock, tinyurl, linkvertise, dll)",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url", "androidId"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL shortlink yang ingin di-bypass (sf.gl, linkvertise, tinyurl, dll)",
      example: "https://linkvertise.com/546946/mYoUbm5Ro7gU?o=sharing"
    },
    androidId: {
      type: "string",
      required: false,
      description: "Android device ID (opsional, auto-generate random jika tidak diisi)",
      example: "a1b2c3d4e5f6a7b8"
    }
  },

  async run(req, res) {
    const startTime = Date.now();

    try {
      const params = { ...req.query, ...req.body };
      const { url, androidId } = params;

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
          example: {
            get: "/api/solve/bypass?url=https://linkvertise.com/546946/mYoUbm5Ro7gU",
            post: { url: "https://linkvertise.com/546946/mYoUbm5Ro7gU" }
          }
        });
      }

      // Generate device ID dari androidId atau random
      const deviceId = crypto.createHash("sha256")
        .update(`bypasstools:${androidId || crypto.randomBytes(16).toString("hex")}`)
        .digest("hex");

      // Init session dengan bypass.tools
      const initRes = await fetch("https://bypass.tools/api/mobile/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          platform: "android",
          appVersion: "1.0.0"
        })
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(errData.message || `Init failed: ${initRes.status}`);
      }

      const { sessionToken } = await initRes.json();

      if (!sessionToken) {
        throw new Error("Failed to get session token from bypass.tools");
      }

      // Bypass URL
      const bypassRes = await fetch("https://bypass.tools/api/mobile/bypass", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
          "X-Device-ID": deviceId
        },
        body: JSON.stringify({
          url,
          forceRefresh: false
        })
      });

      const bypassData = await bypassRes.json();

      if (!bypassRes.ok) {
        throw new Error(bypassData.message || `Bypass failed: ${bypassRes.status}`);
      }

      if (!bypassData.result) {
        throw new Error("Empty result from bypass.tools");
      }

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return res.json({
        status: true,
        result: {
          originalUrl: url,
          bypassedUrl: bypassData.result,
          deviceId: deviceId,
          responseTime: `${responseTime}ms`
        }
      });

    } catch (err) {
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return res.status(500).json({
        status: false,
        message: err.message || "Failed to bypass URL",
        result: {
          responseTime: `${responseTime}ms`
        }
      });
    }
  }
};
