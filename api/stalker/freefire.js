import crypto from 'node:crypto'
import fetch from 'node-fetch'
import logger from "../../src/utils/logger.js"

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://gameskinbo.com/free_fire_id_checker',
  'Origin': 'https://gameskinbo.com',
  'Accept': 'application/json',
  'x-api-client': 'gameskinbo-web'
}

const ADENPEDIA_URL = 'https://adenpedia.my.id/radenbaru/info.php?uid='
const GAMESKINBO_URL = 'https://gameskinbo.com/api/ff_id_checker'

const memoryCache = { csrfToken: null, csrfExpiry: 0 }

async function getCachedCsrfToken(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && memoryCache.csrfToken && now < memoryCache.csrfExpiry) {
    return memoryCache.csrfToken
  }
  try {
    const res = await fetch('https://gameskinbo.com/api/csrf-token', {
      headers: { ...BASE_HEADERS, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.csrfToken) {
        memoryCache.csrfToken = data.csrfToken
        memoryCache.csrfExpiry = now + 600000
        return memoryCache.csrfToken
      }
    }
  } catch {}
  return memoryCache.csrfToken || ''
}

function generateFFSecurityToken(uid) {
  const secret = "GAMESKINBOFFIDCHECKERSECURITYPROTOCOL"
  const nowMs = Date.now()
  const timeWindow = String(Math.floor(nowMs / 30000))
  const h1 = crypto.createHmac('sha256', secret).update(timeWindow).digest('hex').substring(0, 32)
  const msg = `${uid}|${nowMs}`
  const h2 = crypto.createHmac('sha256', h1).update(msg).digest('hex')
  return Buffer.from(`${uid}|${nowMs}|${h2}`).toString('base64')
}

function parseJsonArray(val) {
  if (!val) return []
  if (Array.isArray(val)) return val
  try { return JSON.parse(val) } catch { return [] }
}

const SERVERS = {
  "ID": "Indonesia", "IND": "India", "BD": "Bangladesh", "PK": "Pakistan",
  "SG": "Singapore", "TH": "Thailand", "VN": "Vietnam", "TW": "Taiwan",
  "BR": "Brazil", "NA": "North America", "EU": "Europe", "ME": "Middle East"
}

const PRICE_OVERRIDES = {
  "55558144": 120000000, "307866057": 536369400, "105581609": 499335858,
  "154894722": 137482349, "1761555079": 125489159, "1155847976": 390600000
}

function getPrimePrice(primeLevel) {
  const basePrices = { 1: 12600, 2: 126000, 3: 378000, 4: 1260000, 5: 3780000, 6: 7560000, 7: 15120000 }
  if (primeLevel >= 8) return 25200000
  return basePrices[primeLevel] || 50000
}

function hitungEstimasiHarga(basic, uid) {
  if (PRICE_OVERRIDES[uid]) return PRICE_OVERRIDES[uid]
  let price = 0
  const prime = basic.primeInfo?.primeLevel || basic.primeLevel || 0
  if (prime > 0) price = getPrimePrice(prime)
  price += (basic.liked || basic.likes || 0) * 12
  price += (basic.level || 0) * 8500
  return Math.floor(price / 1000) * 1000
}

function formatDate(timestamp) {
  if (!timestamp) return "-"
  const date = new Date(parseInt(timestamp, 10) * 1000)
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-"
  const date = new Date(parseInt(timestamp, 10) * 1000)
  return date.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function fetchAdenpedia(uid) {
  try {
    const res = await fetch(`${ADENPEDIA_URL}${uid}`, {
      headers: { 'User-Agent': BASE_HEADERS['User-Agent'], 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    logger.warn(`[FF Unified] Adenpedia fetch failed: ${e.message}`)
    return null
  }
}

async function fetchGameskinbo(uid, csrfToken) {
  const securityToken = generateFFSecurityToken(uid)
  const url = `https://gameskinbo.com/api/ff_id_checker?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(securityToken)}`
  try {
    const headers = { ...BASE_HEADERS }
    if (csrfToken) headers['x-csrf-token'] = csrfToken
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (e) {
    logger.warn(`[FF Unified] Gameskinbo fetch failed: ${e.message}`)
    return null
  }
}

function formatUnifiedResponse(adenData, gsData, uid) {
  const basic = adenData?.basicInfo || gsData?.account || {}
  const profile = adenData?.profileInfo || {}
  const clan = adenData?.clanBasicInfo || {}
  const captain = adenData?.captainBasicInfo || {}
  const pet = adenData?.petInfo || {}
  const social = adenData?.socialInfo || {}
  const credit = adenData?.creditScoreInfo || {}
  const diamond = adenData?.diamondCostRes || {}
  const petGs = gsData?.pet || {}
  const guildGs = gsData?.guild || {}

  const regionCode = basic.region || basic.regionCode || "ID"
  const regionName = `${SERVERS[regionCode] || regionCode} (${regionCode})`
  const primeLevel = basic.primeInfo?.primeLevel || basic.primeLevel || 0
  const estimasiHarga = hitungEstimasiHarga(basic, uid)
  const lastLoginAt = basic.lastLoginAt || basic.last_login_at || 0
  const createAt = basic.createAt || basic.createdAt || basic.create_at || 0

  // Banner URL from gameskinbo
  const bannerUrl = gsData?.account?.banner_direct_url || `https://gameskinbo.com/api/banner/banner_${uid}.webp`

  return {
    status: "success",
    uid: uid,
    nickname: basic.nickname || gsData?.account?.name || "-",
    server: regionName,
    level: basic.level || gsData?.account?.level || 0,
    exp: basic.exp || gsData?.account?.exp || 0,
    likes: basic.liked || basic.likes || gsData?.account?.likes || 0,
    rank_br: {
      tier_id: basic.rank || gsData?.ranked?.br_max_rank || 0,
      points: basic.rankingPoints || gsData?.ranked?.br_rank_points || 0,
      max_rank: basic.maxRank || gsData?.ranked?.br_max_rank || 0,
      show_rank: basic.showBrRank || gsData?.ranked?.show_br_rank || false
    },
    rank_cs: {
      tier_id: basic.csRank || gsData?.ranked?.cs_max_rank || 0,
      points: basic.csRankingPoints || gsData?.ranked?.cs_rank_points || 0,
      max_rank: basic.csMaxRank || gsData?.ranked?.cs_max_rank || 0,
      show_rank: basic.showCsRank || gsData?.ranked?.show_cs_rank || false
    },
    booyah_pass: {
      aktif: Boolean(basic.hasElitePass || gsData?.equipped?.booyah_pass_id),
      badge_count: basic.badgeCnt || basic.badge_count || gsData?.equipped?.booyah_pass_badges || 0,
      badge_id: basic.badgeId || basic.badge_id || gsData?.equipped?.booyah_pass_id || 0,
      season_id: basic.seasonId || gsData?.ranked?.season_id || 0
    },
    prime_level: primeLevel,
    title_id: basic.title || basic.title_id || gsData?.account?.title_id || 0,
    game_version: basic.releaseVersion || gsData?.account?.game_version || "OB54",
    language: social.language || gsData?.account?.language || "Language_INDONESIAN",
    preferred_mode: social.modePrefer || gsData?.account?.preferred_mode || "ModePrefer_BR",
    gender: social.gender || "Unknown",
    credit_score: credit.creditScore ?? gsData?.account?.credit_score ?? 100,
    diamond_cost: diamond.diamondCost || 0,
    estimasi_harga: {
      nominal: estimasiHarga,
      format_rupiah: `Rp ${estimasiHarga.toLocaleString('id-ID')}`
    },
    dibuat_pada: formatDate(createAt),
    terakhir_login: formatDateTime(lastLoginAt),
    loadout: {
      avatar_id: profile.avatarId || gsData?.equipped?.avatar_id || 0,
      skin_color: profile.skinColor || 0,
      clothes_ids: profile.clothes || gsData?.equipped?.outfits || [],
      skills: profile.equipedSkills || gsData?.equipped?.skills || [],
      weapon_skins: basic.weaponSkinShows || gsData?.equipped?.lobby_weapons || []
    },
    guild: {
      id: clan.clanId || guildGs.guild_id || "-",
      nama: clan.clanName || guildGs.guild_name || "-",
      level: clan.clanLevel || guildGs.guild_level || "-",
      anggota: clan.memberNum && clan.capacity
        ? `${clan.memberNum}/${clan.capacity}`
        : (guildGs.members_count && guildGs.capacity ? `${guildGs.members_count}/${guildGs.capacity}` : "-"),
      captain_nickname: captain.nickname || (guildGs.leader?.name || "-"),
      banner_url: bannerUrl
    },
    pet: {
      id: pet.id || petGs.pet_id || "-",
      nama: pet.name || petGs.name || "-",
      level: pet.level || petGs.level || "-",
      exp: pet.exp || petGs.exp || 0,
      skin_id: pet.skinId || petGs.skin_id || "-",
      skill_id: pet.selectedSkillId || petGs.skill_id || "-"
    },
    bio: social.signature || gsData?.account?.signature || "-",
    credit_score: credit.creditScore ?? gsData?.account?.credit_score ?? 100,
    diamond_cost: diamond.diamondCost || 0,
    estimasi_harga: {
      nominal: estimasiHarga,
      format_rupiah: `Rp ${estimasiHarga.toLocaleString('id-ID')}`
    },
    client_version: basic.releaseVersion || gsData?.account?.game_version || "OB54",
    raw_sources: {
      adenpedia: adenData ? "success" : "failed",
      gameskinbo: gsData ? "success" : "failed"
    }
  }
}

export default {
  name: "Free Fire Stalker (Unified)",
  description: "Stalker Free Fire gabungan data - lengkap dengan estimasi harga, banner URL, guild leader detail, pet name, credit score, dll",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["uid"],
  paramsSchema: {
    uid: { type: "string", required: true, description: "Free Fire UID (9-10 digit)", example: "4668586613" }
  },
  async run(req, res) {
    const startTime = Date.now()
    try {
      const { uid } = { ...req.query, ...req.body }
      if (!uid || !/^\d{8,10}$/.test(uid)) {
        return res.status(400).json({ status: false, error: "Parameter 'uid' wajib 8-10 digit angka" })
      }

      const [csrfToken, adenData, gsData] = await Promise.allSettled([
        getCachedCsrfToken(),
        fetchAdenpedia(uid),
        (async () => { const t = await getCachedCsrfToken(); return fetchGameskinbo(uid, t) })()
      ])

      const adenResult = adenData.status === 'fulfilled' ? adenData.value : null
      const gsResult = gsData.status === 'fulfilled' ? gsData.value : null

      if (!adenResult && !gsResult) {
        return res.status(404).json({ status: false, error: "Akun tidak ditemukan di kedua sumber" })
      }

      const result = formatUnifiedResponse(
        adenResult?.basicInfo ? adenResult : null,
        gsResult?.uid ? gsResult : null,
        uid
      )

      return res.json({
        status: true,
        result,
        timestamp: new Date().toISOString()
      })

    } catch (err) {
      logger.error(`[FF Unified] Error: ${err.message}`)
      return res.status(500).json({ status: false, error: err.message })
    }
  }
}