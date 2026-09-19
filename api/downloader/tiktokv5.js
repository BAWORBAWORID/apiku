import axios from "axios"
import * as cheerio from "cheerio"
import logger from "../../src/utils/logger.js"

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

async function requestHtml(url) {
  const res = await axios.get(url, {
    headers: {
      'sec-ch-ua': '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'upgrade-insecure-requests': '1',
      'user-agent': UA,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-user': '?1',
      'sec-fetch-dest': 'document',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6',
      'priority': 'u=0, i'
    },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400
  })
  return { text: res.data, headers: res.headers }
}

function extractItemStruct(html) {
  const apiMatch = html.match(/<script id="api-data"[^>]*>([\s\S]*?)<\/script>/)
  if (apiMatch) {
    try {
      const j = JSON.parse(apiMatch[1])
      let s = j?.videoDetail?.itemInfo?.itemStruct || j?.itemInfo?.itemStruct
      if (s) return s
      if (j?.ItemModule) {
        const firstId = Object.keys(j.ItemModule)[0]
        if (firstId && j.ItemModule[firstId]) return j.ItemModule[firstId]
      }
    } catch (_) {}
  }

  const uniMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
  if (uniMatch) {
    try {
      const j = JSON.parse(uniMatch[1])
      const defaultScope = j?.__DEFAULT_SCOPE__ || {}
      for (const key of Object.keys(defaultScope)) {
        const s = defaultScope[key]?.itemInfo?.itemStruct
        if (s) return s
      }
    } catch (_) {}
  }
  return null
}

async function fetchPlayerApi(itemId) {
  try {
    const pUrl = `https://www.tiktok.com/player/api/v1/items?item_ids=${itemId}`
    const res = await axios.get(pUrl, { headers: { 'user-agent': UA }, timeout: 15000 })
    return res.data?.items?.[0]?.video_info?.url_list?.[0] || null
  } catch (_) {
    return null
  }
}

async function tiktokDirect(url) {
  const { text, headers } = await requestHtml(url)
  const detail = extractItemStruct(text)

  if (!detail) throw new Error("Gagal mengekstrak data dari HTML TikTok")

  const isImage = !!detail.imagePost
  let download = []

  if (isImage) {
    download = (detail.imagePost?.images || []).reduce((acc, img) => {
      return acc.concat(img?.imageURL?.urlList || [])
    }, [])
  } else {
    download = [detail.video?.downloadAddr, detail.video?.playAddr].filter(Boolean)
    if (detail.id) {
      const directUrl = await fetchPlayerApi(detail.id)
      if (directUrl) download.unshift(directUrl)
    }
  }

  const cookies = (headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')

  return {
    cookies,
    id: detail.id || detail.aweme_id || null,
    isVideo: !isImage,
    title: detail.desc || detail.suggestedWords?.[0] || '',
    region: detail.locationCreated || null,
    duration: `${detail.video?.duration || detail.music?.duration || 0} second`,
    cover: detail.video?.cover || detail.video?.originCover || null,
    stats: {
      like: detail.stats?.diggCount || 0,
      views: detail.stats?.playCount || 0,
      share: detail.stats?.shareCount || 0,
      comment: detail.stats?.commentCount || 0,
      collect: detail.stats?.collectCount || 0
    },
    download,
    author: {
      id: detail.author?.id || '',
      secUid: detail.author?.secUid || '',
      username: detail.author?.uniqueId || '',
      nickname: detail.author?.nickname || '',
      avatar: detail.author?.avatarLarger || detail.author?.avatarMedium || detail.author?.avatarThumb || null,
      verified: detail.author?.verified || false,
      followers: detail.authorStats?.followerCount || detail.author?.followerCount || 0,
      following: detail.authorStats?.followingCount || detail.author?.followingCount || 0,
      like: detail.authorStats?.heartCount || detail.author?.heartCount || 0,
      videoCount: detail.authorStats?.videoCount || detail.author?.videoCount || 0
    },
    music: {
      id: detail.music?.id || null,
      title: detail.music?.title || '',
      author: detail.music?.authorName || '',
      thumbnail: detail.music?.coverLarge || detail.music?.coverMedium || detail.music?.coverThumb || null,
      duration: `${detail.music?.duration || 0} second`,
      url: detail.music?.playUrl || null
    }
  }
}

export default {
  name: "TikTok Downloader Direct v5",
  description: "TikTok downloader langsung scrape HTML (support video + photo slide, author stats lengkap, music detail)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: { type: "string", required: true, description: "TikTok URL (vt.tiktok.com, tiktok.com, dll)", example: "https://vt.tiktok.com/ZSVFvdSTn/" }
  },
  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ status: false, error: "Parameter 'url' wajib diisi" })
      }

      const result = await tiktokDirect(url)
      return res.json({ status: true, ...result })
    } catch (err) {
      logger.error(`[TikTok v5] Error: ${err.message}`)
      return res.status(500).json({ status: false, error: err.message })
    }
  }
}