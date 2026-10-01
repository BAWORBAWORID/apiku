import crypto from 'node:crypto'
import logger from '../../src/utils/logger.js'

const FF_BASE_URL = 'https://freefire.my.id'
const ADEN_BASE_URL = 'https://adenpedia.my.id/update01'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const SERVER_NAMES = {
  ID: 'Indonesia',
  IND: 'India',
  BD: 'Bangladesh',
  PK: 'Pakistan',
  SG: 'Singapore',
  TH: 'Thailand',
  VN: 'Vietnam',
  TW: 'Taiwan',
  BR: 'Brazil',
  NA: 'North America',
  EU: 'Europe',
  ME: 'Middle East',
}

const BR_RANK_MAP = {
  1000: ['Bronze I', 1],
  1100: ['Bronze II', 2],
  1200: ['Bronze III', 3],
  1310: ['Silver I', 4],
  1410: ['Silver II', 5],
  1600: ['Silver III', 6],
  1610: ['Gold I', 7],
  1735: ['Gold II', 8],
  1860: ['Gold III', 9],
  1985: ['Gold IV', 10],
  2110: ['Platinum I', 11],
  2235: ['Platinum II', 12],
  2360: ['Platinum III', 13],
  2485: ['Platinum IV', 14],
  2610: ['Platinum V', 15],
  2760: ['Diamond I', 16],
  2910: ['Diamond II', 17],
  3060: ['Diamond III', 18],
  3210: ['Diamond IV', 19],
  3350: ['Diamond V', 20],
  3510: ['Heroic I', 21],
  3670: ['Heroic II', 22],
  3830: ['Heroic III', 23],
  3990: ['Heroic IV', 24],
  4150: ['Heroic V', 25],
  4320: ['Master I', 26],
  4490: ['Master II', 27],
  4660: ['Master III', 28],
  4830: ['Master IV', 29],
  5000: ['Master V', 30],
  5200: ['Grandmaster I', 31],
  5400: ['Grandmaster II', 32],
  5600: ['Grandmaster III', 33],
  5800: ['Grandmaster IV', 34],
  6000: ['Grandmaster V', 35],
}

const CS_RANK_MAP = {
  0: ['None', 0],
  100: ['Bronze I', 1],
  110: ['Bronze II', 2],
  120: ['Bronze III', 3],
  130: ['Bronze IV', 4],
  140: ['Silver I', 5],
  150: ['Silver II', 6],
  160: ['Silver III', 7],
  170: ['Silver IV', 8],
  180: ['Gold I', 9],
  190: ['Gold II', 10],
  200: ['Gold III', 11],
  210: ['Gold IV', 12],
  220: ['Platinum I', 13],
  230: ['Platinum II', 14],
  240: ['Platinum III', 15],
  250: ['Platinum IV', 16],
  260: ['Diamond I', 17],
  270: ['Diamond II', 18],
  280: ['Diamond III', 19],
  290: ['Diamond IV', 20],
  300: ['Heroic', 21],
  310: ['Grandmaster', 22],
  320: ['Master', 23],
}

const PRIME_CONFIG = {
  PRICE_PER_POINT: 128,
  PRICE_PER_DIAMOND: 126,
  BOOYAH_DIAMONDS_PER_LEVEL: 20,
  PRIME_LEVELS: {
    1: 100,
    2: 1000,
    3: 3000,
    4: 10000,
    5: 30000,
    6: 60000,
    7: 120000,
    8: 200000,
  },
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex')
}

function solvePow(challenge, difficulty) {
  const prefix = '0'.repeat(difficulty)
  for (let t = 0; ; t++) {
    const pow = t.toString(36)
    if (sha256(`${challenge}:${pow}`).startsWith(prefix)) {
      return pow
    }
  }
}

async function getChallengeToken(referer = FF_BASE_URL) {
  const res = await fetch(`${FF_BASE_URL}/api/token`, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: referer,
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    throw new Error(`Gagal mengambil challenge token: HTTP ${res.status}`)
  }

  return await res.json()
}

async function getAuthHeaders(apiPath, referer = FF_BASE_URL) {
  const { token, challenge, difficulty } = await getChallengeToken(referer)
  const pow = solvePow(challenge, difficulty)
  const sig = sha256(`${token}|${apiPath}|${pow}`)

  return {
    'x-fp-token': token,
    'x-fp-pow': pow,
    'x-fp-sig': sig,
    'User-Agent': DEFAULT_UA,
    Referer: referer,
  }
}

function getBrRank(points) {
  let rankName = 'Bronze I'
  let rankId = 1
  for (const [threshold, [name, id]] of Object.entries(BR_RANK_MAP).reverse()) {
    if (points >= Number(threshold)) {
      rankName = name
      rankId = id
      break
    }
  }
  return { name: rankName, id: rankId, points }
}

function getCsRank(csRank, csPoints = 0) {
  let rankName = 'None'
  let rankId = 0
  let star = 0
  for (const [threshold, [name, id]] of Object.entries(CS_RANK_MAP).reverse()) {
    if (csRank >= Number(threshold)) {
      rankName = name
      rankId = id
      break
    }
  }
  if (rankId >= 1 && rankId <= 20) star = ((csRank - 100) % 10) + 1
  return { name: rankName, id: rankId, star, points: csPoints }
}

function formatFullDate(ts) {
  if (!ts || ts === '0' || Number(ts) === 0) return null
  const num = Number(ts)
  const date = new Date(num > 1e11 ? num : num * 1000)
  if (isNaN(date.getTime())) return null
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatIsoDate(ts) {
  if (!ts || ts === '0' || Number(ts) === 0) return null
  const num = Number(ts)
  const date = new Date(num > 1e11 ? num : num * 1000)
  if (isNaN(date.getTime())) return null
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function formatLastLogin(ts) {
  if (!ts || ts === '0' || Number(ts) === 0) return null
  const num = Number(ts)
  const d = new Date(num > 1e11 ? num : num * 1000)
  if (isNaN(d.getTime())) return null
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return `${diff} detik lalu`
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} hari lalu`
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function rupiah(n) {
  return 'Rp' + Number(n).toLocaleString('id-ID')
}

function calcPrimePrice(primeLevel, primePoints = 0) {
  const price = {
    primeLevel: null,
    primePoints: null,
    booyahPass: null,
  }

  if (primeLevel && primeLevel >= 1 && primeLevel <= 8) {
    const diamonds = PRIME_CONFIG.PRIME_LEVELS[primeLevel]
    price.primeLevel = {
      level: primeLevel,
      diamonds: diamonds,
      ratePerDiamond: PRIME_CONFIG.PRICE_PER_DIAMOND,
      total: diamonds * PRIME_CONFIG.PRICE_PER_DIAMOND,
      totalFormatted: rupiah(diamonds * PRIME_CONFIG.PRICE_PER_DIAMOND),
    }
  }

  if (primePoints && primePoints > 0) {
    price.primePoints = {
      points: primePoints,
      ratePerPoint: PRIME_CONFIG.PRICE_PER_POINT,
      total: primePoints * PRIME_CONFIG.PRICE_PER_POINT,
      totalFormatted: rupiah(primePoints * PRIME_CONFIG.PRICE_PER_POINT),
    }
  }

  let estimatedDiamonds = 0
  if (primePoints && primePoints > 0) {
    estimatedDiamonds = Math.floor(
      primePoints * (PRIME_CONFIG.PRICE_PER_POINT / PRIME_CONFIG.PRICE_PER_DIAMOND)
    )
  } else if (primeLevel && primeLevel >= 1 && primeLevel <= 8) {
    estimatedDiamonds = PRIME_CONFIG.PRIME_LEVELS[primeLevel]
  }

  if (estimatedDiamonds > 0) {
    price.booyahPass = {
      estimatedDiamonds: estimatedDiamonds,
      diamondsPerLevel: PRIME_CONFIG.BOOYAH_DIAMONDS_PER_LEVEL,
      estimatedLevels: Math.floor(
        estimatedDiamonds / PRIME_CONFIG.BOOYAH_DIAMONDS_PER_LEVEL
      ),
      ratePerDiamond: PRIME_CONFIG.PRICE_PER_DIAMOND,
      total: estimatedDiamonds * PRIME_CONFIG.PRICE_PER_DIAMOND,
      totalFormatted: rupiah(estimatedDiamonds * PRIME_CONFIG.PRICE_PER_DIAMOND),
    }
  }

  return price
}

/**
 * Fetch profile directly from primary engine (freefire.my.id)
 */
async function fetchPrimaryFF(uid) {
  const apiPath = '/api/ff'
  const referer = `${FF_BASE_URL}/stalk/${uid}`
  const headers = await getAuthHeaders(apiPath, referer)

  const res = await fetch(`${FF_BASE_URL}${apiPath}?uid=${encodeURIComponent(uid)}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  })

  const json = await res.json().catch(() => null)

  if (res.status === 404 || (json && json.error && !json.player)) {
    return {
      notFound: true,
      error: json?.error || 'Player tidak ditemukan.',
    }
  }

  if (!res.ok || !json?.player) {
    throw new Error(json?.error || `Primary HTTP ${res.status}`)
  }

  return { notFound: false, data: json }
}

/**
 * Fallback to secondary source (adenpedia) if primary engine is unavailable
 */
async function fetchFallbackFF(uid) {
  const url = `${ADEN_BASE_URL}/info.php?uid=${encodeURIComponent(uid)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: `${ADEN_BASE_URL}/`,
      Origin: 'https://adenpedia.my.id',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`)
  const json = await res.json()

  if (json.error || !json.basicInfo?.nickname) {
    return {
      notFound: true,
      error: json.error || 'Player tidak ditemukan / UID tidak valid',
    }
  }

  return { notFound: false, data: json }
}

export default {
  name: 'Free Fire Stalker',
  description:
    'Cek info lengkap akun Free Fire via UID (Level, Rank, Banned status, Pet, Outfit, Character, & Prime Price Calculator)',
  category: 'Stalker',
  methods: ['GET', 'POST'],
  params: ['uid'],
  paramsSchema: {
    uid: {
      type: 'string',
      required: true,
      description: 'Free Fire UID (8-11 digit angka)',
      example: '1531107934',
      minLength: 8,
      maxLength: 11,
      pattern: '^\\d+$',
    },
  },

  async run(req, res) {
    const { uid } = { ...req.query, ...req.body }

    if (!uid || !/^\d{8,11}$/.test(String(uid).trim())) {
      return res.status(400).json({
        status: false,
        error: 'UID tidak valid (harus 8-11 digit angka)',
        example: '1531107934',
      })
    }

    const cleanUid = String(uid).trim()

    try {
      let rawResult = null
      let source = 'freefirestalk'

      try {
        const primary = await fetchPrimaryFF(cleanUid)
        if (primary.notFound) {
          return res.status(404).json({ status: false, error: primary.error })
        }
        rawResult = primary.data
      } catch (primaryErr) {
        logger.warn(
          `[FF Stalker] Primary engine error (${primaryErr.message}), trying fallback...`
        )
        const fallback = await fetchFallbackFF(cleanUid)
        if (fallback.notFound) {
          return res.status(404).json({ status: false, error: fallback.error })
        }
        rawResult = fallback.data
        source = 'adenpedia'
      }

      let result = null

      if (source === 'freefirestalk') {
        const player = rawResult.player || {}
        const guildData = rawResult.guild || {}
        const petData = rawResult.pet || {}
        const socialData = rawResult.social || {}
        const banData = rawResult.ban || {}
        const creditData = rawResult.credit || {}

        const region = player.region || 'ID'
        const serverName = SERVER_NAMES[region] || region
        const rankingPoints = player.rankingPoints ?? 0
        const brRank = getBrRank(rankingPoints)
        const csRank = getCsRank(player.csRank || 0, 0)
        const primeLevel = player.primeInfo?.primeLevel || 0
        const primePrice = calcPrimePrice(primeLevel, 0)

        const hasGuild = Boolean(guildData.guildName || guildData.guildId)
        const hasPet = Boolean(petData.name || petData.id || petData.speciesName)
        const signature = socialData.signature || null

        result = {
          uid: cleanUid,
          nickname: player.nickname || null,
          region: region,
          server: serverName,
          level: player.level || 0,
          exp: player.exp || 0,
          likes: player.liked || 0,
          rank: player.rank || 0,
          rankName: brRank.name,
          rankId: brRank.id,
          rankingPoints: rankingPoints,
          csRank: player.csRank || 0,
          csRankName: csRank.name,
          csRankId: csRank.id,
          hasElitePass: Boolean(player.hasElitePass),
          createdAt: formatFullDate(player.createAt),
          createdAtFormatted: formatIsoDate(player.createAt),
          lastLoginAt: formatLastLogin(player.lastLoginAt),
          lastLoginAtFormatted: formatIsoDate(player.lastLoginAt),
          avatar: player.avatarUrl || player.equippedAvatar?.icon || null,
          banner: player.equippedBanner?.icon || null,
          equippedAvatar: player.equippedAvatar || null,
          equippedBanner: player.equippedBanner || null,
          equippedCharacter: player.equippedCharacter || null,
          equippedTitle: player.equippedTitle || null,
          equippedPin: player.equippedPin || null,
          equippedOutfitItems: player.equippedOutfitItems || [],
          equippedWeaponOutfitItems: player.equippedWeaponOutfitItems || [],
          equippedLookChangerItems: player.equippedLookChangerItems || [],
          equippedArrivalAnimationItems: player.equippedArrivalAnimationItems || [],
          guild: hasGuild
            ? {
                name: guildData.guildName || null,
                id: guildData.guildId || null,
                level: guildData.guildLevel || 0,
                memberNum: guildData.memberNum || 0,
                capacity: guildData.capacity || 0,
              }
            : null,
          pet: hasPet
            ? {
                id: petData.id || null,
                name: petData.name || null,
                speciesName: petData.speciesName || null,
                level: petData.level || 0,
                exp: petData.exp || 0,
                isSelected: Boolean(petData.isSelected),
                skinId: petData.skinId || null,
                skinName: petData.skinName || null,
                skinIconUrl: petData.skinIconUrl || null,
                selectedSkillId: petData.selectedSkillId || null,
                skillName: petData.skillName || null,
              }
            : null,
          social: signature ? { signature } : null,
          creditScore: creditData.creditScore ?? 100,
          ban: {
            isBanned: Boolean(banData.isBanned),
            status: banData.status || (banData.isBanned ? 'BANNED' : 'NOT BANNED'),
            banPeriod: banData.banPeriod ?? 0,
            lastLoginAt: banData.lastLoginAt ?? null,
          },
          primePrice: {
            primeLevel: primePrice.primeLevel,
            primePoints: primePrice.primePoints,
            booyahPass: primePrice.booyahPass,
          },
        }
      } else {
        // Fallback mapping with fixes
        const basic = rawResult.basicInfo || {}
        const clan = rawResult.clanBasicInfo || {}
        const pet = rawResult.petInfo || {}
        const social = rawResult.socialInfo || {}
        const prime = basic.primeInfo || {}
        const credit = rawResult.creditScoreInfo || {}

        const region = basic.region || 'ID'
        const serverName = SERVER_NAMES[region] || region
        const brRank = getBrRank(basic.rankingPoints || 0)
        const csRank = getCsRank(basic.csRank || 0, basic.csRankingPoints || 0)
        const primePrice = calcPrimePrice(prime.primeLevel || 0, prime.primePoints || 0)

        const hasPet = Boolean(pet.name || pet.id)
        const signature = social.signature || null

        result = {
          uid: cleanUid,
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
          hasElitePass: Boolean(basic.hasElitePass),
          createdAt: formatFullDate(basic.createAt),
          createdAtFormatted: formatIsoDate(basic.createAt),
          lastLoginAt: formatLastLogin(basic.lastLoginAt),
          lastLoginAtFormatted: formatIsoDate(basic.lastLoginAt),
          avatar: null,
          banner: null,
          equippedAvatar: basic.headPic ? { id: basic.headPic } : null,
          equippedBanner: basic.bannerId ? { id: basic.bannerId } : null,
          equippedCharacter: null,
          equippedTitle: null,
          equippedPin: null,
          equippedOutfitItems: [],
          equippedWeaponOutfitItems: [],
          equippedLookChangerItems: [],
          equippedArrivalAnimationItems: [],
          guild: clan.clanName
            ? {
                name: clan.clanName,
                id: clan.clanId || null,
                level: clan.clanLevel || 0,
                memberNum: clan.memberNum || 0,
                leader: clan.leaderName || null,
              }
            : null,
          pet: hasPet
            ? {
                id: pet.id || null,
                name: pet.name || null,
                speciesName: null,
                level: pet.level || 0,
                exp: pet.exp || 0,
                isSelected: Boolean(pet.isSelected),
                skinId: pet.skinId || null,
                skinName: null,
                skinIconUrl: null,
                selectedSkillId: pet.selectedSkillId || null,
                skillName: null,
              }
            : null,
          social: signature ? { signature } : null,
          creditScore: credit.creditScore || basic.creditScore || 100,
          ban: {
            isBanned: false,
            status: 'UNKNOWN',
            banPeriod: 0,
            lastLoginAt: null,
          },
          primePrice: {
            primeLevel: primePrice.primeLevel,
            primePoints: primePrice.primePoints,
            booyahPass: primePrice.booyahPass,
          },
        }
      }

      return res.json({
        status: true,
        result,
        timestamp: new Date().toISOString(),
      })
    } catch (e) {
      logger.error(`[FF Stalker] Error for UID ${cleanUid}: ${e.message}`)
      return res.status(500).json({
        status: false,
        error: 'Gagal mengambil data dari sumber',
        detail: e.message,
      })
    }
  },
}
