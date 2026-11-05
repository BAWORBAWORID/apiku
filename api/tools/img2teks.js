/**
 * IMG TO TEKS (ScanRead.ai OCR) — ported from STARLABS snippet
 * Endpoint: /api/tools/img2teks
 * Extract text from an image (URL or file upload) using ScanRead.ai
 */

import https from "https";
import multer from "multer";
import logger from "../../src/utils/logger.js";

const AKUNLABS_API = "akunlabs.my.id";
const SCANREAD_HOST = "scanread.ai";
const POLL_INTERVAL = 3000;
const MAX_TIMEOUT = 120000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

let akunlabsCookies = "";

function httpReq(host, pathUrl, method = "GET", headers = {}, body = null, useAkunlabsCookies = false) {
  return new Promise((resolve, reject) => {
    const bodyStr = body !== null ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const opts = {
      hostname: host,
      path: pathUrl,
      method: method,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36",
        Accept: "application/json",
        ...headers,
      },
    };
    if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    if (useAkunlabsCookies && akunlabsCookies) opts.headers["Cookie"] = akunlabsCookies;

    const req = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(d);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: d, json });
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Timeout")));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function uploadToPresignedUrl(uploadUrl, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": buffer.length,
          "User-Agent": "Mozilla/5.0",
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, status: res.statusCode });
          else reject(new Error(`Upload gagal: ${res.statusCode} ${d.slice(0, 200)}`));
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(60000, () => req.destroy(new Error("Upload timeout")));
    req.write(buffer);
    req.end();
  });
}

async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error("Download gagal: " + res.statusCode));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "image/jpeg",
        });
      });
    }).on("error", reject);
  });
}

async function fetchResultText(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    https
      .get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,text/plain,*/*;q=0.8",
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return fetchResultText(res.headers.location).then(resolve);
          }
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(d));
        }
      )
      .on("error", () => resolve(""));
  });
}

function isCfChallenge(text) {
  return text.includes("Just a moment") || text.includes("_cf_chl_opt");
}

async function ocrFromBuffer(fileBuffer, fileName, contentType) {
  const auth = await httpReq(AKUNLABS_API, "/api/scanread", "GET", { Accept: "application/json" });
  if (!auth.json?.tokens?.access_token) {
    throw new Error(
      `Gagal ambil token ScanRead. Status: ${auth.status}. Response: ${auth.body.slice(0, 300)}`
    );
  }
  const accessToken = auth.json.tokens.access_token;
  if (auth.json.cookies && typeof auth.json.cookies === "object") {
    akunlabsCookies = Object.entries(auth.json.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  const presign = await httpReq(
    SCANREAD_HOST,
    "/api/scan/presign",
    "POST",
    { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    { fileName, fileSize: fileBuffer.length, contentType },
    true
  );
  if (!presign.json?.uploadUrl || !presign.json?.fileUrl) {
    throw new Error("Gagal dapet presigned URL: " + presign.body.slice(0, 300));
  }

  await uploadToPresignedUrl(presign.json.uploadUrl, fileBuffer, contentType);

  const scan = await httpReq(
    SCANREAD_HOST,
    "/api/scan",
    "POST",
    { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    {
      fileUrl: presign.json.fileUrl,
      fileName,
      fileType: contentType,
      pageCount: 1,
      targetLanguage: "auto",
      outputFormat: "markdown",
    },
    true
  );
  if (!scan.json?.taskId) throw new Error("Gagal trigger scan: " + scan.body.slice(0, 300));
  const taskId = scan.json.taskId;

  const start = Date.now();
  let result = null;
  while (Date.now() - start < MAX_TIMEOUT) {
    const status = await httpReq(
      SCANREAD_HOST,
      `/api/scan/${taskId}`,
      "GET",
      { Accept: "application/json", Authorization: "Bearer " + accessToken },
      null,
      true
    );
    if (status.json?.status === "done" && status.json?.fileResult) {
      result = status.json;
      break;
    } else if (status.json?.status === "failed" || status.json?.errorMessage) {
      throw new Error("OCR gagal: " + (status.json.errorMessage || "Unknown error"));
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  if (!result) throw new Error("Timeout: OCR gak selesai.");

  let text = await fetchResultText(result.fileResult);
  if (isCfChallenge(text)) {
    // file result di-protect Cloudflare dari IP server — coba retry
    for (let i = 0; i < 3 && isCfChallenge(text); i++) {
      await new Promise((r) => setTimeout(r, 5000));
      text = await fetchResultText(result.fileResult);
    }
  }
  return {
    task_id: taskId,
    file_url: result.fileUrl || presign.json.fileUrl,
    result_url: result.fileResult,
    text: isCfChallenge(text) ? null : text,
    text_blocked_by_cloudflare: isCfChallenge(text),
    created_at: new Date().toISOString(),
  };
}

export default {
  name: "IMG To Teks (ScanRead OCR)",
  description: "Extract teks dari gambar (URL atau upload file) menggunakan ScanRead.ai OCR",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["url", "file"],
  paramsSchema: {
    url: {
      type: "string",
      required: false,
      description: "URL gambar untuk di-OCR (pakai ini ATAU upload file)",
      example: "https://example.com/image.jpg",
    },
    file: {
      type: "file",
      required: false,
      description: "Upload gambar langsung (field name: file, max 15MB)",
    },
  },

  async run(req, res) {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ status: false, message: "File too large (max 15MB)" });
        }
        return res.status(400).json({ status: false, message: err.message || "Upload error" });
      }

      const { url } = { ...req.query, ...req.body };
      try {
        let fileBuffer, fileName, contentType;
        if (req.file) {
          fileBuffer = req.file.buffer;
          fileName = req.file.originalname || "image.jpg";
          contentType = req.file.mimetype || "image/jpeg";
        } else if (url && /^https?:\/\//i.test(url)) {
          const img = await downloadImage(url);
          fileBuffer = img.buffer;
          contentType = img.contentType;
          fileName = decodeURIComponent(new URL(url).pathname.split("/").pop()) || "image.jpg";
        } else {
          return res.status(400).json({
            status: false,
            message: "Parameter wajib: url (URL gambar) ATAU upload file (field: file)",
          });
        }

        const result = await ocrFromBuffer(fileBuffer, fileName, contentType);
        return res.json({
          status: true,
          credit: "STARLABS",
          result,
        });
      } catch (e) {
        logger.error(`[IMG2TEKS] ${e.message}`);
        return res.status(500).json({ status: false, error: e.message });
      }
    });
  },
};
