/**
 * 【 Shazam Music Recognition 】
 * Base     : https://shazam.com/
 * Category : Search
 * Desc     : Kenali lagu dari URL audio — zero npm, hanya butuh ffmpeg
 */

import { spawn } from 'node:child_process'
import { writeFile, unlink, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import logger from '../../src/utils/logger.js'

const SAMPLE_RATE = 16000
const DEFAULT_WINDOW = 12
const MIN_WINDOW = 3
const DATA_URI_PREFIX = 'data:audio/vnd.shazam.sig;base64,'

// ─── ffmpeg helpers ───────────────────────────────────────────────────────────

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    let err = ''
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))
      else resolve(Buffer.concat(out))
    })
    p.on('error', (e) => reject(new Error(`ffmpeg not found: ${e.message}`)))
  })
}

async function decodePcm(path, offset = 0, duration = DEFAULT_WINDOW) {
  const dur = Math.min(Math.max(duration, MIN_WINDOW), 30)
  const buf = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(offset),
    '-t', String(dur),
    '-i', path,
    '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE),
    '-acodec', 'pcm_s16le', 'pipe:1',
  ])
  if (buf.length < SAMPLE_RATE * MIN_WINDOW * 2) {
    throw new Error('Audio terlalu pendek (minimal 3 detik)')
  }
  return buf
}

async function probeDuration(path) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-i', path, '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      resolve(m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null)
    })
    p.on('error', () => resolve(null))
  })
}

// ─── FFT (radix-2, pure JS) ───────────────────────────────────────────────────

function fftMag(reIn) {
  const n = reIn.length
  const re = Float64Array.from(reIn)
  const im = new Float64Array(n)
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (-2 * Math.PI) / len
    const wRe0 = Math.cos(ang), wIm0 = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0
      for (let j = 0; j < half; j++) {
        const k = i + j
        const tRe = uRe * re[k + half] - uIm * im[k + half]
        const tIm = uRe * im[k + half] + uIm * re[k + half]
        re[k + half] = re[k] - tRe
        im[k + half] = im[k] - tIm
        re[k] += tRe
        im[k] += tIm
        const nRe = uRe * wRe0 - uIm * wIm0
        uIm = uRe * wIm0 + uIm * wRe0
        uRe = nRe
      }
    }
  }
  const mag = new Float64Array((n >> 1) + 1)
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i])
  return mag
}

// ─── Signature generator ─────────────────────────────────────────────────────

const HANNING = (() => {
  const h = new Float64Array(2048)
  for (let i = 0; i < 2048; i++) h[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 2047)
  return h
})()

class SignatureGenerator {
  constructor() { this.reset() }
  reset() {
    this.ring = new Float64Array(2048)
    this.ringPos = 0
    this.numberSamples = 0
    this.ffts = Array.from({ length: 256 }, () => new Float64Array(1025))
    this.fftPos = 0
    this.spread = Array.from({ length: 256 }, () => new Float64Array(1025))
    this.spreadPos = 0
    this.written = 0
    this.peaks = { 0: [], 1: [], 2: [], 3: [] }
  }

  feed(pcmBuf) {
    const samples = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 2)
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.ringPos] = samples[i] / 32768
      this.ringPos = (this.ringPos + 1) % 2048
      this.numberSamples++
      if (this.numberSamples % 128 === 0) this._processWindow()
    }
  }

  _processWindow() {
    const windowed = new Float64Array(2048)
    for (let i = 0; i < 2048; i++) {
      windowed[i] = this.ring[(this.ringPos + i) % 2048] * HANNING[i]
    }
    const mag = fftMag(windowed)
    this.ffts[this.fftPos] = mag
    const sp = new Float64Array(1025)
    for (let i = 0; i < 1025; i++) {
      let v = mag[i]
      for (let d = 1; d <= 3; d++) {
        if (i - d >= 0) v = Math.max(v, this.spread[(this.spreadPos - d + 256) % 256][i])
        if (i + d < 1025) v = Math.max(v, this.spread[(this.spreadPos - d + 256) % 256][i])
      }
      sp[i] = v
    }
    this.spread[this.spreadPos] = sp
    this._extractPeaks(mag, sp)
    this.fftPos = (this.fftPos + 1) % 256
    this.spreadPos = (this.spreadPos + 1) % 256
    this.written++
  }

  _band(bin) {
    if (bin <= 10) return -1
    if (bin <= 40) return 0
    if (bin <= 80) return 1
    if (bin <= 200) return 2
    if (bin < 512) return 3
    return -1
  }

  _extractPeaks(mag, sp) {
    for (let i = 1; i < 1024; i++) {
      const b = this._band(i)
      if (b < 0) continue
      if (mag[i] > sp[i] * 0.4 && mag[i] > mag[i - 1] && mag[i] > mag[i + 1]) {
        this.peaks[b].push([this.written, mag[i], i])
      }
    }
  }

  getSignature() {
    const sampleMs = Math.round((this.numberSamples / SAMPLE_RATE) * 1000)
    const bands = [[], [], [], []]
    for (let b = 0; b < 4; b++) {
      const sorted = this.peaks[b].slice().sort((a, c) => c[1] - a[1]).slice(0, 100)
      bands[b] = sorted.map(([t, , f]) => ({ t, f })).sort((a, c) => a.t - c.t)
    }
    return { sampleMs, bands }
  }
}

// ─── Signature → binary ──────────────────────────────────────────────────────

function encodeSignature(sig) {
  const MAGIC1 = 0xcafe2589
  const MAGIC2 = 0x94119c00

  const bandBufs = []
  for (let b = 0; b < 4; b++) {
    const peaks = sig.bands[b]
    if (!peaks.length) { bandBufs.push(null); continue }
    const buf = Buffer.alloc(peaks.length * 4)
    for (let i = 0; i < peaks.length; i++) {
      buf.writeUInt32LE(((peaks[i].f & 0x3ff) | ((peaks[i].t & 0x3ffff) << 10)) >>> 0, i * 4)
    }
    bandBufs.push(buf)
  }

  let inner = 0
  for (let b = 0; b < 4; b++) if (bandBufs[b]) inner += 8 + bandBufs[b].length

  const total = 48 + inner
  const out = Buffer.alloc(total)
  let pos = 0
  out.writeUInt32LE(MAGIC1, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(total - 8, pos); pos += 4
  out.writeUInt32LE(MAGIC2, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(sig.sampleMs, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4
  out.writeUInt32LE(0, pos); pos += 4

  for (let b = 0; b < 4; b++) {
    if (!bandBufs[b]) continue
    const tag = 0x60030040 + b
    out.writeUInt32LE(tag >>> 0, pos); pos += 4
    out.writeUInt32LE(bandBufs[b].length, pos); pos += 4
    bandBufs[b].copy(out, pos); pos += bandBufs[b].length
  }

  return out
}

function makeSignature(pcmBuf) {
  const gen = new SignatureGenerator()
  gen.feed(pcmBuf)
  const sig = gen.getSignature()
  const bin = encodeSignature(sig)
  const uri = DATA_URI_PREFIX + bin.toString('base64')
  return { uri, sampleMs: sig.sampleMs }
}

// ─── Shazam API ──────────────────────────────────────────────────────────────

async function tag(uri, sampleMs, { language = 'en-US', country = 'US', timezone = 'Asia/Jakarta' } = {}) {
  const uuid1 = randomUUID().toUpperCase()
  const uuid2 = randomUUID().toUpperCase()
  const url = `https://amp.shazam.com/discovery/v5/${language}/${country}/iphone/-/tag/${uuid1}/${uuid2}`
  const body = {
    timezone,
    signature: { uri, samplems: sampleMs },
    timestamp: Date.now(),
    context: {},
    geolocation: {},
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Shazam API HTTP ${res.status}`)
  return res.json()
}

// ─── Core recognize function ──────────────────────────────────────────────────

async function recognize(audioUrl, opts = {}) {
  const {
    offset = 0,
    duration = DEFAULT_WINDOW,
    language = 'en-US',
    country = 'US',
    timezone = 'Asia/Jakarta',
    windows = 3,
  } = opts

  let tmp = null
  try {
    // Download audio to tmp file
    const res = await fetch(audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' })
    if (!res.ok) throw new Error(`Gagal download audio: HTTP ${res.status}`)
    tmp = join(tmpdir(), `shazam-${Date.now()}.bin`)
    await writeFile(tmp, Buffer.from(await res.arrayBuffer()))

    const total = await probeDuration(tmp)
    const attempts = []
    let result = null

    const starts = []
    if (total && total > 3 * duration) {
      starts.push(Math.max(0, total / 2 - duration / 2))
    }
    let cur = offset
    while (starts.length < windows) {
      if (!starts.includes(cur) && (total == null || cur < total - MIN_WINDOW)) starts.push(cur)
      cur += duration
      if (total != null && cur >= total) break
    }
    if (!starts.length) starts.push(0)

    for (const start of starts) {
      try {
        const pcm = await decodePcm(tmp, start, duration)
        const { uri, sampleMs } = makeSignature(pcm)
        const body = await tag(uri, sampleMs, { language, country, timezone })
        const matched = Array.isArray(body.matches) && body.matches.length > 0
        attempts.push({ offset_seconds: +start.toFixed(3), duration_seconds: +(sampleMs / 1000).toFixed(3), is_matched: matched })
        if (matched) { result = body; break }
      } catch (e) {
        attempts.push({ offset_seconds: +start.toFixed(3), error: e.message })
      }
    }

    const out = {
      is_matched: !!(result?.matches?.length),
      audio: { duration_seconds: total != null ? +total.toFixed(3) : null },
      attempts,
      track: result?.track || null,
    }

    if (out.track) {
      const t = out.track
      out.summary = {
        title: t.title || null,
        artist: t.subtitle || null,
        key: t.key || null,
        isrc: t.isrc || null,
        genre: t.genres?.primary || null,
        cover: t.images?.coverarthq || t.images?.coverart || null,
        shazam_url: t.share?.href || null,
        apple_music: t.hub?.options?.[0]?.actions?.find((a) => a.type === 'uri')?.uri || null,
        preview: t.hub?.actions?.find((a) => a.type === 'uri' && a.uri?.includes('preview'))?.uri || null,
        spotify: t.hub?.providers?.find((p) => p.type === 'SPOTIFY')?.actions?.[0]?.uri || null,
      }
    }

    return out
  } finally {
    if (tmp) unlink(tmp).catch(() => {})
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default {
  name: 'Shazam',
  description: 'Kenali lagu dari URL audio menggunakan Shazam — zero npm, hanya butuh ffmpeg',
  category: 'Search',
  methods: ['GET', 'POST'],
  params: ['url', 'offset', 'duration', 'language', 'country'],

  paramsSchema: {
    url: {
      type: 'string',
      required: true,
      description: 'URL file audio (mp3, m4a, ogg, flac, dll)',
      example: 'https://example.com/audio.mp3',
    },
    offset: {
      type: 'number',
      required: false,
      default: 0,
      description: 'Mulai dari detik ke- (default: 0)',
    },
    duration: {
      type: 'number',
      required: false,
      default: 12,
      description: 'Panjang sample dalam detik (3-30, default: 12)',
    },
    language: {
      type: 'string',
      required: false,
      default: 'en-US',
      description: 'Bahasa response (default: en-US)',
    },
    country: {
      type: 'string',
      required: false,
      default: 'US',
      description: 'Kode negara (default: US)',
    },
  },

  async run(req, res) {
    try {
      const { url, offset, duration, language, country } = { ...req.query, ...req.body }

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" })
      }

      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ status: false, message: "Parameter 'url' harus berupa URL audio yang valid" })
      }

      const result = await recognize(url, {
        offset: offset ? parseFloat(offset) : 0,
        duration: duration ? Math.min(Math.max(parseInt(duration), MIN_WINDOW), 30) : DEFAULT_WINDOW,
        language: language || 'en-US',
        country: country || 'US',
      })

      logger.info(`[SHAZAM] ${result.is_matched ? '✓' : '✗'} matched | ${url.slice(0, 60)} | title=${result.summary?.title || '-'}`)

      return res.json({ status: true, result })
    } catch (err) {
      logger.error(`[SHAZAM] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Gagal mengenali lagu' })
    }
  },
}
