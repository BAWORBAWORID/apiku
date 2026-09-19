import puppeteer from "puppeteer";
import logger from "../../src/utils/logger.js";
import amService from "../../src/utils/amService.js";

const DOMAIN = "jagomail.com";

let browserInstance = null;

async function getBrowser() {
  if (browserInstance) return browserInstance;
  browserInstance = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
  return browserInstance;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openInbox(page, email) {
  const [user, dom] = email.split("@");
  const url = `https://generator.email/${dom}/${user}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);
}

async function findVerifyLink(page, email) {
  for (let i = 0; i < 30; i++) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    const link = await page.evaluate(() => {
      const a = document.querySelector("a[href*='alight-creative.firebaseapp.com']");
      if (a) return a.href;
      const a2 = document.querySelector("a[href*='firebaseapp.com']");
      if (a2) return a2.href;
      const a3 = document.querySelector("a[href*='alight']");
      if (a3) return a3.href;
      const allText = document.body.innerText || "";
      const m = allText.match(/https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s]+/);
      if (m) return m[0];
      return null;
    });

    if (link) {
      logger.info(`[AM Bulk] Link found for ${email}`);
      return link;
    }

    logger.info(`[AM Bulk] ${email} waiting (${i + 1}/30)...`);
    await sleep(5000);
  }
  return null;
}

async function processOne(email) {
  const page = await (await getBrowser()).newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  );

  try {
    await openInbox(page, email);
    logger.info(`[AM Bulk] ${email} inbox opened`);

    const sendRes = await amService.sendMagicLink(email);
    if (!sendRes.success) {
      logger.error(`[AM Bulk] ${email} send failed: ${sendRes.error}`);
      return { email, status: "failed", error: `send: ${sendRes.error}` };
    }
    logger.info(`[AM Bulk] ${email} send done`);

    const link = await findVerifyLink(page, email);
    if (!link) {
      logger.error(`[AM Bulk] ${email} no verification link found`);
      return { email, status: "failed", error: "link not found" };
    }

    const verifyRes = await amService.verifyAndFetchProfile(email, link);
    if (!verifyRes.success) {
      logger.error(`[AM Bulk] ${email} verify failed: ${verifyRes.error}`);
      return { email, status: "failed", error: `verify: ${verifyRes.error}` };
    }

    const premiumRes = await amService.applyPremium(verifyRes.idToken);
    logger.info(`[AM Bulk] ${email} premium: ${premiumRes.success ? 'ACTIVE' : 'FAILED'}`);
    return {
      email,
      status: premiumRes.success ? "success" : "failed",
      code_order: premiumRes.success ? premiumRes.codeorder : undefined,
      error: premiumRes.success ? undefined : `premium: ${premiumRes.error}`
    };
  } catch (err) {
    logger.error(`[AM Bulk] ${email} error: ${err.message}`);
    return { email, status: "error", error: err.message };
  } finally {
    await page.close();
  }
}

export default {
  name: "AlightMotion Bulk",
  description:
    "Bulk AlightMotion premium — auto generate email, send AM verification, auto inbox detect + verify",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["count"],
  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah akun yang diproses (maks 100)",
    },
  },

  async run(req, res) {
    try {
      const { count } = { ...req.query, ...req.body };
      const n = Math.min(parseInt(count) || 1, 100);

      const results = [];
      for (let i = 0; i < n; i++) {
        const suffix = Math.random().toString(36).substring(2, 10);
        const email = `am_${suffix}@${DOMAIN}`;
        const inboxUrl = `https://generator.email/${DOMAIN}/am_${suffix}`;

        logger.info(`[AM Bulk] Processing ${i + 1}/${n}: ${email}`);

        const item = await processOne(email);
        results.push({
          email: item.email,
          inboxUrl: `https://generator.email/${DOMAIN}/${item.email.split('@')[0]}`,
          orderId: item.code_order ? `zyvorapi-${item.code_order}` : null
        });

        if (i < n - 1) await sleep(3000);
      }

      return res.json({
        status: true,
        total: n,
        processing: false,
        results
      });

    } catch (err) {
      logger.error(`[AM Bulk] Request error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message || "Bulk request failed" });
    }
  },
};
