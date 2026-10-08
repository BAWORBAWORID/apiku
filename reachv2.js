/**
 * WhatsApp Channel Reaction Scraper — Rin API
 * Source: https://apiii-xrina.vercel.app/rch
 * Target: https://apiii-xrina.vercel.app/rch/send
 * 
 * Features:
 * - Dynamic random IP rotation in X-Forwarded-For, Client-IP, X-Real-IP
 * - Full browser header fingerprinting
 * - Fake Browser (puppeteer-real-browser) fallback mode
 */

import axios from 'axios';

const BASE_URL = 'https://apiii-xrina.vercel.app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function getRandomIP() {
  const p1 = Math.floor(Math.random() * 200) + 11;
  const p2 = Math.floor(Math.random() * 255) + 1;
  const p3 = Math.floor(Math.random() * 255) + 1;
  const p4 = Math.floor(Math.random() * 254) + 1;
  return `${p1}.${p2}.${p3}.${p4}`;
}

export function getBrowserHeaders(ip = null) {
  const forwardedIp = ip || getRandomIP();
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': `${BASE_URL}/rch`,
    'Origin': BASE_URL,
    'Content-Type': 'application/json',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'X-Forwarded-For': forwardedIp,
    'Client-IP': forwardedIp,
    'X-Real-IP': forwardedIp,
    'True-Client-IP': forwardedIp,
    'X-Client-IP': forwardedIp
  };
}

/**
 * Mode 1: HTTP API Direct (Bypass Token + Spoof Headers)
 */
export async function reactch(url, emoji, customIp = null) {
  const reactionStr = Array.isArray(emoji) ? emoji.join(',') : String(emoji);
  const ip = customIp || getRandomIP();
  const headers = getBrowserHeaders(ip);

  try {
    const startTime = Date.now();

    // 1. Inisialisasi token & ray ID
    const initRes = await axios.get(`${BASE_URL}/rch/v/init`, {
      headers,
      timeout: 15000
    });
    const initData = initRes.data;
    if (!initData?.cid) {
      throw new Error(`Inisialisasi gagal: ${JSON.stringify(initData)}`);
    }

    // 2. Jeda manusia emulasi browser
    await sleep(1200 + Math.floor(Math.random() * 500));

    // 3. Verifikasi token manusia (Rin Shield bypass)
    const checkRes = await axios.post(
      `${BASE_URL}/rch/v/check`,
      { cid: initData.cid, hp: '' },
      { headers, timeout: 15000 }
    );
    const checkData = checkRes.data;
    if (!checkData?.token) {
      throw new Error(`Verifikasi token gagal: ${JSON.stringify(checkData)}`);
    }

    // 4. Kirim reaksi
    const sendRes = await axios.post(
      `${BASE_URL}/rch/send`,
      {
        url,
        reaction: reactionStr,
        cid: initData.cid,
        token: checkData.token
      },
      { headers, timeout: 20000 }
    );

    const endTime = Date.now();

    return {
      success: Boolean(sendRes.data?.status),
      mode: 'http',
      status: sendRes.status,
      ping: `${endTime - startTime}ms`,
      ip,
      data: sendRes.data
    };
  } catch (error) {
    return {
      success: false,
      mode: 'http',
      status: error.response?.status || 500,
      ip,
      error: error.message,
      data: error.response?.data || null
    };
  }
}

/**
 * Mode 2: Fake Browser Automation (Headless Real Browser)
 */
export async function reactchBrowser(url, emoji) {
  const reactionStr = Array.isArray(emoji) ? emoji.join('') : String(emoji);

  try {
    const { connect } = await import('puppeteer-real-browser');
    console.log('[Browser] Membuka headless real browser...');

    const { page, browser } = await connect({
      headless: 'auto',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      turnstile: true,
      disableXvfb: false
    });

    try {
      console.log(`[Browser] Mengakses ${BASE_URL}/rch ...`);
      await page.goto(`${BASE_URL}/rch`, { waitUntil: 'networkidle2', timeout: 30000 });

      // Verifikasi Rin Shield
      await page.waitForSelector('.rch-v-check', { timeout: 15000 });
      console.log('[Browser] Menekan tombol verifikasi...');
      await page.click('.rch-v-check');

      await page.waitForFunction(() => {
        const check = document.querySelector('.rch-v-check');
        return check && check.classList.contains('ok');
      }, { timeout: 20000 });
      console.log('[Browser] Verifikasi manusia berhasil!');

      // Input Link & Emoji
      await page.type('#rchLink', url);
      await page.type('#rchEmoji', reactionStr);

      console.log('[Browser] Menekan tombol Kirim React...');
      const sendResponsePromise = page.waitForResponse(
        (res) => res.url().includes('/rch/send'),
        { timeout: 25000 }
      );
      await page.click('#sendBtn');

      const sendResponse = await sendResponsePromise;
      const sendData = await sendResponse.json();

      return {
        success: Boolean(sendData.status),
        mode: 'browser',
        status: sendResponse.status(),
        data: sendData
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    return {
      success: false,
      mode: 'browser',
      error: err.message
    };
  }
}

export default { reactch, reactchBrowser, getRandomIP, getBrowserHeaders };

async function main() {
  const targetUrl = process.argv[2] || 'https://whatsapp.com/channel/0029Vb9GRyt6buMOcTKWse08/114';
  const emoji = process.argv[3] || '🥰';
  const forceBrowser = process.argv.includes('--browser');

  console.log(`Memulai proses bypass & reaction ke ${targetUrl}...`);
  console.log(`Emoji: ${emoji}`);

  let result;
  if (forceBrowser) {
    console.log('Mode: Real Fake Browser...');
    result = await reactchBrowser(targetUrl, emoji);
  } else {
    console.log('Mode: HTTP Client dengan X-Forwarded-For...');
    result = await reactch(targetUrl, emoji);
    console.log(`[IP Forwarded]: ${result.ip}`);

    // Jika mode HTTP gagal karena 429 dan user ingin fallback browser
    if (!result.success && result.status === 429 && process.argv.includes('--auto-fallback')) {
      console.log('\n[Fallback] HTTP Mode terkena limit, mencoba via Real Browser...');
      result = await reactchBrowser(targetUrl, emoji);
    }
  }

  if (result.success) {
    console.log('\n✅ BERHASIL:', JSON.stringify(result.data, null, 2));
  } else {
    console.error(`\n❌ GAGAL (HTTP ${result.status || '?'}):`, result.data?.message || result.error);
    if (result.data) {
      console.error('Detail:', JSON.stringify(result.data, null, 2));
    }
  }
}

const isMain = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  process.argv[1].endsWith('reachv2.js')
);

if (isMain) {
  main();
}
