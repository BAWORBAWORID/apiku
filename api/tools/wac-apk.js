/**
 * WebView APK Builder (webappcreator.amethystlab.org) — ported from Zane's wac.js
 * Endpoint: /api/tools/wac-apk
 * Convert a website into an Android APK. Status queue + build (build can take 1-15 min).
 */

import { setTimeout as sleep } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rm } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import logger from "../../src/utils/logger.js";

const execFileAsync = promisify(execFile);

const BASE_URL = "https://webappcreator.amethystlab.org";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
const integer = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

class WacError extends Error {
  constructor(message, { code = "WAC_ERROR", status } = {}) {
    super(message);
    this.name = "WacError";
    this.code = code;
    this.status = status;
  }
}

async function curlRequest(url, { method = "GET", formFile, fields, timeoutMs = 60000 } = {}) {
  const args = ["-sS", "-w", "\n%{http_code}", "-X", method, "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "-H", `User-Agent: ${UA}`,
    "-H", `Origin: ${BASE_URL}`,
    "-H", `Referer: ${BASE_URL}/`,
    "-H", "Accept: application/json, text/plain, */*",
  ];
  if (formFile) {
    for (const [k, v] of Object.entries(fields || {})) args.push("-F", `${k}=${v}`);
    args.push("-F", `icon=@${formFile};filename=icon.png;type=image/png`);
  } else if (fields && method === "POST") {
    args.push("-H", "Content-Type: application/json", "--data-binary", JSON.stringify(fields));
  }
  args.push("--url", url);
  try {
    const { stdout } = await execFileAsync("curl", args, { timeout: timeoutMs + 10000, maxBuffer: 32 * 1024 * 1024 });
    const nl = stdout.lastIndexOf("\n");
    const status = parseInt(stdout.slice(nl + 1).trim(), 10) || 0;
    const body = stdout.slice(0, nl);
    let data = null;
    try {
      data = JSON.parse(body);
    } catch {}
    return { status, body, data };
  } catch (err) {
    if (err.killed) throw new WacError("curl timeout", { code: "TIMEOUT" });
    throw new WacError(err.message?.split("\n")[0] || "curl gagal", { code: "CURL_ERROR" });
  }
}

export async function queueStatus() {
  const res = await curlRequest(`${BASE_URL}/api/queue-status`, { timeoutMs: 20000 });
  if (!res.data) throw new WacError(`queue-status HTTP ${res.status}`, { code: "QUEUE_HTTP_" + res.status, status: res.status });
  return {
    status: true,
    credit: "Zane",
    max_concurrent: integer(res.data.maxConcurrent, 0, 0, 99),
    current_builds: integer(res.data.currentBuilds, 0, 0, 99),
    queue_length: integer(res.data.queueLength, 0, 0, 99),
    active_ids: Array.isArray(res.data.currentBuildIds) ? res.data.currentBuildIds : [],
    queued_ids: Array.isArray(res.data.queuedBuildIds) ? res.data.queuedBuildIds : [],
    timestamp: text(res.data.timestamp),
  };
}

function slugPackage(name) {
  const base = text(name).toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^[0-9]+/, "") || "app";
  const h = createHash("sha256").update(String(name)).digest("hex").slice(0, 6);
  return `com.webapp.${base}${h}`;
}

// Minimal valid PNG (solid color) generated in-memory
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([len, body, crcBuf]);
}

function generatePng(size = 192, rgb = [59, 130, 246]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3)]);
  for (let x = 0; x < size * 3; x += 3) {
    row[1 + x] = rgb[0];
    row[2 + x] = rgb[1];
    row[3 + x] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function buildApk(input, {
  name,
  packageName,
  versionName = "1.0.0",
  versionCode = 1,
  timeoutSec = 600,
} = {}) {
  let target = text(input);
  if (!target) throw new WacError("URL kosong", { code: "EMPTY_URL" });
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  try {
    const u = new URL(target);
    if (!u.hostname.includes(".")) throw new Error("bad host");
  } catch {
    throw new WacError(`URL tidak valid: ${target}`, { code: "BAD_URL" });
  }

  const appName = text(name) || (() => {
    try {
      return new URL(target).hostname.replace(/^www\./, "").split(".")[0];
    } catch { return "MyApp" }
  })();
  const pkg = text(packageName) || slugPackage(appName);
  const verName = text(versionName) || "1.0.0";
  if (!/^\d+\.\d+\.\d+$/.test(verName)) throw new WacError("versionName harus format x.y.z", { code: "BAD_VERSION" });
  const verCode = integer(versionCode, 1, 1, 2147483647);

  const fields = {
    websiteUrl: target,
    appName,
    packageName: pkg,
    versionName: verName,
    versionCode: String(verCode),
  };

  const tmpIcon = `/tmp/wac-icon-${process.pid}-${Date.now()}.png`;
  await writeFile(tmpIcon, generatePng(192, [59, 130, 246]));

  try {
    let res;
    try {
      res = await curlRequest(`${BASE_URL}/api/build-apk`, {
        method: "POST",
        formFile: tmpIcon,
        fields,
        timeoutMs: 120000,
      });
    } catch (e) {
      if (e.code === "TIMEOUT") throw new WacError("Submit build timeout", { code: "SUBMIT_TIMEOUT" });
      throw e;
    }
    if (res.status === 429) throw new WacError("Rate limit: max 10 build per 5 menit", { code: "RATE_LIMITED", status: 429 });
    if (!res.data || (!res.data.projectId && !res.data.project_id && !res.data.downloadUrl && !res.data.download_url)) {
      throw new WacError(`build-apk HTTP ${res.status}: ${res.body.slice(0, 300)}`, { code: "BUILD_SUBMIT_FAILED", status: res.status });
    }
    // Upstream bisa langsung selesai (downloadUrl) atau queued (projectId untuk polling)
    if (res.data.downloadUrl || res.data.download_url) {
      const dl = res.data.downloadUrl || res.data.download_url;
      return {
        status: true,
        credit: "Zane",
        website_url: target,
        app_name: appName,
        package_name: pkg,
        version_name: verName,
        version_code: verCode,
        mode: res.data.queued ? "queued" : "immediate",
        download_url: dl.startsWith("http") ? dl : BASE_URL + dl,
        build_time_ms: integer(res.data.buildTime, 0, 0, 3600000),
        message: text(res.data.message),
      };
    }
    const projectId = res.data.projectId || res.data.project_id;
    const queued = res.data.queued === true;

    // Poll status
    const deadline = Date.now() + Math.min(integer(timeoutSec, 600, 30, 1800), 1800) * 1000;
    let statusRes = null;
    while (Date.now() < deadline) {
      await sleep(5000);
      try {
        statusRes = await curlRequest(`${BASE_URL}/api/build-status/${projectId}`, { timeoutMs: 20000 });
      } catch { continue }
      const d = statusRes.data;
      if (!d) continue;
      const st = (d.status || d.state || "").toLowerCase();
      if (st === "completed" || st === "success" || st === "done" || d.downloadUrl || d.download_url) {
        const dl = d.downloadUrl || d.download_url || `/download/${projectId}.apk`;
        return {
          status: true,
          credit: "Zane",
          website_url: target,
          app_name: appName,
          package_name: pkg,
          version_name: verName,
          version_code: verCode,
          mode: queued ? "queued" : "immediate",
          download_url: dl.startsWith("http") ? dl : BASE_URL + dl,
          project_id: projectId,
          build_time_ms: Date.now() - (deadline - integer(timeoutSec, 600, 30, 1800) * 1000),
        };
      }
      if (st === "failed" || st === "error" || d.errorMessage || d.error) {
        throw new WacError("Build gagal: " + (d.errorMessage || d.error || st), { code: "BUILD_FAILED" });
      }
    }
    throw new WacError(`Timeout menunggu build (${projectId}). Poll ulang nanti via endpoint ini dengan project_id.`, { code: "BUILD_TIMEOUT" });
  } finally {
    await rm(tmpIcon, { force: true }).catch(() => {});
  }
}

export default {
  name: "WAC APK Builder",
  description: "Convert website jadi APK Android via webappcreator.amethystlab.org (by Zane). Support status queue & build.",
  category: "Tools",
  methods: ["GET", "POST"],
  params: ["action", "url", "name", "package", "versionName", "versionCode", "timeout"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      enum: ["status", "build"],
      default: "status",
      description: "status = cek antrian build, build = konversi website ke APK (bisa 1-15 menit)",
      example: "build",
    },
    url: {
      type: "string",
      required: false,
      description: "URL website yang mau dijadikan APK (wajib untuk action=build)",
      example: "https://example.com",
    },
    name: {
      type: "string",
      required: false,
      description: "Nama aplikasi (default: dari hostname)",
      example: "MyApp",
    },
    package: {
      type: "string",
      required: false,
      description: "Package ID aplikasi (default: auto)",
      example: "com.example.app",
    },
    versionName: {
      type: "string",
      required: false,
      default: "1.0.0",
      description: "Versi aplikasi",
      example: "1.0.0",
    },
    versionCode: {
      type: "number",
      required: false,
      default: 1,
      description: "Version code",
      example: 1,
    },
    timeout: {
      type: "number",
      required: false,
      default: 600,
      description: "Maksimal menunggu build (detik, max 1800)",
      example: 600,
    },
  },

  async run(req, res) {
    const { action, url, name, package: packageName, versionName, versionCode, timeout } = {
      ...req.query,
      ...req.body,
    };

    try {
      if (!action || action === "status") {
        return res.json(await queueStatus());
      }
      if (action === "build") {
        if (!url) return res.status(400).json({ status: false, message: "Parameter wajib: url (untuk action=build)" });
        const result = await buildApk(url, {
          name,
          packageName,
          versionName,
          versionCode,
          timeoutSec: integer(timeout, 600, 30, 1800),
        });
        return res.json(result);
      }
      return res.status(400).json({ status: false, message: "action harus 'status' atau 'build'" });
    } catch (e) {
      logger.error(`[WAC-APK] ${e.code || "ERROR"}: ${e.message}`);
      return res.status(e.status || 500).json({
        status: false,
        credit: "Zane",
        error: e.code || "ERROR",
        message: e.message,
      });
    }
  },
};
