import * as cheerio from "cheerio"

const BASE_URL = "https://alldownloader.us.ci"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function absolutize(p) {
  if (!p) return null
  if (/^https?:\/\//i.test(p)) return p
  return `${BASE_URL}${p.startsWith("/") ? "" : "/"}${p}`
}

async function requestDownload(mediaUrl, format = "video") {
  const formData = new URLSearchParams()
  formData.append("url", mediaUrl.trim())
  formData.append("format", format)

  const response = await fetch(`${BASE_URL}/download`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Origin": BASE_URL,
      "Referer": `${BASE_URL}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    },
    body: formData.toString(),
  })

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status} saat request format ${format}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  const errorAlert = $(".alert-error, .text-red-500, #errorMessage").first().text().trim()
  if (errorAlert && !$(".result-card").length && !$(".carousel-item").length) {
    throw new Error(errorAlert)
  }

  const carouselItems = []
  $(".carousel-item").each((_, el) => {
    const item = $(el)
    const url = item.attr("data-url")
    const original = item.attr("data-original")
    const isVideo = item.attr("data-video") === "true"
    const thumb = item.find("img").attr("src")

    carouselItems.push({
      type: isVideo ? "video" : "image",
      preview_url: absolutize(url),
      download_url: absolutize(original),
      thumbnail: absolutize(thumb),
    })
  })

  const videoSrc = $("video source").attr("src") || $("video").attr("src")
  const audioSrc = $("audio source").attr("src") || $("audio").attr("src")
  const downloadBtn = $("button.download-btn, button[onclick*='forceDownload']").first()
  const directLink = $(".result-card a[target='_blank'], a[href^='/file/']").first().attr("href")
  const title = downloadBtn.attr("data-title") || $("meta[property='og:title']").attr("content") || ""

  let rawFile = null
  const clickAttr = downloadBtn.attr("onclick") || ""
  const matchForce = clickAttr.match(/forceDownload\(['"]([^'"]+)['"]/)
  if (matchForce) {
    rawFile = matchForce[1]
  }

  const downloadUrl = absolutize(directLink || rawFile)

  return {
    title: title.trim(),
    download_url: downloadUrl,
    preview_url: absolutize(videoSrc || audioSrc),
    carousel: carouselItems.length > 0 ? carouselItems : null,
  }
}

async function scrapeAll(mediaUrl) {
  if (!mediaUrl) throw new Error("URL media wajib diisi!")

  const [videoRes, audioRes] = await Promise.allSettled([
    requestDownload(mediaUrl, "video"),
    requestDownload(mediaUrl, "audio"),
  ])

  const videoData = videoRes.status === "fulfilled" ? videoRes.value : null
  const audioData = audioRes.status === "fulfilled" ? audioRes.value : null

  if (!videoData && !audioData) {
    const err = (videoRes.status === "rejected" && videoRes.reason?.message) ||
                (audioRes.status === "rejected" && audioRes.reason?.message) ||
                "Gagal mengambil media"
    throw new Error(err)
  }

  const title = videoData?.title || audioData?.title || "all_media"

  return {
    title,
    downloads: {
      video: videoData?.download_url ? {
        format: "mp4",
        download_url: videoData.download_url,
        preview_url: videoData.preview_url,
      } : null,
      audio: audioData?.download_url ? {
        format: "mp3",
        download_url: audioData.download_url,
        preview_url: audioData.preview_url,
      } : null,
      carousel: videoData?.carousel || null,
    },
  }
}

export default {
  name: "All-in-One Downloader v5",
  description: "Unduh video MP4, audio MP3, atau gambar dari berbagai platform sosial media (TikTok, YouTube, Instagram, Facebook).",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL media yang ingin diunduh",
      example: "https://vt.tiktok.com/ZSpXmrBF9/",
    },
  },

  async run(req, res) {
    try {
      const { url } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'url' wajib diisi",
        })
      }

      const data = await scrapeAll(url)

      return res.json({
        status: true,
        result: data,
      })
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses link media",
      })
    }
  },
}
