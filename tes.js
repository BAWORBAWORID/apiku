/**
 * @file tes.js
 * @description ESM CLI client for CapCut Pro action from https://flox-spamotp.vercel.app/
 * Usage: node tes.js [action] <email/param>
 */

const actionParam = process.argv[2] || "capcut";
const emailParam = process.argv[3] || "";

async function main() {
  const apiUrl = "https://flox-spamotp.vercel.app/api";

  const payload = {
    action: actionParam,
    email: emailParam
  };

  console.error("[*] Mengirim action:", actionParam, "dengan email:", emailParam || "(none)");

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Paradox-Token": "PARADOX_SUPER_SECRET_998877",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "Referer": "https://flox-spamotp.vercel.app/",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
      if (json && typeof json === 'object') {
        delete json.creator;
      }
    } catch {
      json = { rawText: text };
    }

    console.log(JSON.stringify({ status: res.ok, statusCode: res.status, data: json }, null, 2));
  } catch (e) {
    console.error("[!] Error:", e.message);
    process.exit(1);
  }
}

main();
