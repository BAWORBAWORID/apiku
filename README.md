# apiku / Always Codex APIs

REST API engine with **305+ endpoints** (AI, Downloader, Image, Games, Search, etc) — auto-loaded via HMR.

---

## 📦 Instalasi

### Persyaratan Sistem

| Komponen | Versi |
|----------|-------|
| OS | Ubuntu 22.04 LTS (recommended) / Debian-based |
| Node.js | 20+ (ESM) |
| npm | 9+ |
| Python | 3.x (untuk build native module) |
| RAM | Min. 2GB (recommended 4GB+) |
| Disk | ~3GB (termasuk Chrome binary) |

### Langkah Manual (tanpa Docker)

```bash
# 1. Clone repository
git clone https://github.com/BAWORBAWORID/apiku.git
cd apiku

# 2. Install Node.js 20 (jika belum ada)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Install system dependencies (Chrome runtime, ffmpeg, canvas build deps)
apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates gnupg unzip xz-utils git \
    build-essential python3 \
    libgtk-3-0 libgbm1 libasound2 \
    libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxi6 libxtst6 libnss3 libcups2 libdrm2 \
    libpango-1.0-0 libatk1.0-0 libatk-bridge2.0-0 libnspr4 \
    libxrandr2 libxfixes3 libxss1 \
    fonts-liberation libappindicator3-1 libu2f-udev xdg-utils \
    xvfb ffmpeg \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

# 4. Install Node.js dependencies
npm install

# 5. Install Playwright (untuk scanweb/solve/stalker)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true
npx playwright install

# 6. Setup directories
mkdir -p files data logs data/sessions data/session
chmod -R 777 files data logs

# 7. Environment variables
cat > .env << 'EOF'
PORT=3000
CHROME_PATH=/app/src/function/chrome/chrome/linux-150.0.7843.0/chrome-linux64/chrome
PUPPETEER_EXECUTABLE_PATH=/app/src/function/chrome/chrome/linux-150.0.7843.0/chrome-linux64/chrome
TURNSTILE_SITE_KEY=0x4AAAAAADU0qlI1CGjEPBfY
TURNSTILE_SECRET_KEY=0x4AAAAAADU0qm7kgVYTJI3ou0WeYpcg70Q
ADMIN_KEY=SUPERADMIN
ID_TOKEN=8268304140:AAFOixt-NgOtYKk_58vwMypiZXx3WYC_2OU
CHAT_ID=5323386592
PUPPETEER_SKIP_DOWNLOAD=true
EOF
```

### Instalasi via Docker (Recommended)

```bash
# Build image (Chrome 150 otomatis terdownload oleh Dockerfile)
docker build -t apiku .

# Run container
docker run -d \
  --name apiku \
  -p 3000:3000 \
  --restart unless-stopped \
  apiku
```

`Dockerfile` otomatis:
- Install semua system dependencies
- Download Chrome 150.0.7843.0 ke `src/function/chrome/chrome/linux-150.0.7843.0/`
- Symlink `/usr/local/bin/chrome`
- `npm install` + `npx playwright install`
- Setup directories (`files`, `data`, `logs`, `data/sessions`)

### Deploy ke Vercel (Serverless)

⚠️ Vercel **tidak support** Puppeteer/Playwright. Set env:

```bash
PUPPETEER_SKIP_DOWNLOAD=true
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true
VERCEL=true
```

---

## 🚀 Menjalankan

### Development (Nodemon + HMR)

```bash
npm run dev
```

### Production

```bash
npm start
```

### PM2 (Production Manager)

```bash
npm install -g pm2
pm2 start index.js --name apiku
pm2 save
pm2 startup
pm2 logs apiku
```

### Verifikasi

```
http://localhost:3000          → Homepage
http://localhost:3000/docs     → Dokumentasi endpoint
http://localhost:3000/admin    → Admin dashboard
http://localhost:3000/stats    → Status & statistik
```

Test API cepat:
```bash
curl http://localhost:3000/api/v1/models -H "X-API-Key: YOUR_KEY"
```

---

## 🔧 Konfigurasi Lanjutan

### API Key Admin

Default `ADMIN_KEY` env = `SUPERADMIN` (ubah di production!).

Login: `/admin/login` dengan Turnstile CAPTCHA + password dari `data/admin-users.json`.

### Custom Chrome Path

Jika Chrome binary ada di lokasi lain:
```bash
CHROME_PATH=/path/to/chrome
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

### HMR (Hot Module Reload)

File di `api/`, `src/`, dan `src/routes/` otomatis di-reload tanpa restart server. Tunggu ~2-3 detik setelah save.

`src/app/index.js` perubahan struktural tetap butuh restart manual (`pm2 restart apiku`).

---

## 🐛 Troubleshooting

**Chrome tidak ditemukan:**
```bash
# Verify path
ls -la $CHROME_PATH
# Reinstall Playwright
npx playwright install
```

**Canvas build error:**
```bash
apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
npm rebuild canvas
```

**Port 3000 sudah dipakai:**
```bash
PORT=8080 npm start
```

**Permission denied di files/data:**
```bash
chmod -R 777 files data logs
```

---

## 📄 License

GPL-3.0 — (C) 2026 BAWORBAWORID
