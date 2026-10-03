/**
 * Preset AlightMotion Finder
 * Base API: https://bintangapi.my.id
 *
 * Usage:
 *   node tes.js <url>
 *   node tes.js https://vt.tiktok.com/ZSbm87nak/
 */

import axios from 'axios';

export async function findAMPreset(url) {
  const { data } = await axios.get('https://bintangapi.my.id/api/amfind/', {
    params: { url },
    headers: {
      Accept: '*/*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      Connection: 'keep-alive',
      Origin: 'https://starlabs.biz.id',
      Referer: 'https://starlabs.biz.id/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
      'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
    },
    timeout: 60000,
  });

  return data;
}

const inputUrl = process.argv[2] || 'https://vt.tiktok.com/ZSbm87nak/';

(async () => {
  try {
    console.log(`🔍 Mencari preset Alight Motion untuk URL: ${inputUrl}\n`);
    const data = await findAMPreset(inputUrl);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    const errorData = e.response?.data ? JSON.stringify(e.response.data, null, 2) : e.message;
    console.error(`❌ Error: ${errorData}`);
    process.exit(1);
  }
})();