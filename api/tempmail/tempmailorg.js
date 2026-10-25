/**
 * TempMailOrg API - Using temp-mail.org mobile API (mob2.temp-mail.org)
 * GET /api/tempmail/tempmailorg?action=create
 * GET /api/tempmail/tempmailorg?action=inbox&token=<jwt>
 * POST support: semua action lewat query/body (body menang)
 */

import https from "node:https";

const TM_CONFIG = {
  BASE_URL: "https://mob2.temp-mail.org",
  USER_AGENT: "okhttp/4.12.0",
  TIMEOUT: 20000,
};

function tmRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = {
      "User-Agent": TM_CONFIG.USER_AGENT,
      "Accept": "application/json",
      ...options.headers
    };

    let bodyData = null;
    if (options.body) {
      if (typeof options.body === "object" && !Buffer.isBuffer(options.body)) {
        bodyData = JSON.stringify(options.body);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      } else {
        bodyData = options.body;
      }
      headers["Content-Length"] = Buffer.byteLength(bodyData);
    } else if (options.method === "POST") {
      headers["Content-Length"] = 0;
    }

    const req = https.request(parsedUrl, {
      method: options.method || "GET",
      headers,
      timeout: TM_CONFIG.TIMEOUT
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers["content-type"] || "";
        if (contentType.includes("application/octet-stream") || options.raw) {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(buffer);
        }
        const text = buffer.toString("utf8");
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const err = new Error(
            typeof parsed === "object" && (parsed.error || parsed.errorMessage)
              ? (parsed.error || parsed.errorMessage)
              : `HTTP ${res.statusCode}: ${text}`
          );
          err.status = res.statusCode;
          reject(err);
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("Request timeout")); });
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function createMailbox() {
  return tmRequest(`${TM_CONFIG.BASE_URL}/mailbox`, { method: "POST" });
}

async function getMessages(token, after = null) {
  let url = `${TM_CONFIG.BASE_URL}/messages`;
  if (after) url += `?after=${encodeURIComponent(after)}`;
  return tmRequest(url, { headers: { Authorization: `Bearer ${token}` } });
}

export default {
  name: "TempMail - TempMailOrg (temp-mail.org)",
  category: "TempMail",
  description: "Temporary email via API resmi temp-mail.org (mobile endpoint). action=create untuk buat email baru, action=inbox + token untuk cek pesan masuk.",
  methods: ["GET", "POST"],
  params: ["action", "token"],
  paramsSchema: {
    action: { type: "string", required: true, description: "create | inbox", example: "create" },
    token: { type: "string", required: false, description: "JWT token dari action=create (wajib untuk action=inbox)" }
  },
  async run(req, res) {
    const { action = "create", token } = { ...req.query, ...req.body };

    try {
      if (action === "create") {
        const mb = await createMailbox();
        return res.json({
          status: true,
          mailbox: mb.mailbox || mb.address,
          token: mb.token,
          hint: "gunakan token untuk action=inbox",
          statusCode: 200,
          timestamp: new Date().toISOString(),
          attribution: "@zyvorapi"
        });
      }

      if (action === "inbox") {
        if (!token) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'token' is required",
            statusCode: 400,
            timestamp: new Date().toISOString(),
            attribution: "@zyvorapi"
          });
        }
        const msgs = await getMessages(token);
        return res.json({
          status: true,
          mailbox: msgs.mailbox,
          messages: msgs.messages || [],
          total: (msgs.messages || []).length,
          statusCode: 200,
          timestamp: new Date().toISOString(),
          attribution: "@zyvorapi"
        });
      }

      return res.status(400).json({
        status: false,
        message: `Unknown action '${action}'. Available: create, inbox`,
        statusCode: 400,
        timestamp: new Date().toISOString(),
        attribution: "@zyvorapi"
      });

    } catch (e) {
      return res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 500).json({
        status: false,
        message: e.message || "Internal error",
        statusCode: e.status || 500,
        timestamp: new Date().toISOString(),
        attribution: "@zyvorapi"
      });
    }
  }
};
