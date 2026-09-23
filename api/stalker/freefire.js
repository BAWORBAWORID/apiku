import fetch from 'node-fetch'
import logger from "../../src/utils/logger.js"

const BASE_URL = 'https://adenpedia.my.id/update01'
const API_ENDPOINT = 'info.php'

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://adenpedia.my.id/update01/',
  'Origin': 'https://adenpedia.my.id',
  'Accept': 'application/json'
}

const SERVER_NAMES = {
  "ID": "Indonesia", "IND": "India", "BD": "Bangladesh", "PK": "Pakistan",
  "SG": "Singapore", "TH": "Thailand", "VN": "Vietnam", "TW": "Taiwan",
  "BR": "Brazil", "NA": "North America", "EU": "Europe", "ME": "Middle East"
}

const BR_RANK_MAP = {
  1000: ["Bronze I", 1], 1100: ["Bronze II", 2], 1200: ["Bronze III", 3],
  1310: ["Silver I", 4], 1410: ["Silver II", 5], 1600: ["Silver III", 6],
  1610: ["Gold I", 7], 1735: ["Gold II", 8], 1860: ["Gold III", 9], 1985: ["Gold IV", 10],
  2110: ["Platinum I", 11], 2235: ["Platinum II", 12], 2360: ["Platinum III", 13],
  2485: ["Platinum IV", 14], 2610: ["Platinum V", 15],
  2760: ["Diamond I", 16], 2910: ["Diamond II", 17], 3060: ["Diamond III", 18],
  3210: ["Diamond IV", 19], 3350: ["Diamond V", 20],
  3510: ["Heroic I", 21], 3670: ["Heroic II", 22], 3830: ["Heroic III", 23],
  3990: ["Heroic IV", 24], 4150: ["Heroic V", 25],
  4320: ["Master I", 26], 4490: ["Master II", 27], 4660: ["Master III", 28],
  4830: ["Master IV", 29], 5000: ["Master V", 30],
  5200: ["Grandmaster I", 31], 5400: ["Grandmaster II", 32], 5600: ["Grandmaster III", 33],
  5800: ["Grandmaster IV", 34], 6000: ["Grandmaster V", 35]
}

const CS_RANK_MAP = {
  0: ["None", 0],
  100: ["Bronze I", 1], 110: ["Bronze II", 2], 120: ["Bronze III", 3], 130: ["Bronze IV", 4],
  140: ["Silver I", 5], 150: ["Silver II", 6], 160: ["Silver III", 7], 170: ["Silver IV", 8],
  180: ["Gold I", 9], 190: ["Gold II", 10], 200: ["Gold III", 11], 210: ["Gold IV", 12],
  220: ["Platinum I", 13], 230: ["Platinum II", 14], 240: ["Platinum III", 15], 250: ["Platinum IV", 16],
  260: ["Diamond I", 17], 270: ["Diamond II", 18], 280: ["Diamond III", 19], 290: ["Diamond IV", 20],
  300: ["Heroic", 21], 310: ["Grandmaster", 22], 320: ["Master", 23]
}

const PRIME_CONFIG = {
  PRICE_PER_POINT: 128,
  PRICE_PER_DIAMOND: 126,
  BOOYAH_DIAMONDS_PER_LEVEL: 20,
  PRIME_LEVELS: { 1: 100, 2: 1000, 3: 3000, 4: 10000, 5: 30000, 6: 60000, 7: 120000, 8: 200000 }
}

function getBrRank(points) {
  let rankName = "Bronze I", rankId = 1
  for (const [threshold, [name, id]] of Object.entries(BR_RANK_MAP).reverse()) {
    if (points >= Number(threshold)) { rankName = name; rankId = id; break }
  }
  return { name: rankName, id: rankId, points }
}

function getCsRank(csRank, csPoints) {
  let rankName = "None", rankId = 0, star = 0
  for (const [threshold, [name, id]] of Object.entries(CS_RANK_MAP).reverse()) {
    if (csRank >= Number(threshold)) { rankName = name; rankId = id; break }
  }
  if (rankId >= 1 && rankId <= 20) star = ((csRank - 100) % 10) + 1
  return { name: rankName, id: rankId, star, points: csPoints }
}

function formatFullDate(ts) {
  if (!ts) return null
  return new Date(ts * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatLastLogin(ts) {
  if (!ts) return null
  const d = new Date(ts * 1000)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return `${diff} detik lalu`
  if (diff < 3600) return `${Math.floor(diff/60)} menit lalu`
  if (diff < 86400) return `${Math.floor(diff/3600)} jam lalu`
  if (diff < 2592000) return `${Math.floor(diff/86400)} hari lalu`
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function rupiah(n) {
  return "Rp" + Number(n).toLocaleString("id-ID")
}

function calcPrimePrice(primeLevel, primePoints) {
  const price = {
    primeLevel: null,
    primePoints: null,
    booyahPass: null
  }
  
  // 1. Prime Level price (diamonds * 126)
  if (primeLevel && primeLevel >= 1 && primeLevel <= 8) {
    const diamonds = PRIME_CONFIG.PRIME_LEVELS[primeLevel]
    price.primeLevel = {
      level: primeLevel,
      diamonds: diamonds,
      ratePerDiamond: PRIME_CONFIG.PRICE_PER_DIAMOND,
      total: diamonds * PRIME_CONFIG.PRICE_PER_DIAMOND,
      totalFormatted: rupiah(diamonds * PRIME_CONFIG.PRICE_PER_DIAMOND)
    }
  }
  
  // 2. Prime Points price (points * 128)
  if (primePoints && primePoints > 0) {
    price.primePoints = {
      points: primePoints,
      ratePerPoint: PRIME_CONFIG.PRICE_PER_POINT,
      total: primePoints * PRIME_CONFIG.PRICE_PER_POINT,
      totalFormatted: rupiah(primePoints * PRIME_CONFIG.PRICE_PER_POINT)
    }
  }
  
  // 3. Booyah Pass estimation (if has elite pass, estimate from prime points or use prime level diamonds)
  // Use primePoints if available, else estimate from primeLevel diamonds
  let estimatedDiamonds = 0
  if (primePoints && primePoints > 0) {
    // Estimate diamonds equivalent from points (rough conversion)
    estimatedDiamonds = Math.floor(primePoints * (PRIME_CONFIG.PRICE_PER_POINT / PRIME_CONFIG.PRICE_PER_DIAMOND))
  } else if (primeLevel && primeLevel >= 1 && primeLevel <= 8) {
    estimatedDiamonds = PRIME_CONFIG.PRIME_LEVELS[primeLevel]
  }
  
  if (estimatedDiamonds > 0) {
    price.booyahPass = {
      estimatedDiamonds: estimatedDiamonds,
      diamondsPerLevel: PRIME_CONFIG.BOOYAH_DIAMONDS_PER_LEVEL,
      estimatedLevels: Math.floor(estimatedDiamonds / PRIME_CONFIG.BOOYAH_DIAMONDS_PER_LEVEL),
      ratePerDiamond: PRIME_CONFIG.PRICE_PER_DIAMOND,
      total: estimatedDiamonds * PRIME_CONFIG.PRICE_PER_DIAMOND,
      totalFormatted: rupiah(estimatedDiamonds * PRIME_CONFIG.PRICE_PER_DIAMOND)
    }
  }
  
  return price
}

export default {
  name: "Free Fire Stalker",
  description: "Cek info akun Free Fire via UID + Prime Price Calculator",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["uid"],
  paramsSchema: {
    uid: { type: "string", required: true, description: "Free Fire UID (8-11 digit)", example: "1234567890", minLength: 8, maxLength: 11, pattern: "^\\d+$" }
  },
  async run(req, res) {
    const { uid } = { ...req.query, ...req.body }
    
    if (!uid || !/^\d{8,11}$/.test(uid)) {
      return res.status(400).json({ 
        status: false, 
        error: "UID tidak valid (harus 8-11 digit angka)",
        example: "1234567890"
      })
    }

    try {
      const url = `${BASE_URL}/${API_ENDPOINT}?uid=${encodeURIComponent(uid)}`
      const response = await fetch(url, { 
        headers: BASE_HEADERS, 
        signal: AbortSignal.timeout(20000) 
      })
      
      if (!response.ok) {
        throw new Error(`Upstream HTTP ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.error) {
        return res.status(404).json({ status: false, error: data.error })
      }
      
      const basic = data.basicInfo || {}
      const clan = data.clanBasicInfo || {}
      const profile = data.profileInfo || {}
      const pet = data.petInfo || {}
      const prime = basic.primeInfo || {}
      const credit = data.creditScoreInfo || {}
      
      if (!basic.nickname) {
        return res.status(404).json({ status: false, error: "Data tidak ditemukan / UID tidak valid" })
      }
      
      const region = basic.region || "ID"
      const serverName = SERVER_NAMES[region] || region
      const brRank = getBrRank(basic.rankingPoints || 0)
      const csRank = getCsRank(basic.csRank || 0, basic.csRankingPoints || 0)
      
      // Calculate prime prices
      const primePrice = calcPrimePrice(prime.primeLevel || 0, prime.primePoints || 0)
      
      const result = {
        uid: uid,
        nickname: basic.nickname,
        region: region,
        server: serverName,
        level: basic.level || 0,
        exp: basic.exp || 0,
        likes: basic.liked || 0,
        rank: basic.rank || 0,
        rankName: brRank.name,
        rankId: brRank.id,
        rankingPoints: basic.rankingPoints || 0,
        csRank: basic.csRank || 0,
        csRankName: csRank.name,
        csRankId: csRank.id,
        csRankingPoints: basic.csRankingPoints || 0,
        csStar: csRank.star,
        primeLevel: prime.primeLevel || 0,
        primePoints: prime.primePoints || 0,
        createdAt: basic.createAt ? formatFullDate(basic.createAt) : null,
        lastLoginAt: basic.lastLoginAt ? formatLastLogin(basic.lastLoginAt) : null,
        avatar: basic.headPic ? `https://ff.garena.com/avatar/${basic.headPic}` : null,
        banner: basic.bannerId ? `https://ff.garena.com/banner/${basic.bannerId}` : null,
        badgeCnt: basic.badgeCnt || 0,
        creditScore: credit.creditScore || basic.creditScore || 100,
        hasElitePass: basic.hasElitePass || false,
        guild: clan.clanName ? {
          name: clan.clanName,
          id: clan.clanId || null,
          level: clan.clanLevel || 0,
          memberNum: clan.memberNum || 0,
          leader: clan.leaderName || null
        } : null,
        pet: pet.petName ? {
          name: pet.petName,
          id: pet.petId || null,
          level: pet.petLevel || 0,
          exp: pet.petExp || 0
        } : null,
        social: profile.signature ? { signature: profile.signature } : null,
        // NEW: Prime Price Calculator
        primePrice: {
          primeLevel: primePrice.primeLevel,
          primePoints: primePrice.primePoints,
          booyahPass: primePrice.booyahPass
        }
      }
      
      return res.json({
        status: true,
        result,
        timestamp: new Date().toISOString()
      })
      
    } catch (e) {
      logger.error(`[FF Stalker] Error for UID ${uid}: ${e.message}`)
      return res.status(500).json({ 
        status: false, 
        error: "Gagal mengambil data dari sumber",
        detail: e.message 
      })
    }
  }
}
