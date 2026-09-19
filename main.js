import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import https from 'https';

const BASE_URL = 'https://anichin.cafe';
const CREATOR = 'Lann';

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://anichin.cafe/'
};

// Claude Code Style Colors
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

export function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: defaultHeaders }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, url).href;
        }
        return resolve(fetchHtml(redirectUrl));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed ${url}: HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

export function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatResponse(data, meta = {}) {
  return {
    status: 'success',
    creator: CREATOR,
    timestamp: new Date().toISOString(),
    ...meta,
    data
  };
}

export function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

export function parseSeriesList(html) {
  const series = [];
  const regex = /<article[^>]*class="[^"]*bs[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<a\s+href="([^"]+)"[^>]*title="([^"]*)"/i) || block.match(/<a\s+href="([^"]+)"/i);
    const titleMatch = block.match(/<div class="tt">([\s\S]*?)<\/div>/i) || block.match(/<h2[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h2>/i);
    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/i) || block.match(/<img[^>]*data-src="([^"]+)"/i);
    const statusMatch = block.match(/<span\s+class="status[^"]*">([\s\S]*?)<\/span>/i);
    const typeMatch = block.match(/<span\s+class="typez[^"]*">([\s\S]*?)<\/span>/i);
    const epMatch = block.match(/<span\s+class="epx">([\s\S]*?)<\/span>/i);

    if (linkMatch) {
      const url = linkMatch[1];
      const title = titleMatch ? cleanText(titleMatch[1]) : (linkMatch[2] ? cleanText(linkMatch[2]) : '');
      series.push({
        title,
        url,
        slug: url.replace(BASE_URL, '').replace(/^\/seri\//, '').replace(/^\//, '').replace(/\/$/, ''),
        thumbnail: imgMatch ? imgMatch[1] : null,
        type: typeMatch ? cleanText(typeMatch[1]) : 'Donghua',
        status: statusMatch ? cleanText(statusMatch[1]) : null,
        latestEpisode: epMatch ? cleanText(epMatch[1]) : null
      });
    }
  }

  if (series.length === 0) {
    const altRegex = /<div class="bsx">[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<div class="tt">([\s\S]*?)<\/div>/gi;
    while ((match = altRegex.exec(html)) !== null) {
      const url = match[1];
      series.push({
        title: cleanText(match[3]),
        url,
        slug: url.replace(BASE_URL, '').replace(/^\/seri\//, '').replace(/^\//, '').replace(/\/$/, ''),
        thumbnail: match[2],
        type: 'Donghua',
        status: null,
        latestEpisode: null
      });
    }
  }

  return series;
}

export function parseSeriesDetail(html, url) {
  const titleMatch = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i);
  const alterMatch = html.match(/<span[^>]*class="alter"[^>]*>([\s\S]*?)<\/span>/i);
  const synMatch = html.match(/<div[^>]*class="synp"[^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div[^>]*class="entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const thumbMatch = html.match(/<div[^>]*class="thumb"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
  
  let rating = null;
  const ratingWidthMatch = html.match(/<div class="rtb"><span style="width:([0-9.]+)%"><\/span><\/div>/i);
  if (ratingWidthMatch) {
    rating = (parseFloat(ratingWidthMatch[1]) / 10).toFixed(1);
  } else {
    const ratingTextMatch = html.match(/<div[^>]*class="rating"[^>]*>[\s\S]*?([0-9.]+)/i);
    if (ratingTextMatch) rating = ratingTextMatch[1];
  }

  const info = {};
  const infoRegex = /<span><b>([^<]+):<\/b>\s*([\s\S]*?)<\/span>/gi;
  let infoMatch;
  while ((infoMatch = infoRegex.exec(html)) !== null) {
    info[cleanText(infoMatch[1]).toLowerCase()] = cleanText(infoMatch[2]);
  }

  const genres = [];
  const genreBlock = html.match(/<div[^>]*class="genxed"[^>]*>([\s\S]*?)<\/div>/i) || html.match(/<span[^>]*class="mgen"[^>]*>([\s\S]*?)<\/span>/i);
  if (genreBlock) {
    const gmRegex = /<a[^>]*>([^<]+)<\/a>/gi;
    let gm;
    while ((gm = gmRegex.exec(genreBlock[1])) !== null) {
      genres.push(cleanText(gm[1]));
    }
  }

  const episodes = [];
  const epRegex = /<li[^>]*data-index="[^"]*"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<div class="epl-num">([^<]+)<\/div>[\s\S]*?<div class="epl-title">([^<]+)<\/div>[\s\S]*?<div class="epl-date">([^<]+)<\/div>/gi;
  let epMatch;
  while ((epMatch = epRegex.exec(html)) !== null) {
    const epUrl = epMatch[1];
    episodes.push({
      episodeNumber: cleanText(epMatch[2]),
      title: cleanText(epMatch[3]),
      releaseDate: cleanText(epMatch[4]),
      url: epUrl,
      slug: epUrl.replace(BASE_URL, '').replace(/^\//, '').replace(/\/$/, '')
    });
  }

  if (episodes.length === 0) {
    const altEp = [...html.matchAll(/<a href="([^"]+)"[^>]*><div class="epl-title">([^<]+)<\/div>/gi)];
    altEp.forEach((m, i) => {
      episodes.push({
        episodeNumber: `${altEp.length - i}`,
        title: cleanText(m[2]),
        releaseDate: '-',
        url: m[1],
        slug: m[1].replace(BASE_URL, '').replace(/^\//, '').replace(/\/$/, '')
      });
    });
  }

  const batchDownloads = [];
  const batchSections = [...html.matchAll(/<div[^>]*class="soraurlx"[^>]*>([\s\S]*?)<\/div>/gi)];
  batchSections.forEach(section => {
    const titleMatch = section[1].match(/<strong>([\s\S]*?)<\/strong>/i);
    const links = [...section[1].matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(l => ({
      provider: cleanText(l[2]),
      link: l[1]
    }));
    if (links.length > 0) {
      batchDownloads.push({
        batchName: titleMatch ? cleanText(titleMatch[1]) : 'Batch',
        links
      });
    }
  });

  return {
    title: titleMatch ? cleanText(titleMatch[1]) : '',
    alternativeTitle: alterMatch ? cleanText(alterMatch[1]) : null,
    url,
    slug: url.replace(BASE_URL, '').replace(/^\/seri\//, '').replace(/^\//, '').replace(/\/$/, ''),
    thumbnail: thumbMatch ? thumbMatch[1] : null,
    rating: rating ? `${rating} / 10` : null,
    synopsis: synMatch ? cleanText(synMatch[1]) : '',
    genres,
    info: {
      status: info['status'] || null,
      type: info['type'] || 'Donghua',
      studio: info['studio'] || null,
      network: info['network'] || null,
      duration: info['duration'] || null,
      season: info['season'] || null,
      country: info['country'] || null,
      released: info['released'] || info['released on'] || null,
      updatedOn: info['updated on'] || null
    },
    totalEpisodes: episodes.length,
    episodes,
    batchDownloads
  };
}

export function parseEpisodeDetail(html, url) {
  const titleMatch = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/i);
  const defaultEmbedMatch = html.match(/<div class="player-embed"[^>]*>[\s\S]*?<iframe[^>]*src="([^"]+)"/i);
  const defaultEmbed = defaultEmbedMatch ? defaultEmbedMatch[1] : null;

  const streamingServers = [];
  const serverOptions = [...html.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*data-index=["']?([^"'>]*)["']?[^>]*>([\s\S]*?)<\/option>/gi)];

  for (const opt of serverOptions) {
    const base64Value = opt[1];
    const serverName = cleanText(opt[3]);
    let streamUrl = null;

    if (base64Value) {
      try {
        const decoded = Buffer.from(base64Value, 'base64').toString('utf-8');
        const srcMatch = decoded.match(/src=["']([^"']+)["']/i);
        if (srcMatch) streamUrl = srcMatch[1];
      } catch (err) {}
    }

    streamingServers.push({
      serverName,
      serverIndex: opt[2],
      streamUrl: streamUrl || defaultEmbed
    });
  }

  const downloads = [];
  const dlBlocks = [...html.matchAll(/<div[^>]*class="soraurlx"[^>]*>([\s\S]*?)<\/div>/gi)];
  dlBlocks.forEach(block => {
    const qMatch = block[1].match(/<strong>([\s\S]*?)<\/strong>/i);
    const links = [...block[1].matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(l => ({
      provider: cleanText(l[2]),
      link: l[1]
    }));
    if (links.length > 0) {
      downloads.push({
        resolution: qMatch ? cleanText(qMatch[1]) : 'Direct',
        links
      });
    }
  });

  const prevMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*class="prev"/i) || html.match(/<a[^>]*href="([^"]+)"[^>]*rel="prev"/i);
  const nextMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*class="next"/i) || html.match(/<a[^>]*href="([^"]+)"[^>]*rel="next"/i);
  const allMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*class="allsub"/i) || html.match(/<div class="allsub"><a href="([^"]+)"/i);

  return {
    episodeTitle: titleMatch ? cleanText(titleMatch[1]) : 'Episode',
    url,
    slug: url.replace(BASE_URL, '').replace(/^\//, '').replace(/\/$/, ''),
    navigation: {
      prevEpisodeUrl: prevMatch ? prevMatch[1] : null,
      nextEpisodeUrl: nextMatch ? nextMatch[1] : null,
      seriesUrl: allMatch ? allMatch[1] : null
    },
    streamingServers,
    downloads
  };
}

export function parseSchedule(html) {
  const schedule = {};
  const sections = [...html.matchAll(/<div class="releases"><h3><span>([^<]+)<\/span><\/h3><\/div>\s*<div class="listupd">([\s\S]*?)<\/div>\s*<\/div>/gi)];

  sections.forEach(sec => {
    const dayName = cleanText(sec[1]);
    const blockContent = sec[2];
    const items = [];

    const itemRegex = /<div class="bsx">[\s\S]*?<a\s+href="([^"]+)"[^>]*title="([^"]*)"[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<div class="tt">([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = itemRegex.exec(blockContent)) !== null) {
      const url = m[1];
      const title = cleanText(m[4]) || cleanText(m[2]);
      const parentBlock = blockContent.slice(m.index, m.index + 500);
      const timeMatch = parentBlock.match(/<span class=['"]epx[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);
      const subMatch = parentBlock.match(/<span class=['"]sb[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i);

      items.push({
        title,
        url,
        slug: url.replace(BASE_URL, '').replace(/^\/seri\//, '').replace(/^\//, '').replace(/\/$/, ''),
        thumbnail: m[3],
        time: timeMatch ? cleanText(timeMatch[1]) : '',
        episode: subMatch ? cleanText(subMatch[1]) : ''
      });
    }

    if (items.length > 0) {
      schedule[dayName] = items;
    }
  });

  return schedule;
}

export function parseGenres(html) {
  const genres = [];
  const genreBlock = html.match(/<ul class="genre">([\s\S]*?)<\/ul>/i) || html.match(/<ul class="taxindex">([\s\S]*?)<\/ul>/i);
  if (genreBlock) {
    const regex = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(genreBlock[1])) !== null) {
      const name = cleanText(match[2]);
      const url = match[1];
      genres.push({
        name,
        slug: url.replace(BASE_URL, '').replace(/^\/genres\//, '').replace(/^\//, '').replace(/\/$/, ''),
        url
      });
    }
  }
  return genres;
}

// Handlers
export async function handleSearch(query) {
  const html = await fetchHtml(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
  const list = parseSeriesList(html);
  return formatResponse(list, { query, total: list.length });
}

export async function handleOngoing() {
  const html = await fetchHtml(`${BASE_URL}/ongoing/`);
  const list = parseSeriesList(html);
  return formatResponse(list, { total: list.length });
}

export async function handleCompleted() {
  const html = await fetchHtml(`${BASE_URL}/completed/`);
  const list = parseSeriesList(html);
  return formatResponse(list, { total: list.length });
}

export async function handleSchedule() {
  const html = await fetchHtml(`${BASE_URL}/schedule/`);
  const schedule = parseSchedule(html);
  return formatResponse(schedule, { daysCount: Object.keys(schedule).length });
}

export async function handleGenres() {
  const html = await fetchHtml(`${BASE_URL}/`);
  const genres = parseGenres(html);
  return formatResponse(genres, { total: genres.length });
}

export async function handleGenreFilter(genreSlug) {
  const html = await fetchHtml(`${BASE_URL}/genres/${genreSlug.replace(/^\/genres\/|\/$/g, '')}/`);
  const list = parseSeriesList(html);
  return formatResponse(list, { genre: genreSlug, total: list.length });
}

export async function handleDetail(urlOrSlug) {
  let targetUrl = urlOrSlug.trim();
  if (!targetUrl.startsWith('http')) {
    const cleanSlug = targetUrl.replace(/^\/seri\/|^\/|\/$/g, '');
    targetUrl = `${BASE_URL}/seri/${cleanSlug}/`;
  }
  const html = await fetchHtml(targetUrl);
  const detail = parseSeriesDetail(html, targetUrl);
  return formatResponse(detail);
}

export async function handleEpisode(urlOrSlug) {
  let targetUrl = urlOrSlug.trim();
  let cleanSlug = targetUrl.startsWith('http') 
    ? targetUrl.replace(BASE_URL, '').replace(/^\/seri\/|^\/|\/$/g, '')
    : targetUrl.replace(/^\/seri\/|^\/|\/$/g, '');

  if (!targetUrl.startsWith('http')) {
    targetUrl = `${BASE_URL}/${cleanSlug}/`;
  }

  let html = await fetchHtml(targetUrl);
  let note = null;

  if (html.includes('class="eplister"') || html.includes('class="synp"') || html.includes('class="infox"')) {
    const seriesDetail = parseSeriesDetail(html, targetUrl);
    if (seriesDetail.episodes && seriesDetail.episodes.length > 0) {
      const latestEpUrl = seriesDetail.episodes[0].url;
      const epHtml = await fetchHtml(latestEpUrl);
      const epData = parseEpisodeDetail(epHtml, latestEpUrl);
      note = `Input terdeteksi sebagai Series "${seriesDetail.title}". Menampilkan episode terbaru.`;
      return formatResponse(epData, { note });
    }
  }

  const epData = parseEpisodeDetail(html, targetUrl);
  return formatResponse(epData);
}

async function interactive() {
  const rl = readline.createInterface({ input, output });

  while (true) {
    console.log(`\n${c.bold}${c.cyan}> ${c.reset}${c.bold}Pilih perintah:${c.reset}`);
    console.log(`  ${c.cyan}1${c.reset}  Cari donghua (Search)`);
    console.log(`  ${c.cyan}2${c.reset}  Donghua ongoing`);
    console.log(`  ${c.cyan}3${c.reset}  Donghua completed`);
    console.log(`  ${c.cyan}4${c.reset}  Jadwal rilis (Schedule)`);
    console.log(`  ${c.cyan}5${c.reset}  Filter berdasarkan genre`);
    console.log(`  ${c.cyan}6${c.reset}  Detail & episode list (URL / Slug)`);
    console.log(`  ${c.cyan}7${c.reset}  Stream server & download episode (URL / Slug)`);
    console.log(`  ${c.cyan}0${c.reset}  Keluar`);

    const answer = (await rl.question(`\n${c.dim}?${c.reset} ${c.yellow}anichin${c.reset} ${c.dim}>${c.reset} `)).trim();

    if (answer === '0' || answer.toLowerCase() === 'exit' || answer.toLowerCase() === 'q') {
      rl.close();
      process.exit(0);
    }

    try {
      if (answer === '1') {
        const query = (await rl.question(`${c.dim}?${c.reset} Keyword pencarian: `)).trim();
        if (query) {
          const res = await handleSearch(query);
          printJson(res);
        }
      } else if (answer === '2') {
        const res = await handleOngoing();
        printJson(res);
      } else if (answer === '3') {
        const res = await handleCompleted();
        printJson(res);
      } else if (answer === '4') {
        const res = await handleSchedule();
        printJson(res);
      } else if (answer === '5') {
        const genre = (await rl.question(`${c.dim}?${c.reset} Masukkan slug genre (contoh: action, fantasy, cultivation): `)).trim();
        if (genre) {
          const res = await handleGenreFilter(genre);
          printJson(res);
        }
      } else if (answer === '6') {
        const target = (await rl.question(`${c.dim}?${c.reset} Masukkan URL atau Slug Seri: `)).trim();
        if (target) {
          const res = await handleDetail(target);
          printJson(res);
        }
      } else if (answer === '7') {
        const target = (await rl.question(`${c.dim}?${c.reset} Masukkan URL atau Slug Episode: `)).trim();
        if (target) {
          const res = await handleEpisode(target);
          printJson(res);
        }
      } else {
        console.log(`${c.red}! Pilihan tidak valid.${c.reset}`);
      }
    } catch (err) {
      console.log(JSON.stringify({
        status: 'error',
        creator: CREATOR,
        message: err.message
      }, null, 2));
    }
  }
}

// Execution Entrypoint
const [, , cmd, param] = process.argv;

if (cmd) {
  (async () => {
    try {
      switch (cmd.toLowerCase()) {
        case 'search':
        case 's':
          if (!param) throw new Error('Parameter pencarian diperlukan. Contoh: node main.js search "Soul Land"');
          printJson(await handleSearch(param));
          break;
        case 'ongoing':
        case 'on':
          printJson(await handleOngoing());
          break;
        case 'completed':
        case 'done':
          printJson(await handleCompleted());
          break;
        case 'schedule':
        case 'sched':
          printJson(await handleSchedule());
          break;
        case 'genre':
        case 'g':
          if (!param) throw new Error('Parameter slug genre diperlukan. Contoh: node main.js genre cultivation');
          printJson(await handleGenreFilter(param));
          break;
        case 'genres':
          printJson(await handleGenres());
          break;
        case 'detail':
        case 'd':
          if (!param) throw new Error('Parameter url/slug diperlukan. Contoh: node main.js detail tales-of-herding-gods');
          printJson(await handleDetail(param));
          break;
        case 'episode':
        case 'ep':
          if (!param) throw new Error('Parameter url/slug diperlukan. Contoh: node main.js ep the-other-side-of-deep-space-episode-26-tamat-subtitle-indonesia');
          printJson(await handleEpisode(param));
          break;
        default:
          console.log(JSON.stringify({
            status: 'error',
            creator: CREATOR,
            message: `Command "${cmd}" tidak dikenal. Perintah: search, ongoing, completed, schedule, genre, genres, detail, episode`
          }, null, 2));
      }
    } catch (err) {
      console.log(JSON.stringify({
        status: 'error',
        creator: CREATOR,
        message: err.message
      }, null, 2));
    }
  })();
} else {
  interactive().catch(console.error);
}
