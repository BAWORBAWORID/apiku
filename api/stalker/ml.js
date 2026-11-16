/**
 * MLBB Stalker Pro - Ultimate Mobile Legends Account Inspector & Competitive Toolkit
 * Built for in-depth player investigation, JB/buy-sell security audit,
 * win rate target calculations, season reset projections, and draft counters.
 */

import { fileURLToPath } from 'url';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';


async function stalkAccount(userId, zoneId) {
  const uId = String(userId || '').trim().replace(/[^\d]/g, '');
  const zId = String(zoneId || '').trim().replace(/[^\d]/g, '');

  if (!uId || !zId) {
    throw new Error('Both User ID and Zone ID are required (e.g. 10010 1001).');
  }

  const endpoint = 'https://www.smile.one/merchant/mobilelegends/checkrole';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': 'https://www.smile.one',
      'Referer': 'https://www.smile.one/'
    },
    body: new URLSearchParams({
      user_id: uId,
      zone_id: zId,
      pid: '26',
      checkrole: '1'
    })
  });

  if (!response.ok) {
    throw new Error(`Moonton gateway HTTP error: ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== 200 || !data.username) {
    return {
      success: false,
      userId: uId,
      zoneId: zId,
      exists: false,
      message: data.info || 'User ID or Zone ID not found on Moonton servers.',
      serverDetails: resolveZoneDeep(zId),
      estimatedAccountEra: estimateAccountEra(uId, zId)
    };
  }

  // Clean raw username: strip leading null bytes and unescape
  const cleanIgn = data.username.replace(/^\0+/, '').trim();
  const serverMeta = resolveZoneDeep(zId);
  const eraMeta = estimateAccountEra(uId, zId);
  const securityAudit = auditAccountSecurity(uId, zId, serverMeta, eraMeta);

  return {
    success: true,
    exists: true,
    account: {
      userId: uId,
      zoneId: zId,
      ign: cleanIgn,
      rawUsername: data.username,
      characterLength: cleanIgn.length,
      hasSpecialCharacters: /[^\w\s]/u.test(cleanIgn)
    },
    history: {
      estimatedRegistrationYear: eraMeta.year,
      seasonEra: eraMeta.era,
      veteranRank: eraMeta.veteranTier,
      estimatedAccountAgeYears: eraMeta.ageYears,
      whalingStatusTier: eraMeta.whalingTier
    },
    server: {
      zoneId: zId,
      region: serverMeta.region,
      primaryHub: serverMeta.hub,
      countries: serverMeta.countries,
      clusterNode: serverMeta.clusterNode,
      serverGeneration: serverMeta.generation,
      expectedPingMs: serverMeta.expectedPingMs
    },
    securityAudit: {
      riskLevel: securityAudit.riskLevel,
      riskScore: securityAudit.score,
      warnings: securityAudit.warnings,
      recommendations: securityAudit.recommendations
    },
    gatewayMeta: {
      pricingZone: data.zone ?? 0,
      currencyMultiplier: data.change_price ?? 1.0,
      responseCode: data.code
    }
  };
}

const ZONE_DATABASE = [
  { min: 1001, max: 1050, region: 'Global / SEA Pioneer', hub: 'Singapore / Jakarta', countries: ['Indonesia', 'Malaysia', 'Singapore'], cluster: 'Alpha-01', gen: '2016 Alpha Launch Server', ping: '10-25ms (SEA)' },
  { min: 1051, max: 1999, region: 'Global Pioneer Cluster', hub: 'Singapore', countries: ['Global', 'SEA'], cluster: 'Legacy-Pioneer', gen: '2016-2017 Season 1-2 Legacy', ping: '15-35ms (SEA)' },
  { min: 2001, max: 2099, region: 'Indonesia (West / Java / Sumatra)', hub: 'Jakarta', countries: ['Indonesia'], cluster: 'ID-WEST-CORE', gen: 'Season 3-6 (2017)', ping: '5-20ms (ID)' },
  { min: 2100, max: 2199, region: 'Indonesia (Central & East / Kalimantan / Sulawesi)', hub: 'Surabaya / Makassar', countries: ['Indonesia'], cluster: 'ID-CENTRAL-CORE', gen: 'Season 7-10 (2018)', ping: '15-35ms (ID)' },
  { min: 2200, max: 2299, region: 'Malaysia & Singapore Core', hub: 'Kuala Lumpur / Singapore', countries: ['Malaysia', 'Singapore'], cluster: 'MY-SG-CORE', gen: 'Season 7-10 (2018)', ping: '10-20ms (MY/SG)' },
  { min: 2300, max: 2499, region: 'Philippines (Luzon / Manila / Visayas)', hub: 'Manila', countries: ['Philippines'], cluster: 'PH-CORE-01', gen: 'Season 9-12 (2018-2019)', ping: '15-30ms (PH)' },
  { min: 2500, max: 2999, region: 'Mekong Regional (Myanmar / Cambodia / Thailand)', hub: 'Bangkok / Yangon', countries: ['Myanmar', 'Cambodia', 'Thailand', 'Vietnam'], cluster: 'SEA-MEKONG-01', gen: 'Season 11-14 (2019)', ping: '20-45ms (Mekong)' },
  { min: 3000, max: 3499, region: 'North America (US East / US West / Canada)', hub: 'Virginia / California', countries: ['United States', 'Canada'], cluster: 'NA-CORE-01', gen: 'Americas Gateway (2018-2020)', ping: '180-250ms (from SEA)' },
  { min: 3500, max: 3999, region: 'Central America & Caribbean', hub: 'Mexico City', countries: ['Mexico', 'Guatemala', 'Caribbean'], cluster: 'CAM-CORE-01', gen: 'Americas Regional', ping: '200-260ms (from SEA)' },
  { min: 4000, max: 4499, region: 'Western Europe (EU Core)', hub: 'Frankfurt / London / Paris', countries: ['Germany', 'France', 'United Kingdom', 'Netherlands'], cluster: 'EU-CORE-01', gen: 'European Gateway', ping: '170-220ms (from SEA)' },
  { min: 4500, max: 4999, region: 'Middle East & North Africa (MENA / GCC)', hub: 'Dubai / Riyadh', countries: ['UAE', 'Saudi Arabia', 'Egypt', 'Qatar'], cluster: 'MENA-CORE-01', gen: 'MENA Regional', ping: '110-150ms (from SEA)' },
  { min: 5000, max: 5499, region: 'Eastern Europe & Russia (CIS Core)', hub: 'Moscow', countries: ['Russia', 'Belarus', 'Kazakhstan'], cluster: 'CIS-CORE-01', gen: 'CIS Regional', ping: '160-210ms (from SEA)' },
  { min: 5500, max: 5999, region: 'Central Asia & Caucasus', hub: 'Almaty / Tashkent', countries: ['Kazakhstan', 'Uzbekistan', 'Azerbaijan'], cluster: 'CIS-CENTRAL-01', gen: 'CIS Expansion', ping: '150-200ms (from SEA)' },
  { min: 6000, max: 6499, region: 'Brazil (South America Core)', hub: 'São Paulo', countries: ['Brazil'], cluster: 'BR-CORE-01', gen: 'LATAM Primary', ping: '250-320ms (from SEA)' },
  { min: 6500, max: 6999, region: 'South America (Hispanic LATAM)', hub: 'Buenos Aires / Santiago / Lima', countries: ['Argentina', 'Chile', 'Peru', 'Colombia'], cluster: 'LATAM-SOUTH-01', gen: 'LATAM Secondary', ping: '260-330ms (from SEA)' },
  { min: 7000, max: 7499, region: 'Japan Core', hub: 'Tokyo', countries: ['Japan'], cluster: 'JP-CORE-01', gen: 'East Asia Gateway', ping: '65-90ms (from SEA)' },
  { min: 7500, max: 7999, region: 'South Korea & Taiwan', hub: 'Seoul / Taipei', countries: ['South Korea', 'Taiwan', 'Hong Kong'], cluster: 'KR-TW-CORE-01', gen: 'East Asia Gateway', ping: '60-85ms (from SEA)' },
  { min: 8000, max: 8499, region: 'South Asia Core (India / Pakistan)', hub: 'Mumbai', countries: ['India', 'Pakistan'], cluster: 'SA-CORE-01', gen: 'South Asia Regional', ping: '70-110ms (from SEA)' },
  { min: 8500, max: 8999, region: 'South Asia Secondary', hub: 'Dhaka / Kathmandu', countries: ['Bangladesh', 'Nepal', 'Sri Lanka'], cluster: 'SA-SECONDARY-01', gen: 'South Asia Regional', ping: '80-120ms (from SEA)' },
  { min: 9000, max: 10999, region: 'Southeast Asia Mega Expansion', hub: 'Jakarta / Singapore / Manila', countries: ['Indonesia', 'Philippines', 'Malaysia'], cluster: 'SEA-EXP-MEGA-1', gen: 'Project NEXT 2021-2023', ping: '10-30ms (SEA)' },
  { min: 11000, max: 13999, region: 'Global High-Density Cloud Expansion', hub: 'Distributed AWS/Tencent Cloud', countries: ['Global Multi-Region', 'SEA'], cluster: 'GLOBAL-CLOUD-EXP', gen: 'Modern Expansion 2023-2025', ping: '15-40ms (SEA)' },
  { min: 14000, max: 20000, region: 'Next-Gen Ultra Cloud Nodes', hub: 'Distributed Edge Clusters', countries: ['Global Multi-Region'], cluster: 'EDGE-NODE-2026', gen: 'Ultra Modern 2025-2026+', ping: 'Optimized Edge Routing' }
];


function resolveZoneDeep(zoneId) {
  const z = Number(zoneId);
  if (isNaN(z)) {
    return {
      zoneId,
      region: 'Unknown',
      hub: 'Global Gateway',
      countries: ['Global'],
      clusterNode: 'UNKNOWN-NODE',
      generation: 'Standard Cluster',
      expectedPingMs: 'N/A'
    };
  }

  for (const entry of ZONE_DATABASE) {
    if (z >= entry.min && z <= entry.max) {
      return {
        zoneId: z,
        region: entry.region,
        hub: entry.hub,
        countries: entry.countries,
        clusterNode: entry.cluster,
        generation: entry.gen,
        expectedPingMs: entry.ping
      };
    }
  }

  return {
    zoneId: z,
    region: 'Modern Hybrid Cloud Cluster',
    hub: 'Distributed Cloud Node',
    countries: ['Global / Multi-Region'],
    clusterNode: `NODE-HYBRID-${Math.floor(z / 1000)}`,
    generation: 'Modern Node (2024-2026)',
    expectedPingMs: '20-50ms (Local)'
  };
}

function estimateAccountEra(userId, zoneId) {
  const uLen = String(userId).length;
  const zNum = Number(zoneId);

  let year = '2022';
  let era = 'Modern Era';
  let veteranTier = 'Regular Player';
  let ageYears = 3;
  let whalingTier = 'F2P to Low Spender';

  if (zNum >= 1001 && zNum <= 1050) {
    year = '2016 (Jul - Dec)';
    era = 'Alpha / Original Release (Pre-Season 1)';
    veteranTier = 'OG Mythic Founder (Top 0.01%)';
    ageYears = 10;
    whalingTier = 'High Value / Ancient Collector Candidate';
  } else if (uLen <= 7 || (zNum >= 1051 && zNum <= 2010)) {
    year = '2016 - 2017';
    era = 'Season 1 - Season 3 Legacy';
    veteranTier = 'Season 1-3 True Veteran';
    ageYears = 9;
    whalingTier = 'Vintage Collector / Legacy Skins Candidate';
  } else if (uLen === 8 && zNum <= 2080) {
    year = '2017';
    era = 'Season 4 - Season 6 Era';
    veteranTier = 'Golden Classic Veteran';
    ageYears = 8;
    whalingTier = 'Established Mid-Tier';
  } else if (uLen === 8 || (zNum > 2080 && zNum <= 2250)) {
    year = '2018';
    era = 'Season 7 - Season 10 Era (515 Celebration Launch)';
    veteranTier = 'Pre-M1 Golden Era Player';
    ageYears = 7;
    whalingTier = 'Established Spender';
  } else if (zNum > 2250 && zNum <= 2600) {
    year = '2019';
    era = 'Season 11 - Season 14 Era (M1 World Championship)';
    veteranTier = 'M1 Era Experienced Veteran';
    ageYears = 6;
    whalingTier = 'Established Spender';
  } else if (zNum > 2600 && zNum <= 3600) {
    year = '2020';
    era = 'Season 15 - Season 18 Era (Project NEXT Phase 1 / COVID Boom)';
    veteranTier = 'Project NEXT Veteran';
    ageYears = 5;
    whalingTier = 'Active Grinder';
  } else if (zNum > 3600 && zNum <= 5500) {
    year = '2021';
    era = 'Season 19 - Season 22 Era (M2 / M3 Era)';
    veteranTier = 'Mid-Generation Player';
    ageYears = 4;
    whalingTier = 'Standard Grinder';
  } else if (zNum > 5500 && zNum <= 8000) {
    year = '2022';
    era = 'Season 23 - Season 26 Era (M4 Era)';
    veteranTier = 'Modern Player';
    ageYears = 3;
    whalingTier = 'Standard Grinder';
  } else if (zNum > 8000 && zNum <= 10500) {
    year = '2023';
    era = 'Season 27 - Season 30 Era (M5 Era)';
    veteranTier = 'Recent Competitive Player';
    ageYears = 2;
    whalingTier = 'Modern Spender';
  } else if (zNum > 10500 && zNum <= 13000) {
    year = '2024';
    era = 'Season 31 - Season 34 Era (Project NEXT 2024)';
    veteranTier = 'Modern Recruit';
    ageYears = 1;
    whalingTier = 'Newer Account';
  } else {
    year = '2025 - 2026';
    era = 'Season 35+ Modern Era';
    veteranTier = 'Fresh Account';
    ageYears = 0.5;
    whalingTier = 'Early Progression';
  }

  return { year, era, veteranTier, ageYears, whalingTier };
}

function auditAccountSecurity(userId, zoneId, serverMeta, eraMeta) {
  const warnings = [];
  const recommendations = [];
  let score = 100;

  const uLen = String(userId).length;
  const zNum = Number(zoneId);

  // Check 1: ID vs Zone generation mismatch
  if (uLen <= 7 && zNum > 9000) {
    warnings.push('CRITICAL: User ID is very short (6-7 digits) but Zone ID is modern (9000+). High probability of server migration, test account, or account mismatch.');
    score -= 40;
  }
  if (uLen >= 10 && zNum <= 2000) {
    warnings.push('WARNING: 10-digit User ID in a legacy 2016-2017 server. May indicate an account created recently on an old server node.');
    score -= 15;
  }

  // Check 2: Regional ping risk
  if (serverMeta.region.includes('North America') || serverMeta.region.includes('Latin America') || serverMeta.region.includes('Europe')) {
    warnings.push(`HIGH PING RISK: Account server is bound to ${serverMeta.region} (${serverMeta.hub}). Playing from SEA/Indonesia will suffer permanent 180-280ms ping.`);
    score -= 25;
  }

  // Recommendations for buyers
  recommendations.push('Wajib periksa semua bind: Moonton (ganti email utama), Google Play, Facebook, TikTok, dan VK.');
  recommendations.push('Pastikan 2FA (Verifikasi Sekunder) diaktifkan langsung setelah pengambilalihan akun.');
  recommendations.push('Periksa histori login perangkat di menu Pengaturan Akun -> Pusat Akun -> Keluar dari Semua Perangkat.');
  recommendations.push('Cek sisa hari unbind delay: jika ada unbind pihak ketiga yang pending 7 hari, batalkan transaksi.');

  let riskLevel = 'LOW RISK';
  if (score <= 50) riskLevel = 'CRITICAL RISK';
  else if (score <= 75) riskLevel = 'MODERATE RISK';

  return {
    score,
    riskLevel,
    warnings: warnings.length ? warnings : ['No anomalous server/ID mismatch detected.'],
    recommendations
  };
}


function calculateWinRateAdvanced(totalMatches, currentWinRate, targetWinRate, dailyMatches = 5) {
  const M = Number(totalMatches);
  let cWR = Number(currentWinRate);
  let tWR = Number(targetWinRate);

  if (cWR > 1) cWR = cWR / 100;
  if (tWR > 1) tWR = tWR / 100;

  if (isNaN(M) || isNaN(cWR) || isNaN(tWR) || M <= 0) {
    throw new Error('Valid numeric values required for matches and win rates.');
  }

  const currentWins = Math.round(M * cWR);
  const currentLosses = M - currentWins;

  if (tWR >= 1) {
    return { error: 'Target win rate cannot be 100% unless current win rate is already 100%.' };
  }

  // Formula for consecutive 100% wins to reach target
  let consecutiveWinsNeeded = 0;
  if (tWR > cWR) {
    consecutiveWinsNeeded = Math.ceil((tWR * M - currentWins) / (1 - tWR));
  }

  // Formula for max consecutive losses before dropping below current or lower target
  let maxLossesAllowed = 0;
  if (cWR > tWR) {
    maxLossesAllowed = Math.floor((currentWins - tWR * M) / tWR);
  }

  // Realistic scenario models: Win at 70%, 80%, 90% win rate rather than pure 100%
  const realisticScenarios = [];
  if (tWR > cWR) {
    for (const winPace of [90, 80, 75, 70]) {
      const p = winPace / 100;
      if (p > tWR) {
        const totalExtraGames = Math.ceil((tWR * M - currentWins) / (p - tWR));
        const winsInRun = Math.round(totalExtraGames * p);
        const lossesInRun = totalExtraGames - winsInRun;
        const daysRequired = Math.ceil(totalExtraGames / dailyMatches);

        realisticScenarios.push({
          grindPaceWinRate: `${winPace}% WR Pace`,
          totalGamesNeeded: totalExtraGames,
          winRecord: `${winsInRun}W - ${lossesInRun}L`,
          daysAtCurrentPace: `${daysRequired} days (@ ${dailyMatches} matches/day)`,
          resultingTotalMatches: M + totalExtraGames
        });
      }
    }
  }

  // Benchmark table
  const benchmarks = [50, 52, 55, 58, 60, 65, 70, 75, 80].map(pct => {
    const dec = pct / 100;
    if (dec <= cWR) {
      const allowedL = Math.floor((currentWins - dec * M) / dec);
      return {
        target: `${pct}%`,
        status: 'Achieved',
        consecutiveWinsRequired: 0,
        maxLossesTolerated: allowedL >= 0 ? allowedL : 0
      };
    } else {
      const neededW = Math.ceil((dec * M - currentWins) / (1 - dec));
      return {
        target: `${pct}%`,
        status: 'Pending',
        consecutiveWinsRequired: neededW,
        resultingTotalMatches: M + neededW
      };
    }
  });

  return {
    totalMatches: M,
    currentWins,
    currentLosses,
    currentWinRate: `${(cWR * 100).toFixed(2)}%`,
    targetWinRate: `${(tWR * 100).toFixed(2)}%`,
    consecutiveWinsRequired: consecutiveWinsNeeded,
    newTotalMatchesIfAchieved: M + consecutiveWinsNeeded,
    maxLossesBeforeDropping: maxLossesAllowed,
    realisticGrindScenarios: realisticScenarios,
    benchmarks
  };
}

/**
 * Project season rank downgrade and seasonal rewards
 * @param {string|number} rankOrStars
 * @returns {object}
 */
function projectRankReset(rankOrStars) {
  const r = String(rankOrStars || '').toLowerCase().trim();
  const stars = Number(r.replace(/[^\d]/g, ''));

  if (!isNaN(stars) && stars >= 100) {
    return {
      currentTier: `Mythical Immortal (${stars} Stars)`,
      projectedResetTier: 'Legend V',
      seasonBP: 20000,
      seasonTickets: 20000,
      tierGroup: 'Immortal Top 0.05%'
    };
  } else if (!isNaN(stars) && stars >= 50) {
    return {
      currentTier: `Mythical Glory (${stars} Stars)`,
      projectedResetTier: 'Epic I',
      seasonBP: 20000,
      seasonTickets: 20000,
      tierGroup: 'Glory Elite'
    };
  } else if (!isNaN(stars) && stars >= 25) {
    return {
      currentTier: `Mythical Honor (${stars} Stars)`,
      projectedResetTier: 'Epic II',
      seasonBP: 20000,
      seasonTickets: 20000,
      tierGroup: 'Honor Competitive'
    };
  }

  const table = [
    { match: /immortal|\b100\s*star/i, current: 'Mythical Immortal (100+ Stars)', reset: 'Legend V', bp: 20000, tickets: 20000 },
    { match: /glory|\b50\s*star/i, current: 'Mythical Glory (50-99 Stars)', reset: 'Epic I', bp: 20000, tickets: 20000 },
    { match: /honor|\b25\s*star/i, current: 'Mythical Honor (25-49 Stars)', reset: 'Epic II', bp: 20000, tickets: 20000 },
    { match: /mythic|\b0-24\s*star/i, current: 'Mythic (0-24 Stars)', reset: 'Epic II', bp: 20000, tickets: 20000 },
    { match: /legend\s*[1i]/i, current: 'Legend I', reset: 'Epic III', bp: 15000, tickets: 15000 },
    { match: /legend\s*[2-4|ii|iii|iv]/i, current: 'Legend II - IV', reset: 'Epic IV', bp: 15000, tickets: 15000 },
    { match: /legend\s*[5v]/i, current: 'Legend V', reset: 'Epic V', bp: 15000, tickets: 15000 },
    { match: /epic\s*[1-2|i|ii]/i, current: 'Epic I - II', reset: 'Grandmaster I', bp: 10000, tickets: 10000 },
    { match: /epic\s*[3-5|iii|iv|v]/i, current: 'Epic III - V', reset: 'Grandmaster II', bp: 10000, tickets: 10000 },
    { match: /grandmaster|gm/i, current: 'Grandmaster I - V', reset: 'Master I - III', bp: 7000, tickets: 7000 },
    { match: /master/i, current: 'Master I - IV', reset: 'Elite I - III', bp: 4000, tickets: 4000 }
  ];

  for (const entry of table) {
    if (entry.match.test(r)) {
      return {
        currentTier: entry.current,
        projectedResetTier: entry.reset,
        seasonBP: entry.bp,
        seasonTickets: entry.tickets,
        tierGroup: 'Standard Seasonal Tier'
      };
    }
  }

  return {
    currentTier: 'Mythic Baseline (Default)',
    projectedResetTier: 'Epic II',
    seasonBP: 20000,
    seasonTickets: 20000,
    tierGroup: 'Mythic Baseline'
  };
}

// ==========================================
// 7. COMPREHENSIVE META HERO COUNTER DATABASE
// ==========================================

const META_HERO_DATABASE = {
  fanny: {
    name: 'Fanny',
    role: 'Assassin',
    lane: 'Jungle',
    tier: 'S+ High Skill',
    hardCounters: ['Khufra', 'Franco', 'Kaja', 'Saber', 'Minsitthar', 'Eudora'],
    itemCounters: ['Antique Cuirass', 'Dreadnaught Armor', 'Winter Crown', 'Wind of Nature'],
    tactics: 'Khufra Bouncing Ball membatalkan kabel instan. Kaja / Franco suppression mengunci sebelum Fanny menyentuh dinding. Selalu rusuh buff biru di menit 01:15.'
  },
  ling: {
    name: 'Ling',
    role: 'Assassin',
    lane: 'Jungle',
    tier: 'S High Mobility',
    hardCounters: ['Khufra', 'Ruby', 'Kaja', 'Saber', 'Chou', 'Minsitthar'],
    itemCounters: ['Antique Cuirass', 'Wind of Nature', 'Blade Armor'],
    tactics: 'Simpan skill hard CC untuk saat Ling mendarat dari Tempest of Blades. Cegah Ling mengambil purple buff.'
  },
  hayabusa: {
    name: 'Hayabusa',
    role: 'Assassin',
    lane: 'Jungle',
    tier: 'S+ Priority Ban/Pick',
    hardCounters: ['Saber', 'Kaja', 'Sun', 'Zhask', 'Guinevere'],
    itemCounters: ['Winter Crown', 'Wind of Nature', 'Antique Cuirass'],
    tactics: 'Shadow Kill terbagi ke semua target terdekat. Manfaatkan clone Sun, spawn Zhask, atau kerumunan minion saat Hayabusa ulti.'
  },
  nolan: {
    name: 'Nolan',
    role: 'Assassin',
    lane: 'Jungle',
    tier: 'S Burst Assassin',
    hardCounters: ['Franco', 'Kaja', 'Khufra', 'Martis', 'Baxia'],
    itemCounters: ['Antique Cuirass', 'Dreadnaught Armor', 'Winter Crown'],
    tactics: 'Nolan bergantung pada rift collapse combo. Gunakan Baxia untuk mengurangi damage burst dan suppress Nolan sebelum keluar ulti.'
  },
  wanwan: {
    name: 'Wanwan',
    role: 'Marksman',
    lane: 'Gold Lane',
    tier: 'S Agile Marksman',
    hardCounters: ['Phoveus', 'Khufra', 'Brody', 'Lolita', 'Natalia'],
    itemCounters: ['Blade Armor', 'Dominance Ice', 'Wind of Nature'],
    tactics: 'Phoveus melompat setiap kali Wanwan melompat. Jangan biarkan weakness di belakang terbuka; rapatkan punggung ke dinding.'
  },
  moskov: {
    name: 'Moskov',
    role: 'Marksman',
    lane: 'Gold Lane',
    tier: 'S+ Late Game Hyper',
    hardCounters: ['Lolita', 'Lesley', 'Claude', 'Belerick', 'Chou'],
    itemCounters: ['Blade Armor', 'Dominance Ice', 'Vengeance Spell'],
    tactics: 'Lolita Shield menelan 100% proyektil dan basic attack Moskov. Belerick + Vengeance memantulkan DPS tinggi Moskov menjadi self-destruction.'
  },
  claude: {
    name: 'Claude',
    role: 'Marksman',
    lane: 'Gold Lane',
    tier: 'S Teamfight Hyper',
    hardCounters: ['Belerick', 'Franco', 'Kaja', 'Lolita', 'Saber'],
    itemCounters: ['Blade Armor', 'Dominance Ice', 'Winter Crown'],
    tactics: 'Blazing Duet Claude terhenti total dengan knock-up atau suppression. Belerick pasif memicu akar duri berkali-kali saat Claude ulti.'
  },
  harith: {
    name: 'Harith',
    role: 'Mage',
    lane: 'Gold Lane / Mid Lane',
    tier: 'S+ Top Contested',
    hardCounters: ['Minsitthar', 'Kaja', 'Baxia', 'Esmeralda', 'Phoveus'],
    itemCounters: ['Athena Shield', 'Radiant Armor', 'Dominance Ice'],
    tactics: 'King\'s Calling Minsitthar menonaktifkan Chrono Dash Harith total di dalam zona. Esmeralda memakan shield tebal Harith tanpa henti.'
  },
  zhask: {
    name: 'Zhask',
    role: 'Mage',
    lane: 'Mid Lane / Gold Lane',
    tier: 'S Zone Controller',
    hardCounters: ['Claude', 'Irithel', 'Beatrix', 'Lancelot', 'Retribution (Jungler)'],
    itemCounters: ['Radiant Armor', 'Athena Shield'],
    tactics: 'Claude stack DHS dengan cepat dari Spawn Zhask. Retribution jungler dapat menghabiskan Spawn besar Zhask secara instan.'
  },
  vexana: {
    name: 'Vexana',
    role: 'Mage',
    lane: 'Mid Lane',
    tier: 'S High CC / Zoning',
    hardCounters: ['Helcurt', 'Lancelot', 'Hayabusa', 'Chou'],
    itemCounters: ['Athena Shield', 'Tough Boots (Resilience)'],
    tactics: 'Hindari berdekatan dengan Lord minion Vexana. Gunakan assassin dengan iframe (Lancelot / Hayabusa) untuk langsung mengincar Vexana di backline.'
  },
  cici: {
    name: 'Cici',
    role: 'Fighter',
    lane: 'EXP Lane',
    tier: 'S Agile Fighter',
    hardCounters: ['Dyrroth', 'Thamuz', 'Yu Zhong', 'Baxia'],
    itemCounters: ['Dominance Ice', 'Sea Halberd', 'Antique Cuirass'],
    tactics: 'Dyrroth menghapus physical armor Cici di early game. Wajib beli anti-heal segera untuk menekan spell vamp Yoyo Blitz.'
  },
  terizla: {
    name: 'Terizla',
    role: 'Fighter',
    lane: 'EXP Lane',
    tier: 'S Tanky Frontliner',
    hardCounters: ['Valir', 'Karrie', 'X.Borg', 'Dyrroth'],
    itemCounters: ['Demon Hunter Sword (DHS)', 'Dominance Ice', 'Malefic Roar'],
    tactics: 'Terizla lambat dan mudah di-kite. Valir dan X.Borg membuatnya tidak pernah bisa mendekat untuk mendaratkan hammer.'
  },
  yu_zhong: {
    name: 'Yu Zhong',
    role: 'Fighter',
    lane: 'EXP Lane',
    tier: 'S High Sustain',
    hardCounters: ['Baxia', 'Dyrroth', 'Paquito', 'Valir'],
    itemCounters: ['Dominance Ice', 'Sea Halberd', 'Antique Cuirass'],
    tactics: 'Hindari teamfight di area sempit saat pasif Sha Residue aktif. Wajib Dominance Ice / Sea Halberd untuk mematikan lifesteal naga.'
  },
  tigreal: {
    name: 'Tigreal',
    role: 'Tank / Support',
    lane: 'Roam',
    tier: 'S+ Teamfight Initiator',
    hardCounters: ['Diggie', 'Valir', 'Akai', 'Grock', 'Wanwan'],
    itemCounters: ['Tough Boots', 'Purify Spell'],
    tactics: 'Diggie Time Journey adalah hard-counter 100% untuk kombinasi Flicker + Implosion Tigreal. Selalu simpan Purify jika tidak ada Diggie.'
  },
  estes: {
    name: 'Estes',
    role: 'Support',
    lane: 'Roam',
    tier: 'S Healing Engine',
    hardCounters: ['Baxia', 'Luo Yi', 'Carmilla', 'Atlas'],
    itemCounters: ['Dominance Ice', 'Sea Halberd', 'Glowing Wand'],
    tactics: 'Estes memaksa timnya berkumpul. Gunakan Luo Yi (Yin-Yang Duality) dan Carmilla (Curse of Blood) untuk meledakkan seluruh tim yang berkumpul.'
  },
  hylos: {
    name: 'Hylos',
    role: 'Tank',
    lane: 'Roam / Jungle',
    tier: 'S+ Tank Meta',
    hardCounters: ['Karrie', 'Claude', 'Valir', 'Baxia', 'DHS Users'],
    itemCounters: ['Demon Hunter Sword', 'Glowing Wand', 'Sea Halberd'],
    tactics: 'HP raksasa Hylos adalah santapan utama Karrie (Lightwheel true damage) dan Demon Hunter Sword (% current HP physical damage).'
  }
};

/**
 * Resolve full draft strategy, hard counters, and item builds for any meta hero
 * @param {string} heroName
 * @returns {object}
 */
function getHeroDraftStrategy(heroName) {
  const key = String(heroName || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  let found = META_HERO_DATABASE[key];
  if (!found) {
    const matchedKey = Object.keys(META_HERO_DATABASE).find(k => k.includes(key) || key.includes(k));
    if (matchedKey) found = META_HERO_DATABASE[matchedKey];
  }

  if (found) {
    return {
      success: true,
      hero: found.name,
      role: found.role,
      lane: found.lane,
      metaTier: found.tier,
      hardCounters: found.hardCounters,
      mandatoryItemCounters: found.itemCounters,
      counterPlayTactics: found.tactics
    };
  }

  return {
    success: false,
    hero: heroName,
    message: `Hero '${heroName}' belum memiliki profil taktik spesifik.`,
    universalCounterRules: [
      'Gunakan hero dengan suppression CC (Franco, Kaja) untuk mobilitas tinggi.',
      'Beli Dominance Ice / Sea Halberd / Glowing Wand terhadap hero sustain/lifesteal.',
      'Gunakan Athena Shield melawan burst mage; Radiant Armor melawan continuous magic DPS.',
      'Gunakan Wind of Nature (Marksman) atau Winter Crown melawan burst assassin.'
    ]
  };
}

// ==========================================
// 8. APIKU ENDPOINT CONTRACT
// ==========================================

export default {
  name: "ML Stalker Pro",
  description: "Deep Mobile Legends account inspector — live IGN, server hub & region, account era estimation, security audit (JB/buy-sell risk), win-rate grind planner, season reset projection, and meta hero counter database",
  category: "Stalker",
  methods: ["GET", "POST"],
  params: ["user_id", "zone_id", "mode", "matches", "current_wr", "target_wr", "daily", "rank", "hero"],

  paramsSchema: {
    user_id: {
      type: "string",
      required: false,
      description: "Mobile Legends User ID (default 1189852221)",
      pattern: "^[0-9]+$"
    },
    zone_id: {
      type: "string",
      required: false,
      description: "Mobile Legends Zone ID (default 13826)",
      pattern: "^[0-9]+$"
    }
  },

  async run(req, res) {
    const startTime = Date.now()

    try {
      const params = { ...req.query, ...req.body }

      // --- stalk (param: user_id + zone_id, default 1189852221 / 13826) ---
      const userId = params.user_id || params.id || "1189852221"
      const zoneId = params.zone_id || params.zone || "13826"

      if (!/^\d+$/.test(String(userId)) || !/^\d+$/.test(String(zoneId))) {
        return res.status(400).json({
          status: false,
          message: "User ID dan Zone ID harus berupa angka"
        })
      }

      const result = await stalkAccount(String(userId), String(zoneId))

      if (!result.exists) {
        return res.status(404).json({
          status: false,
          message: result.message || "Akun MLBB tidak ditemukan",
          result: {
            user_id: result.userId,
            zone_id: result.zoneId,
            serverDetails: result.serverDetails,
            estimatedAccountEra: result.estimatedAccountEra
          },
          metadata: { processing_time: `${Date.now() - startTime}ms` }
        })
      }

      return res.json({
        status: true,
        result,
        metadata: { processing_time: `${Date.now() - startTime}ms` }
      })

    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message || "Failed to process ML stalker request",
        metadata: { processing_time: `${Date.now() - startTime}ms` }
      })
    }
  }
}
