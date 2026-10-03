/**
 * Samehadaku Scraper API
 * Provider: Samehadaku (v2.samehadaku.how)
 * Fitur   : Scrape catalog anime, top 10, episode terbaru, pencarian, detail anime & daftar episode, streaming player embed, download multi-server (Gofile/Acefile/Mediafire)
 */

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import * as cheerio from "cheerio";
import logger from "../../src/utils/logger.js";
import { getChromePath } from "../../src/utils/chromePath.js";

const BASE = "https://v2.samehadaku.how";
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function resolveChromeExecutable() {
  try {
    const p = getChromePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}

  const env = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && fs.existsSync(env)) return env;

  const candidates = [
    "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    const cacheDir = path.resolve(process.env.HOME || "/root", ".cache", "puppeteer", "chrome");
    if (fs.existsSync(cacheDir)) {
      const dirs = fs.readdirSync(cacheDir).filter(d => d.startsWith("linux-")).sort().reverse();
      for (const d of dirs) {
        const bin = path.join(cacheDir, d, "chrome-linux64", "chrome");
        if (fs.existsSync(bin)) return bin;
      }
    }
  } catch {}

  return null;
}

let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  const executablePath = resolveChromeExecutable();
  browserInstance = await puppeteer.launch({
    executablePath: executablePath || undefined,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });
  return browserInstance;
}

async function waitForCloudflare(page, maxWaitMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const title = await page.title();
      if (title && !title.includes("Just a moment") && !title.includes("Attention Required") && !title.includes("Cloudflare")) {
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function fetchHTML(url) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    await waitForCloudflare(page);
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#038;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

// 1. Home
async function scrapeHome() {
  const html = await fetchHTML(BASE + "/");
  const $ = cheerio.load(html);

  // Top 10
  const top10 = [];
  $(".topten-animesu li").each((_, el) => {
    const $el = $(el);
    const url = $el.find("a").first().attr("href") || "";
    const title = $el.find("a").first().attr("title") || $el.find("a").first().text().trim();
    const rank = parseInt($el.find("b").last().text().trim(), 10) || null;
    const rating = $el.find(".fa-star").parent().text().replace(/[^\d.]/g, "").trim() || null;
    const image = $el.find("img").attr("src") || null;
    if (url && title) {
      top10.push({ rank, title: decodeEntities(title), url, rating, image });
    }
  });

  // Latest Episode
  const latest_episode = [];
  $(".post-show li, ul.post-show li").each((_, el) => {
    const $el = $(el);
    const title = $el.find(".entry-title a, h2 a").first().text().trim() || $el.find(".thumb a").attr("title") || "";
    const epUrl = $el.find(".thumb a").attr("href") || "";
    const animeUrl = $el.find(".entry-title a, h2 a").attr("href") || "";
    const image = $el.find("img").attr("src") || null;
    const epText = $el.find("span").filter((_, s) => $(s).text().includes("Episode")).text();
    const epMatch = epText.match(/Episode\s*(\d+)/i);
    const episode = epMatch ? parseInt(epMatch[1], 10) : null;
    const author = $el.find("[itemprop=\"author\"] [itemprop=\"name\"], .author [itemprop=\"name\"]").text().trim() || null;
    const releaseText = $el.find("span").filter((_, s) => $(s).text().includes("Released on")).text();
    const released = releaseText.replace(/Released on:\s*/i, "").trim() || null;

    if (title || epUrl) {
      latest_episode.push({
        title: decodeEntities(title),
        episode,
        anime_url: animeUrl || null,
        episode_url: epUrl || null,
        image,
        author,
        released
      });
    }
  });

  // Project Movie
  const project_movie = [];
  $("[id*=\"sdw_getpostanime\"] li").each((_, el) => {
    const $el = $(el);
    const title = $el.find("h2 a, .lftinfo h2").first().text().trim();
    const url = $el.find("a.series, h2 a").first().attr("href") || "";
    const image = $el.find("img").attr("src") || null;
    const genres = $el.find("a[href*=\"/genre/\"]").map((_, g) => $(g).text().trim()).get();
    if (title && url) {
      project_movie.push({
        title: decodeEntities(title),
        url,
        image,
        genres
      });
    }
  });

  return {
    source: BASE + "/",
    scraped_at: new Date().toISOString(),
    top10,
    latest_episode,
    project_movie,
  };
}

// 2. Search
async function searchAnime(keyword) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent(UA);
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 35000 });
    await waitForCloudflare(page);

    // Try AJAX live search
    const ajaxUrl = `${AJAX}?action=samehada_live_search&s=${encodeURIComponent(keyword)}`;
    const ajaxRes = await page.evaluate(async (targetUrl) => {
      try {
        const res = await fetch(targetUrl, {
          headers: { "X-Requested-With": "XMLHttpRequest" }
        });
        const text = await res.text();
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    }, ajaxUrl);

    if (ajaxRes && ajaxRes.data && Array.isArray(ajaxRes.data) && ajaxRes.data.length > 0) {
      return {
        keyword,
        total: ajaxRes.data.length,
        results: ajaxRes.data.map((d) => ({
          id: d.id,
          title: decodeEntities(d.title),
          url: d.url,
          thumb: d.thumb,
          score: d.score || null,
          type: d.type,
          status: d.status,
        })),
      };
    }

    // Fallback HTML search
    const searchUrl = `${BASE}/?s=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
    await waitForCloudflare(page);
    const html = await page.content();
    const $ = cheerio.load(html);
    const results = [];

    $("article.animpost, .animepost").each((_, el) => {
      const $el = $(el);
      const title = $el.find(".title h2, h2.entry-title, .entry-title a").first().text().trim() || $el.find("a").first().attr("title") || "";
      const url = $el.find("a").first().attr("href") || "";
      const thumb = $el.find("img").first().attr("src") || null;
      const type = $el.find(".type").first().text().trim() || null;
      const score = $el.find(".score").first().text().replace(/[^\d.]/g, "").trim() || null;
      if (title && url) {
        results.push({
          title: decodeEntities(title),
          url,
          thumb,
          score,
          type,
          status: null
        });
      }
    });

    return {
      keyword,
      total: results.length,
      results,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// 3. Detail Anime
async function scrapeAnime(slug) {
  let url = slug;
  if (!/^https?:\/\//.test(slug)) {
    url = `${BASE}/anime/${slug.replace(/^\/+|\/+$/g, "")}/`;
  }
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $("h1.entry-title, h1[itemprop=\"name\"], h1").first().text().trim();
  const thumb = $(".thumb img, .anmsa").first().attr("src") || null;
  const sinopsis = $(".entry-content-single, [itemprop=\"description\"], .desc").first().text().trim();

  const info = {};
  $(".infox span, .spe span").each((_, sp) => {
    const $sp = $(sp);
    const key = $sp.find("b").text().replace(/:/g, "").trim();
    if (key) {
      $sp.find("b").remove();
      info[key] = $sp.text().trim();
    }
  });

  const genres = $("a[href*=\"/genre/\"]").map((_, a) => $(a).text().trim()).get()
    .filter((v, i, a) => a.indexOf(v) === i);

  const episodes = [];
  const seenEp = new Set();
  $("a[href*=\"-episode-\"]").each((_, a) => {
    const epUrl = $(a).attr("href");
    const epTitle = $(a).text().trim() || $(a).attr("title") || "";
    if (epUrl && !seenEp.has(epUrl) && !epUrl.includes("/anime/")) {
      seenEp.add(epUrl);
      episodes.push({
        title: decodeEntities(epTitle),
        url: epUrl,
      });
    }
  });

  return {
    source: url,
    title: decodeEntities(title),
    thumb,
    sinopsis,
    genres,
    info,
    total_episodes: episodes.length,
    episodes,
  };
}

// 4. Detail Episode
async function scrapeEpisode(url) {
  if (!/^https?:\/\//.test(url)) {
    url = `${BASE}/` + url.replace(/^\/+/, "");
  }
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $("h1[itemprop=\"name\"], h1.entry-title, h1").first().text().trim();
  const description = $(".entry-content-single, [itemprop=\"description\"]").first().text().trim();
  const episodeNumber = $("span[itemprop=\"episodeNumber\"]").text().trim() || null;
  const timePost = $(".time-post").text().trim() || null;

  const servers = [];
  $("[id^=\"player-option-\"]").each((_, el) => {
    const $el = $(el);
    const name = $el.find("span").text().trim();
    const embedRaw = $el.attr("data-embed") || "";
    const decoded = decodeEntities(embedRaw);
    const iframeMatch = decoded.match(/src=["']([^"']+)["']/);
    const nume = parseInt($el.attr("id").replace("player-option-", ""), 10) || null;
    servers.push({
      nume,
      name,
      embed_url: iframeMatch ? iframeMatch[1] : null,
      embed_html: decoded
    });
  });

  const downloads = [];
  $(".download-eps, .dl-box").each((_, block) => {
    const $b = $(block);
    const format = $b.find("p b, b").first().text().trim();
    const items = [];
    $b.find("li").each((_, li) => {
      const $li = $(li);
      const resolution = $li.find("strong").text().trim();
      const links = [];
      $li.find("a").each((_, a) => {
        links.push({
          host: $(a).text().trim(),
          url: $(a).attr("href")
        });
      });
      if (resolution) items.push({ resolution, links });
    });
    if (format) downloads.push({ format, items });
  });

  const prevMatch = $(".nvs a[href*=\"episode\"]").first().attr("href") || null;
  const nextMatch = $(".nvs.rght a[href*=\"episode\"]").first().attr("href") || null;
  const allEpUrl = $(".nvs.nvsc a").first().attr("href") || $("h2[itemprop=\"partOfSeries\"] a").attr("href") || null;
  const animeTitle = $("h2[itemprop=\"partOfSeries\"]").text().trim();
  const animeThumb = $(".thumb[itemprop=\"image\"] img").attr("src") || null;

  return {
    source: url,
    title: decodeEntities(title),
    description,
    episode_number: episodeNumber ? parseInt(episodeNumber, 10) : null,
    time_post: timePost,
    anime: {
      title: decodeEntities(animeTitle),
      thumb: animeThumb,
      url: allEpUrl
    },
    servers,
    downloads,
    navigation: {
      prev: prevMatch,
      next: nextMatch,
      all_episodes: allEpUrl
    }
  };
}

// 5. Latest Only
async function scrapeLatest() {
  const home = await scrapeHome();
  return {
    source: BASE + "/",
    scraped_at: new Date().toISOString(),
    total: home.latest_episode.length,
    episodes: home.latest_episode,
  };
}

export default {
  name: "Samehadaku",
  description: "Scraper Samehadaku — streaming & catalog anime subtitle Indonesia: home, search, detail anime, episode player & download multi-server",
  category: "Anime",
  methods: ["GET", "POST"],
  params: ["action", "query", "url"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "home",
      description: "Aksi: home, latest, search, detail, episode",
      enum: ["home", "latest", "search", "detail", "episode"],
      example: "home",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (action=search) atau slug/url anime (action=detail, episode)",
      example: "One Piece",
    },
    url: {
      type: "string",
      required: false,
      description: "URL anime atau episode Samehadaku (action=detail, episode)",
      example: "https://v2.samehadaku.how/anime/one-piece/",
    },
  },

  async run(req, res) {
    try {
      const params = { ...req.query, ...req.body };
      const action = String(params.action || "home").trim().toLowerCase();
      const q = String(params.query || params.q || params.url || "").trim();

      logger.info(`[SAMEHADAKU] Request action=${action}`);

      // 1. Home
      if (action === "home") {
        const data = await scrapeHome();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 2. Latest
      if (action === "latest" || action === "terbaru") {
        const data = await scrapeLatest();
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 3. Search
      if (action === "search" || action === "cari") {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' wajib diisi untuk action=search",
          });
        }
        const data = await searchAnime(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 4. Detail Anime
      if (action === "detail" || action === "anime") {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'query' atau 'url' wajib diisi untuk action=detail",
          });
        }
        const data = await scrapeAnime(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      // 5. Episode Detail & Stream/Download
      if (action === "episode" || action === "ep") {
        if (!q) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' atau 'query' wajib diisi untuk action=episode",
          });
        }
        const data = await scrapeEpisode(q);
        return res.status(200).json({
          status: true,
          result: data,
        });
      }

      return res.status(400).json({
        status: false,
        message: `Action '${action}' tidak valid. Pilihan: home, latest, search, detail, episode`,
      });
    } catch (err) {
      logger.error(`[SAMEHADAKU] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses data Samehadaku",
      });
    }
  },
};
