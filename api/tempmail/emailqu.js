/**
 * EmailQu Temp Mail API
 * Provider: emailqu.com/api (domains, generate, custom, check)
 *
 * GET/POST /api/tempmail/emailqu?mode=domains|generate|custom|check
 */

async function JHEmailQu(mode, target, extra) {
  const axios = (await import('axios')).default;
  const baseRes = { status: true, data: {} };

/*
- HARGAI WOY JANGAN DIHAPUS!
- Skrep by *JH a.k.a DHIKA - FIONY BOT*
- Credits to all Fiony's Bot Admin. 
- Maaf kalo kurang maksimal atau berantakan
- Hasil gabut saja xixixi. 
*/

  const pick = (...vals) => {
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v !== undefined ? (v !== null ? (v !== '' ? true : (v === 0 ? true : (v === false ? true : false))) : false) : false) return v;
    }
    return '';
  };

  const BASE_URL = 'https://emailqu.com/api';
  
  const jantung = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; 23021RAA2Y Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Mobile Safari/537.36',
    'Referer': 'https://emailqu.com/'
  };

  const fetchAPI = async (endpoint) => {
    const { data: resData, status: resStat } = await axios.get(`${BASE_URL}${endpoint}`, { headers: jantung, validateStatus: () => true });
    if (resStat >= 400 ? true : !resData) throw new Error(`API HTTP Error ${resStat} di endpoint ${endpoint}`);
    return resData;
  };

  const getDomains = async () => {
    const data = await fetchAPI('/domains');
    const domArr = data.domains ? (Array.isArray(data.domains) ? data.domains : []) : [];
    const res = [];
    for (let i = 0; i < domArr.length; i++) {
      const d = domArr[i];
      const dStr = pick(d.domain, '');
      if (dStr !== '') res.push(dStr);
    }
    return res;
  };

  const cleanBodyHtml = (htmlStr) => {
    const noTags = htmlStr.replace(/<[^>]*>/g, '');
    const noNewline = noTags.replace(/\n/g, ' ');
    return noNewline.trim();
  };

  try {
    const cleanMode = pick(mode, '').toLowerCase();
    if (cleanMode === '') throw new Error('Mode tidak boleh kosong (domains, generate, custom, check)');

    if (cleanMode === 'domains') {
      const domains = await getDomains();
      baseRes.data.mode = 'domains';
      baseRes.data.total = domains.length;
      baseRes.data.domains = domains;

    } else if (cleanMode === 'generate') {
      const usernameData = await fetchAPI('/random-username');
      const uname = pick(usernameData.username, '');
      if (uname === '') throw new Error('Gagal dapet random username dari API');

      const domains = await getDomains();
      if (domains.length === 0) throw new Error('Daftar domain kosong dari API');
      
      const randIdx = Math.floor(Math.random() * domains.length);
      const selDomain = domains[randIdx];
      const finalEmail = `${uname}@${selDomain}`;

      baseRes.data.mode = 'generate';
      baseRes.data.email = finalEmail;
      baseRes.data.domain_used = selDomain;

    } else if (cleanMode === 'custom') {
      const cleanUname = pick(target, '');
      const rawDomain = pick(extra, '');
      if (cleanUname === '') throw new Error('Kirim username nya lek di parameter target');
      if (rawDomain === '') throw new Error('Kirim domain nya lek di parameter extra');
      
      const cleanDomain = rawDomain.replace('@', '');
      const domains = await getDomains();
      
      let isDomValid = false;
      for (let i = 0; i < domains.length; i++) {
        if (domains[i] === cleanDomain) {
          isDomValid = true;
          break;
        }
      }
      
      if (isDomValid === false) throw new Error(`Domain "${cleanDomain}" tidak ada di sistem emailqu lek`);

      const finalEmail = `${cleanUname}@${cleanDomain}`;
      const encEmail = encodeURIComponent(finalEmail);
      const chkData = await fetchAPI(`/public/emails/${encEmail}`);
      
      const isSuc = chkData.success === true ? true : false;
      if (isSuc === false) throw new Error('Gagal verifikasi / buka inbox custom email ini lek');

      baseRes.data.mode = 'custom';
      baseRes.data.email = finalEmail;
      baseRes.data.inbox_count = pick(chkData.count, 0);

      const mArr = chkData.emails ? (Array.isArray(chkData.emails) ? chkData.emails : []) : [];
      const msgRes = [];
      for (let i = 0; i < mArr.length; i++) {
        const msg = mArr[i];
        let bodyT = pick(msg.body_text, '');
        if (bodyT === '') {
          const bodyH = pick(msg.body_html, '');
          if (bodyH !== '') bodyT = cleanBodyHtml(bodyH);
        }
        if (bodyT === '') bodyT = 'No body';

        msgRes.push({
          id: pick(msg.id, ''),
          from: pick(msg.from, ''),
          subject: pick(msg.subject, ''),
          date: pick(msg.received_at, '') !== '' ? new Date(msg.received_at).toLocaleString() : '',
          body: bodyT
        });
      }
      baseRes.data.emails = msgRes;

    } else if (cleanMode === 'check') {
      const emailTarget = pick(target, '');
      if (emailTarget === '') throw new Error('Kirim email nya lek buat di cek');

      const encEmail = encodeURIComponent(emailTarget);
      const chkData = await fetchAPI(`/public/emails/${encEmail}`);
      
      const isSuc = chkData.success === true ? true : false;
      if (isSuc === false) throw new Error('Gagal narik isi inbox API EmailQu lek');

      baseRes.data.mode = 'check';
      baseRes.data.address = pick(chkData.address, emailTarget);
      baseRes.data.inbox_count = pick(chkData.count, 0);

      const mArr = chkData.emails ? (Array.isArray(chkData.emails) ? chkData.emails : []) : [];
      const msgRes = [];
      for (let i = 0; i < mArr.length; i++) {
        const msg = mArr[i];
        let bodyT = pick(msg.body_text, '');
        if (bodyT === '') {
          const bodyH = pick(msg.body_html, '');
          if (bodyH !== '') bodyT = cleanBodyHtml(bodyH);
        }
        if (bodyT === '') bodyT = 'No body';

        msgRes.push({
          id: pick(msg.id, ''),
          from: pick(msg.from, ''),
          subject: pick(msg.subject, ''),
          date: pick(msg.received_at, '') !== '' ? new Date(msg.received_at).toLocaleString() : '',
          body: bodyT
        });
      }
      baseRes.data.emails = msgRes;

    } else {
      throw new Error(`Mode tidak dikenal: ${cleanMode} (pakai: domains, generate, custom, check)`);
    }

    return baseRes;

  } catch (error) {
    baseRes.status = false;
    baseRes.error = pick(error.message, 'Unknown Error');
    baseRes.data = null;
    return baseRes;
  }
}

// SAMPLE USE - DELETE COMMENTS!
// return JHEmailQu('domains', '', '');
// return JHEmailQu('generate', '', '');
// return JHEmailQu('custom', 'JHFiony', 'kilua.app');
// return JHEmailQu('check', 'EMAIL_DISINI', '');


export default {
  name: "EmailQu Temp Mail",
  description:
    "Temp mail emailqu.com: list domain, generate email random, buat inbox custom, dan cek pesan masuk",
  category: "Email",
  methods: ["GET", "POST"],
  params: ["mode", "name", "domain", "email"],
  paramsSchema: {
    mode: {
      type: "string",
      required: true,
      description: "domains | generate | custom | check",
      example: "generate",
    },
    name: {
      type: "string",
      required: false,
      description: "Username/email untuk mode custom",
      example: "JHTes",
    },
    domain: {
      type: "string",
      required: false,
      description: "Domain untuk mode custom (harus dari list domains)",
      example: "kilua.app",
    },
    email: {
      type: "string",
      required: false,
      description: "Email yang mau dicek inbox-nya (mode check)",
      example: "xxx@dontol.cfd",
    },
  },

  async run(req, res) {
    const start = Date.now();
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const mode = String(params.mode || "").trim().toLowerCase();

    if (!mode) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'mode' wajib diisi (domains | generate | custom | check)",
      });
    }

    let target = "";
    let extra = "";
    if (mode === "custom") {
      target = String(params.name || params.username || "").trim();
      extra = String(params.domain || "").trim();
      if (!target || !extra) {
        return res.status(400).json({
          status: false,
          message: "Mode custom butuh parameter 'name' dan 'domain'",
        });
      }
    } else if (mode === "check") {
      target = String(params.email || "").trim();
      if (!target) {
        return res.status(400).json({
          status: false,
          message: "Mode check butuh parameter 'email'",
        });
      }
    }

    const result = await JHEmailQu(mode, target, extra);

    if (!result.status) {
      return res.status(502).json({
        status: false,
        message: result.error || "Gagal memproses permintaan",
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }

    return res.json({
      status: true,
      ...result.data,
      metadata: { processing_time: `${Date.now() - start}ms` },
    });
  },
};
