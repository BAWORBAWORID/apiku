import axios from "axios"
import * as cheerio from "cheerio"
import logger from "../../src/utils/logger.js"

const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000
const CLEANUP_INTERVAL = 60 * 1000

setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const [key, item] of cache.entries()) {
    if (now > item.expires) {
      cache.delete(key)
      cleaned++
    }
  }
  if (cleaned > 0) {
    logger.info(`[YOUTUBE] Cleaned ${cleaned} expired cache entries`)
  }
}, CLEANUP_INTERVAL)

function getFromCache(username) {
  const key = username.toLowerCase()
  const item = cache.get(key)
  if (item && Date.now() < item.expires) {
    item.hits++
    return item
  }
  return null
}

function saveToCache(username, data) {
  const key = username.toLowerCase()
  const item = {
    data,
    expires: Date.now() + CACHE_TTL,
    created: new Date().toISOString(),
    hits: 1
  }
  cache.set(key, item)
  logger.info(`[YOUTUBE] Cache created for channel: ${username}`)
}

function generateRandomIP() {
  return `${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255) + 1}.${Math.floor(Math.random() * 255) + 1}`
}

function formatSubscriberCount(countText) {
  if (!countText) return "0"
  return countText.replace('subscribers', '').trim()
}

function formatVideoCount(countText) {
  if (!countText) return "0"
  return countText.replace('videos', '').trim()
}

function extractChannelData(parsedData) {
  const channelMetadata = {
    username: null,
    name: null,
    subscriberCount: "0",
    videoCount: "0",
    avatarUrl: null,
    channelUrl: null,
    description: null,
    isVerified: false,
    joinDate: null
  }

  try {
    if (parsedData.header?.pageHeaderRenderer) {
      const header = parsedData.header.pageHeaderRenderer
      channelMetadata.name = header.content?.pageHeaderViewModel?.title?.content

      const metadataRows = header.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows
      if (metadataRows?.[0]?.metadataParts?.[0]?.text?.content) {
        channelMetadata.username = metadataRows[0].metadataParts[0].text.content.replace('@', '')
      }

      if (header.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources?.[0]?.url) {
        channelMetadata.avatarUrl = header.content.pageHeaderViewModel.image.decoratedAvatarViewModel.avatar.avatarViewModel.image.sources[0].url
      }

      if (metadataRows?.[1]?.metadataParts) {
        metadataRows[1].metadataParts.forEach((part) => {
          if (part.text?.content) {
            if (part.text.content.includes('subscribers')) {
              channelMetadata.subscriberCount = formatSubscriberCount(part.text.content)
            } else if (part.text.content.includes('videos')) {
              channelMetadata.videoCount = formatVideoCount(part.text.content)
            }
          }
        })
      }
    }

    if (parsedData.metadata?.channelMetadataRenderer) {
      const channelMeta = parsedData.metadata.channelMetadataRenderer
      channelMetadata.description = channelMeta.description
      channelMetadata.channelUrl = channelMeta.channelUrl
      if (channelMeta.title?.includes('✓') || channelMeta.description?.includes('verified')) {
        channelMetadata.isVerified = true
      }
    }

    if (parsedData.contents?.twoColumnBrowseResultsRenderer?.tabs?.[1]?.tabRenderer?.content?.sectionListRenderer?.contents) {
      const aboutTab = parsedData.contents.twoColumnBrowseResultsRenderer.tabs[1].tabRenderer.content.sectionListRenderer.contents
      aboutTab.forEach(section => {
        if (section.itemSectionRenderer?.contents?.[0]?.channelAboutFullMetadataRenderer?.joinedDateText?.content) {
          channelMetadata.joinDate = section.itemSectionRenderer.contents[0].channelAboutFullMetadataRenderer.joinedDateText.content
        }
      })
    }

  } catch (error) {
    logger.error(`[YOUTUBE] Error extracting channel data: ${error.message}`)
  }

  return channelMetadata
}

function extractLatestVideos(parsedData) {
  const videoDataList = []

  try {
    const tabs = parsedData.contents?.twoColumnBrowseResultsRenderer?.tabs
    if (!tabs || tabs.length === 0) return videoDataList

    const videosTab = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents
    if (!videosTab) return videoDataList

    let videoCount = 0

    for (const item of videosTab) {
      if (videoCount >= 5) break

      if (item.itemSectionRenderer) {
        for (const content of item.itemSectionRenderer.contents) {
          if (content.shelfRenderer?.content?.horizontalListRenderer) {
            const items = content.shelfRenderer.content.horizontalListRenderer.items
            for (const video of items) {
              if (videoCount >= 5) break

              if (video.gridVideoRenderer) {
                const videoRenderer = video.gridVideoRenderer
                const videoId = videoRenderer.videoId
                const videoData = {
                  videoId: videoId,
                  title: videoRenderer.title?.simpleText || "No title",
                  thumbnail: videoRenderer.thumbnail?.thumbnails?.[0]?.url || null,
                  publishedTime: videoRenderer.publishedTimeText?.simpleText || "Unknown",
                  viewCount: videoRenderer.viewCountText?.simpleText || "0 views",
                  duration: videoRenderer.thumbnailOverlays?.find(
                    overlay => overlay.thumbnailOverlayTimeStatusRenderer
                  )?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || null,
                  videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                  shortUrl: `https://youtu.be/${videoId}`
                }
                videoDataList.push(videoData)
                videoCount++
              }
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error(`[YOUTUBE] Error extracting videos: ${error.message}`)
  }

  return videoDataList
}

async function stalkYouTube(username) {
  try {
    const cleanUsername = username.replace('@', '').trim()
    const randomIP = generateRandomIP()
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'

    const headers = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'X-Forwarded-For': randomIP,
      'X-Real-IP': randomIP
    }

    logger.info(`[YOUTUBE] Fetching channel: @${cleanUsername}`)

    const { data: htmlContent } = await axios.get(
      `https://www.youtube.com/@${cleanUsername}`,
      { headers, timeout: 15000 }
    )

    if (!htmlContent) {
      throw new Error('Failed to fetch YouTube page content.')
    }

    const $ = cheerio.load(htmlContent)
    const scriptContent = $('script').filter(function() {
      return $(this).html().includes('var ytInitialData =')
    }).html()

    if (!scriptContent) {
      throw new Error('Could not find YouTube initial data.')
    }

    const jsonMatch = scriptContent.match(/var ytInitialData = (.*?);/)
    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('Could not parse YouTube initial data.')
    }

    const parsedData = JSON.parse(jsonMatch[1])
    const channelData = extractChannelData(parsedData)
    const latestVideos = extractLatestVideos(parsedData)

    if (!channelData.username) {
      throw new Error('Channel not found or data unavailable.')
    }

    return {
      id: channelData.username,
      username: channelData.username,
      name: channelData.name,
      description: channelData.description || "No description",
      verified: channelData.isVerified,
      subscriberCount: channelData.subscriberCount,
      videoCount: channelData.videoCount,
      joinDate: channelData.joinDate,
      avatar: { url: channelData.avatarUrl },
      stats: {
        subscribers: channelData.subscriberCount,
        videos: channelData.videoCount
      },
      latestVideos: latestVideos,
      profileUrl: `https://www.youtube.com/@${cleanUsername}`
    }

  } catch (error) {
    logger.error(`[YOUTUBE] Stalk error: ${error.message}`)

    if (error.response?.status === 404) {
      throw new Error(`YouTube channel '${username}' not found`)
    }
    throw new Error(`Failed to fetch YouTube data: ${error.message}`)
  }
}

export default {
  name: "YouTube Stalker",
  description: "Get detailed YouTube channel profile info including latest videos",
  category: "Stalker",
  methods: ["GET", "POST"],

  params: ["username"],

  paramsSchema: {
    username: {
      type: "string",
      required: true,
      description: "YouTube channel username (with or without @)",
      example: "mrbeast",
      minLength: 1,
      maxLength: 50
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      let username
      if (req.method === 'GET') {
        username = req.query.username
      } else {
        username = req.body?.username
      }

      if (!username) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'username' is required",
          example: {
            GET: "/api/stalk/youtube?username=mrbeast",
            POST: { "username": "mrbeast" }
          }
        })
      }

      if (typeof username !== 'string' || username.trim().length === 0) {
        return res.status(400).json({
          status: false,
          message: "Username must be a non-empty string"
        })
      }

      const cleanUsername = username.replace(/^@/, '').trim()
      const clientIp = req.ip || req.connection.remoteAddress
      logger.info(`[YOUTUBE] Request from ${clientIp} for @${cleanUsername}`)

      const cached = getFromCache(cleanUsername)
      let userData

      if (cached) {
        userData = cached.data
        logger.info(`[YOUTUBE] Serving from cache: ${cleanUsername}`)
      } else {
        userData = await stalkYouTube(cleanUsername)
        saveToCache(cleanUsername, userData)
      }

      return res.json({
        status: true,
        user: userData,
        metadata: {
          cached: !!cached,
          source: "youtube.com",
          processing_time: `${Date.now() - startTime}ms`,
          timestamp: new Date().toISOString()
        }
      })

    } catch (error) {
      const duration = Date.now() - startTime
      logger.error(`[YOUTUBE] Error after ${duration}ms: ${error.message}`)

      const statusCode = error.message.includes("not found") ? 404 :
                         error.message.includes("not exist") ? 404 :
                         error.message.includes("Channel not found") ? 404 : 500

      return res.status(statusCode).json({
        status: false,
        message: error.message,
        duration: `${duration}ms`
      })
    }
  }
}
