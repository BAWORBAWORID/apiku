/* Scrape Voratoon Pengganti Komikcast
   Feature : ambil update manga list
   By: Claidex( Alfi )
   Ch: https://whatsapp.com/channel/0029VbCOLKRKrWQtIO1vzN0E */
const BASE = "https://v1.voratoon.com";

async function fetchRSCData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const pushRe = /self\.__next_f\.push\(/g;
  let m;
  const starts = [];
  while ((m = pushRe.exec(html)) !== null) starts.push(m.index);
  let inner = "";
  for (let j = 0; j < starts.length; j++) {
    const end = j + 1 < starts.length ? starts[j + 1] : html.length;
    const chunk = html.slice(starts[j], end);
    if (chunk.includes("initialData")) {
      inner = chunk.slice(chunk.indexOf('[1,"') + 4, chunk.lastIndexOf('"]'));
      break;
    }
  }
  if (!inner) return [];
  let raw = inner
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "");
  raw = raw.replace(/[\x00-\x1f]/g, "");
  const markerObj = '"initialData":{';
  const objIdx = raw.indexOf(markerObj);
  if (objIdx !== -1) {
    const objStart = objIdx + markerObj.length - 1;
    let depth = 0;
    for (let i = objStart; i < raw.length; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            const obj = JSON.parse(raw.slice(objStart, i + 1));
            const s = obj.series?.[0];
            if (s) {
              const chapters = (obj.chapters ?? []).map(ch => ({
                chapterIndex: ch.data?.index,
                id: ch.id,
                data: ch.data,
              }));
              return [{ id: s.id, data: s.data, chapters, updatedAt: s.updatedAt }];
            }
          } catch { return []; }
          break;
        }
      }
    }
  }
  const marker = '"initialData":[';
  const idx = raw.indexOf(marker);
  if (idx === -1) return [];
  const arrStart = idx + marker.length - 1;
  let depth2 = 0;
  for (let i = arrStart; i < raw.length; i++) {
    if (raw[i] === "[") depth2++;
    else if (raw[i] === "]") {
      depth2--;
      if (depth2 === 0) {
        try { return JSON.parse(raw.slice(arrStart, i + 1)); }
        catch { return []; }
      }
    }
  }
  return [];
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}j lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}h lalu`;
  return `${Math.floor(days / 30)}bln lalu`;
}

function fmtDate(iso) {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
  });
}

function seriesURL(slug) { return `${BASE}/series/${slug}`; }
function chapterURL(slug, ch) { return `${BASE}/series/${encodeURIComponent(slug)}/chapter/${encodeURIComponent(ch)}`; }

function extractSeries(item) {
  const d = item.data ?? {};
  const chapters = item.chapters ?? [];
  const latest = chapters[0];
  const genres = (d.genres ?? []).map(g => g.data?.name).filter(Boolean).join(", ");
  return {
    title: d.title,
    nativeTitle: d.nativeTitle,
    slug: d.slug,
    coverImage: d.coverImage,
    synopsis: d.synopsis,
    author: d.author,
    rating: d.rating,
    status: d.status,
    format: d.format,
    totalChapters: d.totalChapters,
    genres,
    url: seriesURL(d.slug),
    latestChapter: latest ? {
      index: latest.chapterIndex,
      id: latest.id,
      url: chapterURL(d.slug, latest.chapterIndex),
    } : null,
    updatedAt: item.updatedAt,
    updatedAtHuman: timeAgo(item.updatedAt),
    updatedAtDate: fmtDate(item.updatedAt),
  };
}

async function fetchUpdatesPages(pages) {
  const allItems = [];
  for (const p of pages) {
    const url = p === 1 ? `${BASE}/updates` : `${BASE}/updates?page=${p}`;
    const items = await fetchRSCData(url);
    if (!items.length) break;
    allItems.push(...items);
    if (pages.length > 1) await new Promise(r => setTimeout(r, 300));
  }
  const seen = new Set();
  return allItems.filter(item => {
    const slug = item.data?.slug;
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

async function getUpdates(opts = {}) {
  let pages;
  if (opts.all) {
    pages = Array.from({ length: 20 }, (_, i) => i + 1);
  } else if (opts.pages) {
    pages = opts.pages;
  } else {
    pages = [opts.page || 1];
  }
  return fetchUpdatesPages(pages);
}

export default {
  name: "Voratoon Updates",
  description: "Scrape update manga list — ambil manga terbaru, multi-page, atau semua sekaligus.",
  category: "SEARCH",
  methods: ["GET", "POST"],
  params: ["action", "page", "pages", "all"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      default: "updates",
      description: "Action: updates (default)",
      enum: ["updates"],
    },
    page: {
      type: "number",
      required: false,
      default: 1,
      description: "Halaman update (1 = paling baru)",
    },
    pages: {
      type: "number",
      required: false,
      default: 1,
      description: "Jumlah halaman yang diambil berurutan (maks 20)",
    },
    all: {
      type: "boolean",
      required: false,
      default: false,
      description: "Ambil 20 halaman sekaligus (true/false)",
    },
  },

  async run(req, res) {
    try {
      const { action = "updates", page, pages, all } = { ...req.query, ...req.body };
      const allFlag = all === true || all === "true" || all === "1";
      const p = parseInt(page) || 1;
      const pCount = parseInt(pages) || 1;

      let result;
      switch (action) {
        case "updates": {
          let opts;
          if (allFlag) opts = { all: true };
          else if (pCount > 1) opts = { pages: Array.from({ length: Math.min(pCount, 20) }, (_, i) => i + 1) };
          else opts = { page: p };
          const items = await getUpdates(opts);
          result = items.map(extractSeries);
          break;
        }
        default:
          return res.status(400).json({ status: false, message: `Unknown action: ${action}` });
      }

      res.json({ status: true, result });
    } catch (err) {
      res.status(500).json({ status: false, message: err.message || "Request failed" });
    }
  },
};
