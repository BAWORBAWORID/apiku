/** Scrape j2download.com web yg di pake savenest yg agak aneh by alfidev 
*/
const puppeteer = require('puppeteer');

/**
 * j2download.com downloader via Puppeteer
 *
 * Usage: node j2download.js <video_url> [quality]
 *
 * Examples:
 *   node j2download.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 *   node j2download.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "720p"
 *   node j2download.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "320kbps"
 */

const VIDEO_URL = process.argv[2];
const QUALITY = process.argv[3];

if (!VIDEO_URL) {
  console.error('Usage: node j2download.js <video_url> [quality]');
  process.exit(1);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let autolinkData = null;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  // Intercept autolink response
  await page.setRequestInterception(true);
  page.on('request', (req) => req.continue());
  page.on('response', async (res) => {
    if (res.url().includes('/api/autolink')) {
      try { autolinkData = await res.json(); } catch (e) {}
    }
  });

  console.log('🌐 Opening j2download.com...');
  await page.goto('https://j2download.com/', { waitUntil: 'networkidle2', timeout: 30000 });

  // Check Cloudflare challenge
  if ((await page.content()).includes('challenge-platform')) {
    console.log('⚠️  Cloudflare challenge, waiting...');
    await delay(10000);
  }

  console.log('📝 URL:', VIDEO_URL);
  await page.waitForSelector('#url', { timeout: 10000 });
  await page.click('#url', { clickCount: 3 });
  await page.type('#url', VIDEO_URL, { delay: 20 });
  await delay(300);

  console.log('🖱️  Downloading...');
  await page.click('button.button-go');

  // Wait for autolink response
  const t0 = Date.now();
  while (!autolinkData && Date.now() - t0 < 30000) await delay(500);

  if (!autolinkData || autolinkData.error) {
    console.error('❌ Failed:', JSON.stringify(autolinkData));
    await page.screenshot({ path: '/tmp/j2d-error.png', fullPage: true });
    await browser.close();
    process.exit(1);
  }

  // Video info
  console.log(`\n📺 ${autolinkData.title}`);
  console.log(`   Duration: ${autolinkData.duration} | Source: ${autolinkData.source}`);

  // Filter medias
  let medias = autolinkData.medias || [];
  if (QUALITY) {
    const q = QUALITY.toLowerCase();
    medias = medias.filter((m) => m.quality.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }

  console.log('\n📋 Downloads:');
  medias.forEach((m, i) => {
    console.log(`   [${i + 1}] ${m.label} (${m.type})`);
    console.log(`       ${m.url}`);
  });

  // Pick best video
  if (!QUALITY) {
    const best = medias.filter((m) => m.type === 'video').pop();
    if (best) {
      console.log(`\n🎯 Best: ${best.label}`);
      console.log(`   curl -L -o "video.${best.extension}" "${best.url}"`);
    }
  }

  await browser.close();
  console.log('\n✅ Done');
})();