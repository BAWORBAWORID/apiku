import puppeteer from "puppeteer";
import logger from "../../src/utils/logger.js";
import amService from "../../src/utils/amService.js";

const CLEANTEMPMAIL_API = "https://cleantempmail.com/api";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Referer": "https://cleantempmail.com/",
};

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

async function fetchCleanTempMail(endpoint, options = {}) {
  try {
    const res = await fetch(`${CLEANTEMPMAIL_API}${endpoint}`, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Unknown API error");
    return json.data;
  } catch (err) {
    logger.error(`[AM BulkV2] CleanTempMail API error: ${err.message}`);
    throw err;
  }
}

async function generateRandomEmail() {
  const data = await fetchCleanTempMail("/generate-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return data.email;
}

async function getRandomDomain() {
  const data = await fetchCleanTempMail("/domains");
  const domains = data.domains || [];
  return domains[Math.floor(Math.random() * domains.length)];
}

async function generateEmailWithDomain(domain) {
  const data = await fetchCleanTempMail("/generate-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
  return data.email;
}

async function checkInbox(email) {
  const data = await fetchCleanTempMail(`/emails?email=${encodeURIComponent(email)}`);
  return data.emails || [];
}

async function getEmailContent(emailId) {
  const data = await fetchCleanTempMail(`/email/${emailId}`);
  return data;
}

async function findVerifyLinkFromEmails(emails) {
  for (const msg of emails) {
    try {
      const fullMsg = await getEmailContent(msg.id);
      const html = fullMsg.html_content || fullMsg.content || "";
      const text = fullMsg.content || "";
      
      const patterns = [
        /https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/g,
        /https:\/\/[^"'\s]*alight[^"'\s]*firebaseapp[^"'\s]*/g,
        /https:\/\/[^"'\s]*firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/g,
      ];
      
      for (const pattern of patterns) {
        const matches = [...html.matchAll(pattern)];
        if (matches.length > 0) {
          return matches[0][0];
        }
      }
      
      const allText = html + " " + text;
      const linkMatch = allText.match(/https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>]+/);
      if (linkMatch) return linkMatch[0];
    } catch (e) {
      logger.warn(`[AM BulkV2] Failed to parse email ${msg.id}: ${e.message}`);
    }
  }
  return null;
}

async function waitForVerifyLink(email, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const emails = await checkInbox(email);
    if (emails.length > 0) {
      const link = await findVerifyLinkFromEmails(emails);
      if (link) {
        logger.info(`[AM BulkV2] Verification link found for ${email}`);
        return link;
      }
    }
    logger.info(`[AM BulkV2] ${email} waiting for verification email (${i + 1}/${maxAttempts})...`);
    await sleep(5000);
  }
  return null;
}

async function processVerificationBackground(email) {
  try {
    logger.info(`[AM BulkV2 BG] ${email} starting background verification`);

    const sendRes = await amService.sendMagicLink(email);
    if (!sendRes.success) {
      logger.error(`[AM BulkV2 BG] ${email} send failed: ${sendRes.error}`);
      return;
    }
    logger.info(`[AM BulkV2 BG] ${email} magic link sent`);

    const link = await waitForVerifyLink(email);
    if (!link) {
      logger.error(`[AM BulkV2 BG] ${email} no verification link found`);
      return;
    }

    const verifyRes = await amService.verifyAndFetchProfile(email, link);
    if (!verifyRes.success) {
      logger.error(`[AM BulkV2 BG] ${email} verify failed: ${verifyRes.error}`);
      return;
    }

    const premiumRes = await amService.applyPremium(verifyRes.idToken);
    logger.info(`[AM BulkV2 BG] ${email} premium: ${premiumRes.success ? "ACTIVE" : "FAILED"}`);
    if (premiumRes.success) {
      logger.info(`[AM BulkV2 BG] ${email} order: ${premiumRes.codeorder}`);
    }
  } catch (err) {
    logger.error(`[AM BulkV2 BG] ${email} error: ${err.message}`);
  }
}

export default {
  name: "AlightMotion Bulk V2",
  description:
    "Bulk AlightMotion premium using CleanTempMail (random domains) — auto generate email, background verification",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["count", "domain"],
  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah akun yang diproses (maks 3)",
    },
    domain: {
      type: "string",
      required: false,
      description: "Domain email spesifik (opsional, random jika tidak diisi)",
    },
  },

  async run(req, res) {
    try {
      const { count, domain } = { ...req.query, ...req.body };
      const n = Math.min(parseInt(count) || 1, 3);

      const results = [];
      const backgroundTasks = [];

      for (let i = 0; i < n; i++) {
        let email;
        if (domain) {
          email = await generateEmailWithDomain(domain);
        } else {
          email = await generateRandomEmail();
        }

        const inboxUrl = `https://cleantempmail.com/${email}`;

        logger.info(`[AM BulkV2] Created ${i + 1}/${n}: ${email}`);

        results.push({
          email,
          inboxUrl,
          orderId: null,
          status: "pending",
        });

        // Fire-and-forget background verification
        const bgTask = (async () => {
          await processVerificationBackground(email);
        })();
        backgroundTasks.push(bgTask);

        if (i < n - 1) await sleep(1000);
      }

      // Return immediately with created emails, background tasks continue
      return res.json({
        status: true,
        total: n,
        processing: true,
        message: "Emails created. Verification running in background.",
        results,
      });
    } catch (err) {
      logger.error(`[AM BulkV2] Request error: ${err.message}`);
      return res.status(500).json({ status: false, message: err.message || "Bulk request failed" });
    }
  },
};