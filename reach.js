/**
 * ALDOXD REACTION (aldomarketid.my.id) — CLI
 *
 * Logic client-nya nyatu di api/fun/reach-ch2.js.
 * File ini hanya CLI + re-export, supaya `import ... from './reach.js'` tetap jalan.
 *
 *   node reach.js                                   Auto register + check-in + laporan akun
 *   node reach.js react <URL> [EMOJI] [ID] [KEY]     Auto register (kalau ID/KEY kosong) lalu reach
 *   node reach.js check <ID>                         Cek koin / detail user
 *   node reach.js checkin <ID>                       Klaim daily check-in
 *   node reach.js login <NAMA> <PASSWORD>            Login akun
 *   node reach.js info <API_KEY>                     Info endpoint + status API key
 *   node reach.js feed                               Live feed reaction (cek service sehat)
 *   node reach.js accounts                           Lihat pool akun (data/aldo-accounts.json)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import client, {
  registerAccount,
  loginAccount,
  getUser,
  checkCoin,
  claimCheckIn,
  getFeed,
  getApiInfo,
  sendReaction,
  registerAndReach,
  ensureAccount,
  loadAccountPool,
} from './api/fun/reach-ch2.js';

export * from './api/fun/reach-ch2.js';
export default client;

/* ================================================================== *
 * CLI
 * ================================================================== */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const USAGE = `
ALDOXD REACTION CLI (aldomarketid.my.id)

  node reach.js                                     Auto register + check-in + laporan akun
  node reach.js register                            Sama seperti di atas
  node reach.js react <URL> [EMOJI] [ID] [KEY]      Auto register (kalau ID/KEY kosong) lalu reach
  node reach.js check <ID>                          Cek koin / detail user
  node reach.js checkin <ID>                        Klaim daily check-in
  node reach.js login <NAMA> <PASSWORD>             Login akun
  node reach.js info <API_KEY>                      Info endpoint + status API key
  node reach.js feed                                Live feed reaction (cek service sehat)
  node reach.js accounts                            Lihat pool akun
`;

  const [cmdRaw] = process.argv.slice(2);
  const cmd = (cmdRaw || '').toLowerCase();
  const print = (label, value) => console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`);

  (async () => {
    console.log('====================================================');
    console.log('   ALDOXD REACTION — AUTO REGISTER / REACH (ESM)    ');
    console.log('====================================================');

    if (['help', '-h', '--help'].includes(cmd)) return console.log(USAGE);

    if (cmd === 'feed') {
      const feed = await getFeed();
      if (!feed.status) return console.error('[-] Gagal ambil feed:', feed.message);
      console.log(`Feed: ${feed.total} entri | reaction sukses terakhir: ${feed.lastSuccess}`);
      for (const f of feed.feed.slice(0, 10)) {
        console.log(` - ${new Date(f.at).toISOString()} | ${f.name} | ${f.emojis} | ${f.url}`);
      }
      return;
    }

    if (cmd === 'accounts' || cmd === 'pool') {
      const pool = loadAccountPool();
      if (!pool.length) return console.log('Pool kosong — belum ada akun tersimpan.');
      console.table(
        pool.map((a) => ({ id: a.id, name: a.name, coin: a.coin, apiKey: a.apiKey }))
      );
      return;
    }

    if (cmd === 'info') {
      const key = process.argv[3];
      if (!key) return console.error('Usage: node reach.js info <API_KEY>');
      return print('[+] Info API key:', await getApiInfo(key));
    }

    if (cmd === 'check' || cmd === 'coin') {
      const id = process.argv[3];
      if (!id) return console.error('Usage: node reach.js check <USER_ID>');
      return print(`[+] Cek akun ${id}:`, await checkCoin(id));
    }

    if (cmd === 'checkin') {
      const id = process.argv[3];
      if (!id) return console.error('Usage: node reach.js checkin <USER_ID>');
      return print(`[+] Check-in ${id}:`, await claimCheckIn(id));
    }

    if (cmd === 'login') {
      const name = process.argv[3];
      const password = process.argv[4];
      if (!name || !password) return console.error('Usage: node reach.js login <NAMA> <PASSWORD>');
      return print(`[+] Login ${name}:`, await loginAccount({ name, password }));
    }

    if (cmd === 'react') {
      const url = process.argv[3];
      const emoji = process.argv[4] || '👍';
      let id = process.argv[5];
      let apiKey = process.argv[6];

      if (!url) return console.error('Usage: node reach.js react <URL> [EMOJI] [ID] [KEY]');

      if (!id || !apiKey) {
        console.log('\n[1/4] Akun belum lengkap — auto register akun baru (+5 koin)...');
        const reg = await registerAccount();
        if (!reg.status) return console.error('[-] Gagal register:', reg.message);
        id = reg.user.id;
        apiKey = reg.user.apiKey;
        console.log(`[+] Akun: ${reg.user.name} | ID: ${id} | koin: ${reg.user.points}`);
      }

      console.log('\n[2/4] Klaim daily check-in (+1 koin)...');
      console.log(`[+] ${(await claimCheckIn(id)).message}`);

      console.log('\n[3/4] Cek koin...');
      const before = await checkCoin(id);
      console.log(`[+] Koin sebelum: ${before.coin}`);

      console.log(`\n[4/4] Kirim reaction '${emoji}' ke ${url}...`);
      const reaction = await sendReaction({ url, emojis: emoji, id, apiKey });
      print('[+] Hasil reaction:', reaction);

      const after = await checkCoin(id);
      console.log('----------------------------------------------------');
      console.log(`🆔 User ID : ${id}`);
      console.log(`🔑 API Key : ${apiKey}`);
      console.log(`💰 Koin    : ${before.coin} -> ${after.coin}`);
      console.log(reaction.status ? '✅ Reaction terkirim.' : `❌ Gagal: ${reaction.message}`);
      console.log('----------------------------------------------------');
      return;
    }

    // Default / register: auto register + check-in + laporan
    const ref = cmd && !['reg', 'register'].includes(cmd) ? cmdRaw : process.argv[3];

    console.log('\n[1/3] Auto register akun baru...');
    const reg = await registerAccount({ ref });
    if (!reg.status) return console.error('[-] Gagal register:', reg.message);

    const { id, name, password, apiKey } = reg.user;
    console.log(`[+] Akun dibuat: ${name} | ID: ${id} | koin awal: ${reg.user.points}`);

    console.log('\n[2/3] Auto claim daily check-in (+1 koin)...');
    const checkin = await claimCheckIn(id);
    console.log(`[+] ${checkin.message}`);

    console.log('\n[3/3] Cek saldo akhir...');
    const coin = await checkCoin(id);

    console.log('====================================================');
    console.log('✅ SELESAI');
    console.log(`👤 Username : ${name}`);
    console.log(`🔑 Password : ${password}`);
    console.log(`🆔 User ID  : ${id}`);
    console.log(`🔑 API Key  : ${apiKey || '-'}`);
    console.log(`💰 Saldo    : ${coin.coin ?? '-'} Poin`);
    console.log('====================================================');
  })().catch((err) => console.error('[-] Fatal:', err.message));
}

// Re-export biar `registerAndReach` / `ensureAccount` tetap bisa dipakai dari CLI context
export { registerAndReach, ensureAccount, getUser };
