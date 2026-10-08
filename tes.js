/**
 * Code-V Web2APK Compiler Scraper (ESM)
 * Author: Vamz Spectre (VamxAPI)
 * 
 * Target: https://code-v-compiler-sr.vercel.app
 * Backend: Internal Next.js Vercel API (/api/build, /api/build/:id, /cdn/:file)
 * Engine: sdkforge WebView APK Packager
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://code-v-compiler-sr.vercel.app';

/**
 * Request compile Web to APK
 * @param {Object} config
 * @param {string} config.url - URL website target (e.g. 'https://vamxapi.my.id')
 * @param {string} [config.appName='MyWebApp'] - Nama aplikasi Android
 * @param {string} [config.packageName='com.mywebapp.app'] - Package ID Android
 * @param {string} [config.versionName='1.0.0'] - Version display
 * @param {number} [config.versionCode=1] - Version code int
 * @param {Object} [config.options] - Opsi kustomisasi tambahan
 * @param {Function} [onProgress] - Callback progress listener (status, percent)
 * @returns {Promise<Object>} Result data build info & download url
 */
export async function buildWeb2Apk(config, onProgress = null) {
  if (!config?.url) {
    throw new Error('Parameter config.url wajib diisi!');
  }

  const payload = {
    url: config.url,
    appName: config.appName || 'MyWebApp',
    packageName: config.packageName || 'com.mywebapp.app',
    versionName: config.versionName || '1.0.0',
    versionCode: Number(config.versionCode) || 1,
    options: {
      splash: config.options?.splash ?? true,
      splashType: config.options?.splashType || 'default',
      splashText: config.options?.splashText || config.appName || 'Loading...',
      splashBg: config.options?.splashBg || '#0B0D10',
      splashFg: config.options?.splashFg || '#3B82F6',
      splashMs: Number(config.options?.splashMs) || 2000,
      orientation: config.options?.orientation || 'auto',
      js: config.options?.js ?? true,
      zoom: config.options?.zoom ?? false,
      permissions: Array.isArray(config.options?.permissions)
        ? config.options.permissions
        : ['INTERNET', 'WAKE_LOCK']
    }
  };

  // 1. Submit Build Request
  const createRes = await fetch(`${BASE_URL}/api/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(payload)
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Gagal mengirim build request: ${createRes.status} ${errText}`);
  }

  const createData = await createRes.json();
  const buildId = createData.build_id;
  if (!buildId) {
    throw new Error(`Respon server tidak memiliki build_id: ${JSON.stringify(createData)}`);
  }

  if (onProgress) onProgress({ status: 'queued', progress: 0, buildId });

  // 2. Poll Build Status
  const maxAttempts = 60; // Max ~120 detik
  let attempt = 0;

  while (attempt < maxAttempts) {
    await new Promise(r => setTimeout(r, 2000));
    attempt++;

    const pollRes = await fetch(`${BASE_URL}/api/build/${buildId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!pollRes.ok) continue;

    const pollData = await pollRes.json();
    const status = pollData.status;
    const progress = pollData.progress || 0;

    if (onProgress) {
      onProgress({ status, progress, log: pollData.log || [] });
    }

    if (status === 'ready' || status === 'completed') {
      const downloadPath = pollData.download_url || `/cdn/${buildId}.apk`;
      const downloadUrl = downloadPath.startsWith('http')
        ? downloadPath
        : `${BASE_URL}${downloadPath}`;

      return {
        status: true,
        buildId,
        appName: payload.appName,
        packageName: payload.packageName,
        targetUrl: payload.url,
        fileSize: pollData.file_size || null,
        downloadUrl,
        raw: pollData
      };
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`Build gagal: ${pollData.error || 'Unknown error'}`);
    }
  }

  throw new Error('Build timeout: Proses compile memakan waktu lebih dari 2 menit.');
}

export { BASE_URL };
export default buildWeb2Apk;

const isMain = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
  process.argv[1].endsWith('tes.js')
);

if (isMain) {
  (async () => {
    try {
      console.log('🚀 Memulai Web2APK Compile...');
      const targetUrl = process.argv[2] || 'https://vamxapi.my.id';
      const appName = process.argv[3] || 'Apiku App';
      const packageName = process.argv[4] || 'com.apiku.app';
      const outputFile = process.argv[5] || 'api.apk';

      const result = await buildWeb2Apk(
        {
          url: targetUrl,
          appName: appName,
          packageName: packageName
        },
        (p) => console.log(`⏳ [${p.status}] Progress: ${p.progress || 0}%`)
      );

      console.log('\n✅ Build Sukses!');
      console.log('Download URL:', result.downloadUrl);

      console.log(`📥 Mengunduh APK ke ${outputFile}...`);
      const apkRes = await fetch(result.downloadUrl);
      if (!apkRes.ok) {
        throw new Error(`Gagal mengunduh APK: ${apkRes.status} ${apkRes.statusText}`);
      }
      const arrayBuffer = await apkRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(outputFile, buffer);
      console.log(`🎉 Berhasil disimpan ke ${outputFile} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (err) {
      console.error('\n❌ Terjadi error:', err.message);
      process.exit(1);
    }
  })();
}
