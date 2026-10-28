/**
 * 【 LehzzMusify — Music Search & Stream 】
 * Base     : https://lehzzmusify.vercel.app/
 * Category : Search
 * Desc     : Cari lagu, ambil detail stream, lirik LRC, artis & album top
 */

import logger from '../../src/utils/logger.js'

const BASE_URL = 'https://lehzzmusify.vercel.app'
const LRCLIB_URL = 'https://lrclib.net/api/get'
const MODES = ['search', 'play', 'lyrics', 'home', 'artists', 'albums']

function formatDuration(seconds) {
  if (isNaN(seconds) || seconds == null) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function parseLrc(lrc) {
  if (!lrc || typeof lrc !== 'string') return []
  const lines = lrc.split('\n')
  const parsed = []
  const timeRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let match
    const timestamps = []
    while ((match = timeRegex.exec(trimmed)) !== null) {
      timestamps.push(parseInt(match[1]) * 60 + parseFloat(match[2]))
    }
    const text = trimmed.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim()
    for (const time of timestamps) {
      parsed.push({ time, timeFormatted: formatDuration(time), text })
    }
  }
  return parsed.sort((a, b) => a.time - b.time)
}

async function apiSearch(query) {
  const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(query.trim())}`, {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`)
  const data = await res.json()
  const tracks = Array.isArray(data) ? data : (data.tracks || data.results || data.data || [])
  return tracks.map(t => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    duration: formatDuration(t.duration),
    durationSec: t.duration,
    genre: t.genre || null,
    plays: t.plays || null,
    youtubeUrl: t.youtubeUrl || t.url || null,
    coverUrl: t.coverUrl || t.thumbnail || null
  }))
}

async function apiPlay(idOrQuery) {
  // coba langsung by ID dulu
  const byId = await fetch(`${BASE_URL}/api/songs/${encodeURIComponent(idOrQuery)}`, {
    headers: { Accept: 'application/json' }
  })
  let track = null
  if (byId.ok) {
    const d = await byId.json()
    track = d.track || d
  } else {
    // fallback: search lalu ambil yang pertama
    const results = await apiSearch(idOrQuery)
    if (!results.length) throw new Error(`Lagu tidak ditemukan: ${idOrQuery}`)
    track = results[0]
    // fetch detail
    if (track.id) {
      const det = await fetch(`${BASE_URL}/api/songs/${encodeURIComponent(track.id)}`, {
        headers: { Accept: 'application/json' }
      })
      if (det.ok) {
        const d = await det.json()
        track = { ...track, ...(d.track || d) }
      }
    }
  }
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: formatDuration(track.duration || track.durationSec),
    genre: track.genre || null,
    plays: track.plays || null,
    coverUrl: track.coverUrl || track.thumbnail || null,
    youtubeUrl: track.youtubeUrl || track.url || null,
    streamUrl: track.streamUrl || track.audioUrl || null,
    album: track.album || null
  }
}

async function apiLyrics(track, artist = '', duration = 0) {
  const roundDur = duration ? Math.round(duration) : 0
  const res = await fetch(
    `${BASE_URL}/api/lyrics?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}${roundDur ? `&duration=${roundDur}` : ''}`,
    { headers: { Accept: 'application/json' } }
  )
  let plain = null
  let synced = null

  if (res.ok) {
    const data = await res.json()
    plain = data.plainLyrics || data.lyrics || null
    synced = data.syncedLyrics || null
  }

  // fallback ke lrclib
  if (!plain && !synced) {
    const fb = await fetch(
      `${LRCLIB_URL}?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}${roundDur ? `&duration=${roundDur}` : ''}`,
      { headers: { Accept: 'application/json' } }
    )
    if (fb.ok) {
      const d = await fb.json()
      plain = d.plainLyrics || null
      synced = d.syncedLyrics || null
    }
  }

  if (!plain && !synced) throw new Error('Lirik tidak ditemukan')

  return {
    track,
    artist: artist || null,
    plainLyrics: plain,
    syncedLyrics: synced ? parseLrc(synced) : null
  }
}

async function apiHome(category = null) {
  const res = await fetch(`${BASE_URL}/api/feed`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Feed failed: HTTP ${res.status}`)
  const feed = await res.json()
  if (category) {
    const key = category.toLowerCase()
    return feed[key] ? { category: key, tracks: feed[key] } : feed
  }
  return feed
}

export default {
  name: 'LehzzMusify',
  description: 'Search lagu, lirik, dan streaming musik via LehzzMusify',
  category: 'Search',
  methods: ['GET', 'POST'],
  params: ['mode', 'query', 'id', 'artist', 'duration', 'category'],

  paramsSchema: {
    mode: {
      type: 'string',
      required: true,
      enum: MODES,
      description: 'Mode: search | play | lyrics | home | artists | albums'
    },
    query: {
      type: 'string',
      required: false,
      description: 'Kata kunci pencarian lagu/artis (untuk mode search, play, lyrics)',
      example: 'Hati-Hati di Jalan'
    },
    id: {
      type: 'string',
      required: false,
      description: 'ID lagu (untuk mode play, contoh: yt-_N6vSc_mT6I)',
      example: 'yt-_N6vSc_mT6I'
    },
    artist: {
      type: 'string',
      required: false,
      description: 'Nama artis (opsional, untuk mode lyrics)',
      example: 'TULUS'
    },
    duration: {
      type: 'number',
      required: false,
      description: 'Durasi lagu dalam detik (opsional, untuk akurasi lyrics)',
      example: 243
    },
    category: {
      type: 'string',
      required: false,
      enum: ['pagi', 'siang', 'sore', 'malam'],
      description: 'Filter feed berdasarkan waktu (untuk mode home)'
    }
  },

  async run(req, res) {
    try {
      const { mode, query, id, artist, duration, category } = { ...req.query, ...req.body }

      if (!mode) {
        return res.status(400).json({ status: false, message: `Parameter 'mode' wajib diisi. Pilihan: ${MODES.join(', ')}` })
      }

      const m = String(mode).toLowerCase()
      if (!MODES.includes(m)) {
        return res.status(400).json({ status: false, message: `Mode tidak valid. Pilihan: ${MODES.join(', ')}` })
      }

      // ── search ──
      if (m === 'search') {
        if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk mode search" })
        const results = await apiSearch(query)
        logger.info(`[LEHZZMUSIFY] search="${query}" | found=${results.length}`)
        return res.json({ status: true, mode: m, query, total: results.length, result: results })
      }

      // ── play ──
      if (m === 'play') {
        const target = id || query
        if (!target) return res.status(400).json({ status: false, message: "Parameter 'id' atau 'query' wajib diisi untuk mode play" })
        const track = await apiPlay(target)
        logger.info(`[LEHZZMUSIFY] play="${target}" | title=${track.title}`)
        return res.json({ status: true, mode: m, result: track })
      }

      // ── lyrics ──
      if (m === 'lyrics') {
        if (!query) return res.status(400).json({ status: false, message: "Parameter 'query' wajib diisi untuk mode lyrics (judul lagu)" })
        const lyrics = await apiLyrics(query, artist || '', duration ? parseFloat(duration) : 0)
        logger.info(`[LEHZZMUSIFY] lyrics="${query}" | artist=${artist || '-'} | synced=${!!lyrics.syncedLyrics}`)
        return res.json({ status: true, mode: m, result: lyrics })
      }

      // ── home ──
      if (m === 'home') {
        const feed = await apiHome(category || null)
        logger.info(`[LEHZZMUSIFY] home | category=${category || 'all'}`)
        return res.json({ status: true, mode: m, result: feed })
      }

      // ── artists ──
      if (m === 'artists') {
        const { TOP_ARTISTS } = await import('../../tes.js').catch(() => ({ TOP_ARTISTS: [] }))
        // fallback: fetch langsung dari source
        const resA = await fetch(`${BASE_URL}/api/artists`, { headers: { Accept: 'application/json' } }).catch(() => null)
        let artists = []
        if (resA?.ok) {
          const d = await resA.json()
          artists = Array.isArray(d) ? d : (d.artists || d.data || [])
        }
        logger.info(`[LEHZZMUSIFY] artists | count=${artists.length}`)
        return res.json({ status: true, mode: m, total: artists.length, result: artists })
      }

      // ── albums ──
      if (m === 'albums') {
        const resAl = await fetch(`${BASE_URL}/api/albums`, { headers: { Accept: 'application/json' } }).catch(() => null)
        let albums = []
        if (resAl?.ok) {
          const d = await resAl.json()
          albums = Array.isArray(d) ? d : (d.albums || d.data || [])
        }
        logger.info(`[LEHZZMUSIFY] albums | count=${albums.length}`)
        return res.json({ status: true, mode: m, total: albums.length, result: albums })
      }
    } catch (err) {
      logger.error(`[LEHZZMUSIFY] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Gagal memproses request' })
    }
  }
}
