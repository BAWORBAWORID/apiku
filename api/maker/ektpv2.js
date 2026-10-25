import fs from 'node:fs';
import path from 'node:path';
import { Canvas, loadImage, FontLibrary } from 'skia-canvas';
import logger from '../../src/utils/logger.js';

const ASSET_DIR = path.join(process.cwd(), 'api', 'maker', 'assets', 'ektpv2');

let fontsLoaded = false;
function ensureFonts() {
  if (fontsLoaded) return;
  try {
    const arrialPath = path.join(ASSET_DIR, 'arrial.ttf');
    const ocrPath = path.join(ASSET_DIR, 'ocr.ttf');
    const signPath = path.join(ASSET_DIR, 'sign.ttf');

    if (fs.existsSync(arrialPath)) FontLibrary.use('ArrialKTP', arrialPath);
    if (fs.existsSync(ocrPath)) FontLibrary.use('OcrKTP', ocrPath);
    if (fs.existsSync(signPath)) FontLibrary.use('SignKTP', signPath);

    fontsLoaded = true;
  } catch (err) {
    logger.error(`[EKTP-V2] Font load error: ${err.message}`);
  }
}

/**
 * Parser string dengan separator "|"
 */
function parsePipeParams(text) {
  const v = text.split('|').map((s) => s.trim());
  return {
    nama: v[0] || undefined,
    prov: v[1] || undefined,
    kota: v[2] || undefined,
    nik: v[3] || undefined,
    ttl: v[4] || undefined,
    jk: v[5] || undefined,
    goldar: v[6] || undefined,
    alamat: v[7] || undefined,
    rtrw: v[8] || undefined,
    keldesa: v[9] || undefined,
    kec: v[10] || undefined,
    agama: v[11] || undefined,
    status: v[12] || undefined,
    kerja: v[13] || undefined,
    wn: v[14] || undefined,
    masa: v[15] || undefined,
    terbuat: v[16] || undefined,
  };
}

async function fetchPhotoBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function generateFakeKtp(options = {}, photoInput) {
  ensureFonts();

  const templatePath = path.join(ASSET_DIR, 'template.png');
  const defaultPhotoPath = path.join(ASSET_DIR, 'default_photo.jpg');

  let photoImg = null;
  if (Buffer.isBuffer(photoInput)) {
    photoImg = await loadImage(photoInput);
  } else if (typeof photoInput === 'string' && photoInput.startsWith('http')) {
    try {
      const pBuf = await fetchPhotoBuffer(photoInput);
      photoImg = await loadImage(pBuf);
    } catch {
      if (fs.existsSync(defaultPhotoPath)) {
        photoImg = await loadImage(defaultPhotoPath);
      }
    }
  } else if (typeof photoInput === 'string' && fs.existsSync(photoInput)) {
    photoImg = await loadImage(photoInput);
  }

  if (!photoImg) {
    if (fs.existsSync(defaultPhotoPath)) {
      photoImg = await loadImage(defaultPhotoPath);
    } else {
      const dummySvg = `<svg width="200" height="280" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#3b82f6"/>
        <circle cx="100" cy="90" r="50" fill="#e2e8f0"/>
        <path d="M 30 240 Q 100 150 170 240 Z" fill="#e2e8f0"/>
      </svg>`;
      photoImg = await loadImage(Buffer.from(dummySvg));
    }
  }

  const templateImg = await loadImage(templatePath);

  const canvas = new Canvas(720, 463);
  const ctx = canvas.getContext('2d');

  // Gambar template background e-KTP
  ctx.drawImage(templateImg, 0, 0, 720, 463);

  // Penempatan & crop pasfoto
  const PHOTO_X = 520,
    PHOTO_Y = 80,
    PHOTO_W = 200,
    PHOTO_H = 280;
  const frameRatio = PHOTO_W / PHOTO_H;
  const imgRatio = photoImg.width / photoImg.height;

  let sx, sy, sw, sh;
  if (imgRatio > frameRatio) {
    sh = photoImg.height;
    sw = sh * frameRatio;
    sx = (photoImg.width - sw) / 2;
    sy = 0;
  } else {
    sw = photoImg.width;
    sh = sw / frameRatio;
    sx = 0;
    sy = (photoImg.height - sh) / 2;
  }

  const scale = Math.min(PHOTO_W / sw, PHOTO_H / sh) * 0.78;
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = PHOTO_X + (PHOTO_W - dw) / 2 - 15;
  const dy = PHOTO_Y + (PHOTO_H - dh) / 2;

  ctx.drawImage(photoImg, sx, sy, sw, sh, dx, dy, dw, dh);

  // Helper render teks
  const L = (x, y, text, font, size) => {
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    ctx.fillText(text || '', x, y);
  };

  const C = (x, y, text, font, size) => {
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(text || '', x, y);
  };

  const up = (s) => (s || '').toUpperCase();

  const prov = options.prov || options.provinsi || 'DKI JAKARTA';
  const kota = options.kota || 'JAKARTA PUSAT';
  const nik = options.nik || '3171010101900001';
  const nama = options.nama || 'BUDI SANTOSO';
  const ttl = options.ttl || 'JAKARTA, 01-01-2000';
  const jk = options.jk || options.jenis_kelamin || 'LAKI-LAKI';
  const goldar = options.goldar || options.golongan_darah || 'O';
  const alamat = options.alamat || 'JL. MERDEKA NO. 45';
  const rtrw = options.rtrw || options.rt_rw || options['rt/rw'] || '001/002';
  const keldesa = options.keldesa || options.kel_desa || options['kel/desa'] || 'GAMBIR';
  const kec = options.kec || options.kecamatan || 'GAMBIR';
  const agama = options.agama || 'ISLAM';
  const status = options.status || 'BELUM KAWIN';
  const kerja = options.kerja || options.pekerjaan || 'PELAJAR/MAHASISWA';
  const wn = options.wn || options.kewarganegaraan || 'WNI';
  const masa = options.masa || options.masa_berlaku || 'SEUMUR HIDUP';
  const terbuat = options.terbuat || '01-01-2024';

  // Header Provinsi & Kota
  C(380, 45, 'PROVINSI ' + up(prov), 'ArrialKTP', 25);
  C(380, 70, 'KOTA ' + up(kota), 'ArrialKTP', 25);

  // NIK dengan font OCR
  ctx.font = '32px OcrKTP';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000000';
  ctx.fillText(nik, 170, 105);

  // Data Biodata Pribadi
  L(190, 145, up(nama), 'ArrialKTP', 16);
  L(190, 168, up(ttl), 'ArrialKTP', 16);
  L(190, 191, up(jk), 'ArrialKTP', 16);
  L(463, 190, up(goldar), 'ArrialKTP', 16);
  L(190, 212, up(alamat), 'ArrialKTP', 16);
  L(190, 234, up(rtrw), 'ArrialKTP', 16);
  L(190, 257, up(keldesa), 'ArrialKTP', 16);
  L(190, 279, up(kec), 'ArrialKTP', 16);
  L(190, 300, up(agama), 'ArrialKTP', 16);
  L(190, 323, up(status), 'ArrialKTP', 16);
  L(190, 346, up(kerja), 'ArrialKTP', 16);
  L(190, 369, up(wn), 'ArrialKTP', 16);
  L(190, 390, up(masa), 'ArrialKTP', 16);

  // Penerbitan Kota & Tanggal
  L(553, 345, 'KOTA ' + up(kota), 'ArrialKTP', 12);
  L(570, 365, terbuat, 'ArrialKTP', 12);

  // Tanda Tangan Digital
  ctx.font = '40px SignKTP';
  const firstName = nama.split(' ')[0] || nama;
  ctx.fillText(firstName, 540, 395);

  return await canvas.toBuffer('image/png');
}

export default {
  name: 'EKTP Generator v2',
  description: 'Pixel-accurate 1:1 Fake e-KTP (Kartu Tanda Penduduk) Indonesia generator v2 dengan auto-crop pasfoto dan tanda tangan digital',
  category: 'Maker',
  methods: ['GET', 'POST'],
  params: [
    'nama',
    'nik',
    'provinsi',
    'kota',
    'ttl',
    'jenis_kelamin',
    'golongan_darah',
    'alamat',
    'rt_rw',
    'kel_desa',
    'kecamatan',
    'agama',
    'status',
    'pekerjaan',
    'kewarganegaraan',
    'masa_berlaku',
    'terbuat',
    'pas_photo',
    'data'
  ],
  paramsSchema: {
    nama: { type: 'string', required: false, default: 'BUDI SANTOSO', description: 'Nama lengkap pemilik KTP', example: 'Budi Santoso' },
    nik: { type: 'string', required: false, default: '3171010101900001', description: '16 digit NIK', example: '3171010101900001' },
    provinsi: { type: 'string', required: false, default: 'DKI JAKARTA', description: 'Provinsi', example: 'DKI JAKARTA' },
    kota: { type: 'string', required: false, default: 'JAKARTA PUSAT', description: 'Kota/Kabupaten', example: 'JAKARTA PUSAT' },
    ttl: { type: 'string', required: false, default: 'JAKARTA, 01-01-2000', description: 'Tempat, Tanggal Lahir', example: 'JAKARTA, 01-01-2000' },
    jenis_kelamin: { type: 'string', required: false, default: 'LAKI-LAKI', enum: ['LAKI-LAKI', 'PEREMPUAN'], description: 'Jenis Kelamin (LAKI-LAKI / PEREMPUAN)', example: 'LAKI-LAKI' },
    golongan_darah: { type: 'string', required: false, default: 'O', enum: ['A', 'B', 'AB', 'O', '-'], description: 'Golongan Darah (A, B, AB, O, -)', example: 'O' },
    alamat: { type: 'string', required: false, default: 'JL. MERDEKA NO. 45', description: 'Alamat jalan', example: 'JL. MERDEKA NO. 45' },
    rt_rw: { type: 'string', required: false, default: '001/002', description: 'RT/RW', example: '001/002' },
    kel_desa: { type: 'string', required: false, default: 'GAMBIR', description: 'Kelurahan/Desa', example: 'GAMBIR' },
    kecamatan: { type: 'string', required: false, default: 'GAMBIR', description: 'Kecamatan', example: 'GAMBIR' },
    agama: { type: 'string', required: false, default: 'ISLAM', enum: ['ISLAM', 'KRISTEN', 'KATOLIK', 'HINDU', 'BUDDHA', 'KONGHUCU'], description: 'Agama', example: 'ISLAM' },
    status: { type: 'string', required: false, default: 'BELUM KAWIN', enum: ['BELUM KAWIN', 'KAWIN', 'CERAI HIDUP', 'CERAI MATI'], description: 'Status perkawinan', example: 'BELUM KAWIN' },
    pekerjaan: { type: 'string', required: false, default: 'PELAJAR/MAHASISWA', description: 'Pekerjaan', example: 'PELAJAR/MAHASISWA' },
    kewarganegaraan: { type: 'string', required: false, default: 'WNI', enum: ['WNI', 'WNA'], description: 'Kewarganegaraan', example: 'WNI' },
    masa_berlaku: { type: 'string', required: false, default: 'SEUMUR HIDUP', enum: ['SEUMUR HIDUP'], description: 'Masa berlaku', example: 'SEUMUR HIDUP' },
    terbuat: { type: 'string', required: false, default: '01-01-2024', description: 'Tanggal pembuatan KTP', example: '01-01-2024' },
    pas_photo: { type: 'string', required: false, description: 'URL pasfoto (opsional)', example: 'https://picsum.photos/400/600' },
    data: { type: 'string', required: false, description: 'Format pipe: nama|prov|kota|nik|ttl|jk|goldar|alamat|rt_rw|kel_desa|kec|agama|status|kerja|wn|masa|terbuat' }
  },

  async run(req, res) {
    try {
      const query = { ...req.query, ...req.body };

      let ktpData = {};
      if (query.data && query.data.includes('|')) {
        ktpData = parsePipeParams(query.data);
      } else {
        ktpData = { ...query };
      }

      const photoInput = query.pas_photo || query.photo || query.img;
      const buffer = await generateFakeKtp(ktpData, photoInput);

      const fileName = `ektp_${(ktpData.nama || 'ktp').replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return res.send(buffer);
    } catch (err) {
      logger.error(`[EKTP-V2] Error: ${err.message}`);
      return res.status(500).json({
        status: false,
        message: err.message || 'Gagal generate E-KTP v2'
      });
    }
  }
};
