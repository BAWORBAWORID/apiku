/**
 * GetDL Downloader API
 * Universal media downloader (TikTok, Douyin, Instagram, Facebook, YouTube, X, dan lainnya)
 * via getdl.space API
 *
 * Source: https://gist.github.com/NajmyW/8276499e0f0e2bf0f8d9331c0776adc3
 *
 * GET  /api/downloader/getdl?url=<post-url>
 * POST /api/downloader/getdl -d {"url": "..."}
 */

import logger from "../../src/utils/logger.js"

const CONFIG = {
  BASE_URL: "https://getdl.space",
  TIMEOUT: 30_000,
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

const PLATFORM_PATTERNS = {
  tiktok: /tiktok\.com/i,
  douyin: /(?:^|\/\/)(?:[\w-]+\.)*douyin\.com(?:\/|$)/i,
  instagram: /instagram\.com/i,
  facebook: /facebook\.com|fb\.watch/i,
  youtube: /youtube\.com|youtu\.be/i,
  twitter: /twitter\.com|x\.com/i,
  threads: /threads\.net/i,
  capcut: /capcut\.com/i,
  spotify: /spotify\.com/i,
  soundcloud: /soundcloud\.com/i,
  pinterest: /(?:www\.)?pinterest\.(?:com|co\.uk|ca|de|fr|jp)/i,
  bilibili: /(?:www\.)?bilibili\.tv/i,
  snapchat: /(?:www\.)?snapchat\.com/i,
  pixiv: /(?:www\.)?pixiv\.net/i,
}

const PLATFORM_NAMES = {
  tiktok: "TikTok",
  douyin: "Douyin",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  twitter: "X / Twitter",
  threads: "Threads",
  capcut: "CapCut",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  pinterest: "Pinterest",
  bilibili: "BiliBili",
  snapchat: "Snapchat",
  pixiv: "Pixiv",
}

function detectPlatform(url) {
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(url)) return platform
  }
  return "unknown"
}

function parseCookies(cookieString) {
  const cookies = {}
  if (!cookieString) return cookies
  cookieString.split(";").forEach((cookie) => {
    const [name, value] = cookie.trim().split("=")
    if (name && value !== undefined) cookies[name] = value
  })
  return cookies
}

function formatCookies(cookies) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

let cachedCookies = {}

async function httpRequest(method, path, body) {
  const requestUrl = path.startsWith("http") ? path : `${CONFIG.BASE_URL}${path}`
  const headers = {
    "User-Agent": CONFIG.USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Origin: CONFIG.BASE_URL,
    Referer: `${CONFIG.BASE_URL}/en`,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  }

  const cookieHeader = formatCookies(cachedCookies)
  if (cookieHeader) headers.Cookie = cookieHeader
  if (body) {
    headers["Content-Type"] = "application/json"
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT)

  let response
  try {
    response = await fetch(requestUrl, {
      method,
      headers,
      signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    })
  } finally {
    clearTimeout(timer)
  }

  const setCookie = response.headers.get("set-cookie")
  if (setCookie) cachedCookies = { ...cachedCookies, ...parseCookies(setCookie) }

  let data = null
  const text = await response.text()
  try {
    if (text.startsWith("{") || text.startsWith("[")) data = JSON.parse(text)
  } catch {
    /* not json */
  }

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}: ${response.statusText || "Request failed"}`)
    err.status = response.status
    throw err
  }

  return { status: response.status, data, text }
}

let sessionCache = { id: null, expiry: 0 }

async function ensureSession() {
  if (sessionCache.id && Date.now() < sessionCache.expiry) return sessionCache.id

  await httpRequest("GET", "/en")
  const res = await httpRequest("GET", "/api/session")

  if (!res.data || !res.data.success || !res.data.sessionId) {
    throw new Error("Gagal mendapatkan session dari getdl.space")
  }

  sessionCache = { id: res.data.sessionId, expiry: Date.now() + 3_600_000 }
  return sessionCache.id
}

export default {
  name: "GetDL Downloader",
  description: "Download media video/audio dari berbagai platform (TikTok, Douyin, Instagram, Facebook, YouTube, X, dll)",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL post/video yang ingin di-download",
      example: "https://www.tiktok.com/@thesadewa/video/7682741289846050055",
    },
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const { url } = { ...req.query, ...req.body }

      if (!url || typeof url !== "string" || url.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      let parsedUrl
      try {
        parsedUrl = new URL(url.trim())
        if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error()
      } catch {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' harus berupa URL http/https yang valid",
        })
      }

      const cleanUrl = parsedUrl.toString()
      const platform = detectPlatform(cleanUrl)

      logger.info(`[GETDL] download ${platform} <- ${cleanUrl}`)

      const sessionId = await ensureSession()
      const resData = await httpRequest("POST", "/api/download", {
        url: cleanUrl,
        sessionId,
      })

      const data = resData.data
      if (!data || !data.success) {
        const errorMsg = data?.error || "Unknown error"
        logger.error(`[GETDL] Upstream error: ${JSON.stringify(data)}`)
        return res.status(502).json({
          status: false,
          message: errorMsg,
          metadata: { processing_time: `${Date.now() - startTime}ms` },
        })
      }

      const d = data.data || {}
      const downloads = (d.downloads || []).map((item) => ({
        label: item.label || "Download",
        url: item.url || "",
        quality: item.quality || null,
        ext: (item.ext || "mp4").toLowerCase().replace(".", ""),
      }))

      const duration = Date.now() - startTime
      logger.info(`[GETDL] OK ${platform} title="${d.title || ""}" downloads=${downloads.length} | ${duration}ms`)

      return res.json({
        status: true,
        platform,
        platform_name: PLATFORM_NAMES[platform] || platform,
        type: d.type || "video",
        title: d.title || "",
        thumbnail: d.thumbnail || "",
        author: {
          name: d.author?.name || "Unknown",
          username: d.author?.username || "",
          avatar: d.author?.avatar || null,
        },
        duration: d.duration || null,
        downloads,
        metadata: { processing_time: `${duration}ms` },
      })
    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[GETDL] Error: ${error.message}`)
      return res.status(502).json({
        status: false,
        message: error.message || "GetDL request failed",
        metadata: { processing_time: `${duration}ms` },
      })
    }
  },
}