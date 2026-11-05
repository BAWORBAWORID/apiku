/**
 * X (Twitter) Media Downloader — via cdn.syndication.twimg.com + HTML fallback
 * Source: snippet.zellrayy.com/raw/prEn5hN248
 * Endpoint: /api/downloader/x
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

class XDownloader {
  constructor() {
    this.headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://x.com/',
    };
  }

  extractTweetId(url) {
    const patterns = [
      /(?:x\.com|twitter\.com)\/(?:i\/status|[^/]+\/status)\/(\d+)/i,
      /status\/(\d+)/i,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    return null;
  }

  getToken(id) {
    try {
      const bigId = BigInt(id);
      const hi = Number(bigId / 1_000_000_000_000_000n);
      const lo = Number(bigId % 1_000_000_000_000_000n) / 1e15;
      return ((hi + lo) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    } catch {
      return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    }
  }

  // Ambil base media ID dari URL gambar (untuk dedupe)
  getMediaBase(url) {
    if (!url) return null;
    const m = url.match(/\/media\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : url.split('?')[0];
  }

  async getFromSyndication(tweetId) {
    const token = this.getToken(tweetId);
    const features = [
      'tfw_timeline_list:',
      'tfw_follower_count_sunset:true',
      'tfw_tweet_edit_backend:on',
      'tfw_refsrc_session:on',
      'tfw_fosnr_soft_interventions_enabled:on',
      'tfw_show_birdwatch_pivots_enabled:on',
      'tfw_show_business_verified_badge:on',
      'tfw_duplicate_scribes_to_settings:on',
      'tfw_use_profile_image_shape_enabled:on',
      'tfw_video_hls_dynamic_manifests_15082:true_bitrate',
      'tfw_legacy_timeline_sunset:true',
      'tfw_tweet_edit_frontend:on',
    ].join(';');

    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}&features=${encodeURIComponent(features)}`;

    try {
      const res = await axios.get(url, {
        headers: {
          ...this.headers,
          'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
        return null;
      }

      if (res.data.__typename === 'TweetTombstone' || !res.data.id_str) {
        return null;
      }

      return res.data;
    } catch {
      return null;
    }
  }

  parseMedia(data) {
    const mediaList = [];
    const seen = new Set();

    const details = data.mediaDetails || data.extended_entities?.media || [];

    for (const m of details) {
      if (m.type === 'video' || m.type === 'animated_gif') {
        const variants = (m.video_info?.variants || []).filter(
          (v) => v.content_type === 'video/mp4' && v.url
        );
        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        const bestUrl = variants[0]?.url || null;
        if (bestUrl && !seen.has(bestUrl)) {
          seen.add(bestUrl);
          mediaList.push({
            type: m.type === 'animated_gif' ? 'gif' : 'video',
            thumbnail: m.media_url_https || m.media_url || null,
            duration_ms: m.video_info?.duration_millis || null,
            variants: variants.map((v) => ({
              bitrate: v.bitrate || 0,
              url: v.url,
            })),
            url: bestUrl,
          });
        }
      } else if (m.type === 'photo') {
        const imgUrl = m.media_url_https || m.media_url || null;
        const base = this.getMediaBase(imgUrl);
        if (imgUrl && base && !seen.has(base)) {
          seen.add(base);
          mediaList.push({
            type: 'image',
            url: imgUrl.includes('name=') ? imgUrl : `${imgUrl.split('?')[0]}?format=jpg&name=large`,
            thumbnail: imgUrl,
          });
        }
      }
    }

    // photos array (format syndication)
    if (Array.isArray(data.photos)) {
      for (const p of data.photos) {
        const imgUrl = p.url || p.media_url_https || null;
        const base = this.getMediaBase(imgUrl);
        if (imgUrl && base && !seen.has(base)) {
          seen.add(base);
          mediaList.push({
            type: 'image',
            url: imgUrl,
            thumbnail: imgUrl,
          });
        }
      }
    }

    // video object
    if (data.video) {
      const variants = (data.video.variants || []).filter(
        (v) => v.type === 'video/mp4' || v.content_type === 'video/mp4'
      );
      variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const bestUrl = variants[0]?.src || variants[0]?.url;
      if (bestUrl && !seen.has(bestUrl)) {
        seen.add(bestUrl);
        mediaList.push({
          type: 'video',
          thumbnail: data.video.poster || null,
          url: bestUrl,
          variants: variants.map((v) => ({
            bitrate: v.bitrate || 0,
            url: v.src || v.url,
          })),
        });
      }
    }

    return mediaList;
  }

  async getFromHtml(url, tweetId) {
    const res = await axios.get(url, {
      headers: this.headers,
      maxRedirects: 10,
      timeout: 20000,
    });

    const html = res.data;
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
    const description = $('meta[property="og:description"]').attr('content') || '';
    const thumbnail = $('meta[property="og:image"]').attr('content') || null;

    const mediaList = [];
    const seen = new Set();

    // 1. Ambil semua og:image (kadang ada lebih dari 1)
    $('meta[property="og:image"]').each((_, el) => {
      const img = $(el).attr('content');
      const base = this.getMediaBase(img);
      if (img && base && !seen.has(base) && img.includes('/media/')) {
        seen.add(base);
        mediaList.push({ type: 'image', url: img, thumbnail: img });
      }
    });

    // 2. Cari di script yang mengandung tweetId
    $('script').each((_, el) => {
      const content = $(el).html() || '';
      if (!content.includes(tweetId)) return;

      // Gambar
      const imgMatches = content.matchAll(/"media_url_https"\s*:\s*"(https:\/\/pbs\.twimg\.com\/media\/[^"]+)"/g);
      for (const match of imgMatches) {
        let imgUrl = match[1].replace(/\\u0026/g, '&');
        const base = this.getMediaBase(imgUrl);
        if (base && !seen.has(base) && !imgUrl.includes('profile_')) {
          seen.add(base);
          mediaList.push({ type: 'image', url: imgUrl, thumbnail: imgUrl });
        }
      }

      // Video (pastikan content_type video/mp4)
      const videoBlocks = content.matchAll(
        /"type"\s*:\s*"(?:video|animated_gif)"[\s\S]*?"video_info"\s*:\s*\{[\s\S]*?"variants"\s*:\s*\[([\s\S]*?)\]/g
      );
      for (const block of videoBlocks) {
        const variantsStr = block[1];
        const urls = [...variantsStr.matchAll(/"url"\s*:\s*"(https:\/\/video\.twimg\.com\/[^"]+\.mp4[^"]*)"/g)];
        const bitrates = [...variantsStr.matchAll(/"bitrate"\s*:\s*(\d+)/g)];

        let best = null;
        let bestBitrate = -1;
        for (let i = 0; i < urls.length; i++) {
          const u = urls[i][1].replace(/\\u0026/g, '&');
          const br = bitrates[i] ? parseInt(bitrates[i][1]) : 0;
          if (br > bestBitrate) {
            bestBitrate = br;
            best = u;
          }
        }
        if (best && !seen.has(best)) {
          seen.add(best);
          mediaList.push({ type: 'video', url: best, thumbnail: null });
        }
      }
    });

    // 3. Fallback og:video
    const ogVideo =
      $('meta[property="og:video"]').attr('content') ||
      $('meta[property="og:video:url"]').attr('content');
    if (ogVideo && !seen.has(ogVideo)) {
      mediaList.push({ type: 'video', url: ogVideo, thumbnail });
    }

    // 4. Kalau masih kosong, pakai thumbnail
    if (mediaList.length === 0 && thumbnail) {
      mediaList.push({ type: 'image', url: thumbnail, thumbnail });
    }

    // Username
    let username = null;
    let displayName = null;
    const titleMatch = title.match(/^(.+?)\s*\(@(\w+)\)/);
    if (titleMatch) {
      displayName = titleMatch[1].trim();
      username = titleMatch[2];
    } else {
      const urlMatch = url.match(/(?:x\.com|twitter\.com)\/([^/]+)/i);
      if (urlMatch && urlMatch[1] !== 'i' && urlMatch[1] !== 'status') {
        username = urlMatch[1];
      }
    }

    return {
      username,
      displayName,
      text: description,
      media: mediaList,
    };
  }

  async getInfo(url) {
    try {
      const tweetId = this.extractTweetId(url);
      if (!tweetId) {
        return { success: false, error: 'URL tidak valid' };
      }

      // Prioritas syndication
      let data = await this.getFromSyndication(tweetId);

      if (data) {
        const user = data.user || {};
        const media = this.parseMedia(data);

        return {
          success: true,
          platform: 'X/Twitter',
          source: 'syndication',
          tweetId: data.id_str || tweetId,
          username: user.screen_name || null,
          displayName: user.name || null,
          text: data.text || data.full_text || '',
          createdAt: data.created_at || null,
          media,
          originalUrl: url,
        };
      }

      // Fallback HTML
      const htmlData = await this.getFromHtml(url, tweetId);
      return {
        success: true,
        platform: 'X/Twitter',
        source: 'html',
        tweetId,
        username: htmlData.username || null,
        displayName: htmlData.displayName || null,
        text: htmlData.text || '',
        media: htmlData.media,
        originalUrl: url,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async run(url) {
    const info = await this.getInfo(url);
    console.log(JSON.stringify(info, null, 2));
  }
}

export default {
  name: "X (Twitter) Downloader",
  description: "Download media (video/gambar) dari tweet X/Twitter via Syndication API dengan fallback HTML scrape",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL tweet (x.com atau twitter.com)",
      example: "https://x.com/SpaceX/status/1732824684683784516",
    },
  },

  async run(req, res) {
    const { url } = { ...req.query, ...req.body };
    if (!url) {
      return res.status(400).json({ status: false, message: "Parameter wajib: url (link tweet)" });
    }
    const downloader = new XDownloader();
    const info = await downloader.getInfo(url);
    if (!info.success) {
      return res.status(400).json({ status: false, message: info.error || "Gagal mengambil data tweet" });
    }
    if (!info.media || info.media.length === 0) {
      return res.status(404).json({ status: false, message: "Tidak ada media di tweet ini", tweetId: info.tweetId, text: info.text });
    }
    return res.json({
      status: true,
      credit: "zellrayy",
      platform: info.platform,
      source: info.source,
      tweetId: info.tweetId,
      username: info.username,
      displayName: info.displayName,
      text: info.text,
      createdAt: info.createdAt || null,
      media_count: info.media.length,
      media: info.media,
    });
  },
};
