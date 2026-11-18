#!/usr/bin/env node

import axios from "axios";

const SITEKEY = "6LfTASUuAAAAAGskVJXgGZ5OaeObCAMqBg0KFCKC";
const PAGE_URL = "https://amp.dclabs.my.id/";
const ACTION = "generate";

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

  const anchorRes = await recaptchaClient.get(`${base}anchor?${paramsString}`);
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

  const reloadRes = await recaptchaClient.post(`${base}reload?k=${params.k}`, postData);
  const answerMatch = reloadRes.data.match(/"rresp","(.*?)"/);
  if (!answerMatch) throw new Error("rresp tidak ditemukan — sitekey/co salah atau di-block");

  return answerMatch[1];
}

async function main() {
  console.error("[*] Solving reCAPTCHA v3...");
  const token = await solveRecaptchaV3({ sitekey: SITEKEY, url: PAGE_URL, action: ACTION });
  console.error("[*] Token diperoleh, generate akun...");

  const res = await fetch("https://amp.dclabs.my.id/api/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://amp.dclabs.my.id",
      "Referer": "https://amp.dclabs.my.id/",
    },
    body: JSON.stringify({ count: 1, captcha: token }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
    console.log(JSON.stringify(data, null, 2));
  } catch {
    console.log(text);
  }

  if (!res.ok || (data && data.success === false)) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Error:", err?.message || err);
  process.exit(1);
});
