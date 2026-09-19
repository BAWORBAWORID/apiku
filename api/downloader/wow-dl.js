import axios from "axios"

const TOOLS = [
  "apple-music-downloader", "douyin-downloader", "facebook-video-downloader",
  "instagram-reels-downloader", "instagram-story-downloader", "instagram-video-downloader",
  "likee-downloader", "linkedin-video-downloader", "pinterest-video-downloader",
  "soundcloud-downloader", "spotify-downloader", "tiktok-photo-downloader",
  "tiktok-story-downloader", "tiktok-video-downloader", "twitter-gif-downloader",
  "twitter-video-downloader", "youtube-monetization-checker", "youtube-money-calculator",
  "youtube-tags-extractor", "youtube-thumbnail-downloader", "youtube-transcript",
  "youtube-video-downloader",
]

export default {
  name: "Wow Downloader",
  description: "Multi-platform downloader (YouTube, TikTok, IG, FB, Twitter, Spotify, dll)",
  category: "Downloader",
  methods: ["GET", "POST"],

  params: ["url", "tool"],

  paramsSchema: {
    url: {
      type: "string",
      required: true,
      example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      description: "URL yang ingin di-download",
    },
    tool: {
      type: "string",
      required: true,
      example: "youtube-video-downloader",
      description: `Jenis tool: ${TOOLS.join(", ")}`,
    },
  },

  async run(req, res) {
    try {
      const { url, tool } = { ...req.query, ...req.body }

      if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      if (!tool) return res.status(400).json({ status: false, message: "Parameter 'tool' wajib diisi" })
      if (!/^https?:\/\//.test(url)) return res.status(400).json({ status: false, message: "URL harus diawali http:// atau https://" })
      if (!TOOLS.includes(tool)) return res.status(400).json({ status: false, message: `Tool tidak valid. Pilihan: ${TOOLS.join(", ")}` })

      const { data: html, headers } = await axios.get(`https://wowdownloader.com/tool/${tool}`, {
        headers: { "User-Agent": "Neo/1.0" },
      })

      const csrfToken = html.match(/<meta name="csrf-token" content="([^"]+)">/)?.[1]
      if (!csrfToken) throw new Error("Gagal mendapatkan CSRF token")

      const cookie = headers["set-cookie"]?.map(c => c.split(";")[0]).join("; ") || ""

      const { data } = await axios.post("https://wowdownloader.com/api/download", { url, tool }, {
        headers: {
          Origin: "https://wowdownloader.com",
          Referer: `https://wowdownloader.com/tool/${tool}`,
          "X-CSRF-Token": csrfToken,
          Cookie: cookie,
          "Content-Type": "application/json",
          "User-Agent": "Neo/1.0",
        },
      })

      return res.json({ status: true, result: data })
    } catch (err) {
      return res.status(500).json({ status: false, message: err.response?.data?.error || err.message })
    }
  },
}
