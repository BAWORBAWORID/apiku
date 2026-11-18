/**
 * AlightMotion Bulk V3 — Auto solve reCAPTCHA v3 + generate 1 akun (amp.dclabs.my.id)
 *
 * GET  /api/am/bulkv3
 * POST /api/am/bulkv3
 */

import axios from "axios";

const SITEKEY = "6LfTASUuAAAAAGskVJXgGZ5OaeObCAMqBg0KFCKC";
const PAGE_URL = "https://amp.dclabs.my.id/";
const ACTION = "generate";
const TARGET_API = "https://amp.dclabs.my.id/api/bulk";

function randomIPv6() {
  return Array.from({ length: 8 }, () => Math.floor(Math.random() * 65536).toString(16)).join(":");
}

const recaptchaClient = axios.create({
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  timeout: 20000,
});

function buildCo(url) {
  const { origin, protocol } = new URL(url);
  const port = protocol === "https:" ? "443" : "80";
  return Buffer.from(`${origin}:${port}`).toString("base64").replace(/=/g, "");
}

async function solveRecaptchaV3({ sitekey, url, action }) {
  const coParam = buildCo(url);
  const paramsString = new URLSearchParams({
    ar: "1",
    k: sitekey,
    co: coParam,
    hl: "en",
    v: "pCoGBhjs9s8EhFOHJFe8cqis",
    size: "invisible",
    cb: Math.random().toString(36).slice(2),
  }).toString();

  const base = "https://www.google.com/recaptcha/api2/";
  const params = Object.fromEntries(new URLSearchParams(paramsString));
  const xff = randomIPv6();

  const anchorRes = await recaptchaClient.get(`${base}anchor?${paramsString}`, {
    headers: { "X-Forwarded-For": xff },
  });
  const tokenMatch = anchorRes.data.match(/"recaptcha-token" value="(.*?)"/);
  if (!tokenMatch) throw new Error("recaptcha-token tidak ditemukan");

  const postData = new URLSearchParams({
    v: params.v,
    reason: "q",
    c: tokenMatch[1],
    k: params.k,
    co: params.co,
    ...(action ? { sa: action } : {}),
  }).toString();

  const reloadRes = await recaptchaClient.post(`${base}reload?k=${params.k}`, postData, {
    headers: { "X-Forwarded-For": xff },
  });
  const answerMatch = reloadRes.data.match(/"rresp","(.*?)"/);
  if (!answerMatch) throw new Error("rresp tidak ditemukan — sitekey/co salah atau di-block");

  return answerMatch[1];
}

async function generateAccount() {
  const token = await solveRecaptchaV3({ sitekey: SITEKEY, url: PAGE_URL, action: ACTION });

  const res = await axios.post(
    TARGET_API,
    { count: 1, captcha: token },
    {
      headers: {
        "Content-Type": "application/json",
        "Origin": PAGE_URL.replace(/\/$/, ""),
        "Referer": PAGE_URL,
        "X-Forwarded-For": randomIPv6(),
      },
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  return { httpStatus: res.status, data: res.data };
}

export default {
  name: "AlightMotion Bulk V3",
  description: "Auto solve reCAPTCHA v3 dan generate 1 akun Alight Motion Premium via amp.dclabs.my.id (tanpa parameter).",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: [],
  paramsSchema: {},

  async run(req, res) {
    const startTime = Date.now();
    try {
      const result = await generateAccount();
      const responseTime = `${Date.now() - startTime}ms`;

      if (result.httpStatus >= 200 && result.httpStatus < 300 && result.data?.success) {
        return res.json({
          status: true,
          result: result.data,
          responseTime,
        });
      }

      return res.status(result.httpStatus >= 400 ? result.httpStatus : 500).json({
        status: false,
        message: result.data?.message || "Gagal generate akun",
        result: result.data,
        responseTime,
      });
    } catch (err) {
      const responseTime = `${Date.now() - startTime}ms`;
      return res.status(500).json({
        status: false,
        message: err?.message || "Failed to generate account",
        responseTime,
      });
    }
  },
};
