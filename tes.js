/**
 * Multi-Tool Test Runner (ESM)
 * Modes:
 *   1. Alight Motion Account Creator (Powered by Maildropy Temp Mail):
 *      node tes.js am [count]
 *      Contoh: node tes.js am
 *              node tes.js am 2
 *
 *   2. Maildropy Temp Mail Scraper:
 *      node tes.js
 *      node tes.js maildropy
 *      node tes.js <email>
 */

import axios from 'axios'
import { wrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import {
  sendMagicLink,
  findVerifyLink,
  verifyMagicLink,
  applyPremium,
  getLicenseStatus,
} from './api/am/bulkv4.js'

// ─────────────────────────────────────────────
// Maildropy Client & Scraper Base
// ─────────────────────────────────────────────
const MAILDROPY_BASE = 'http://maildropy.com'
const MAILDROPY_WEB = 'https://maildropy.com'
const TIMEOUT = 20000
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'

const jar = new CookieJar()
export const maildropyClient = wrapper(
  axios.create({
    jar,
    baseURL: MAILDROPY_BASE,
    timeout: TIMEOUT,
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    validateStatus: () => true,
  })
)

export function getDirectUrl(email) {
  if (!email) return null
  return `${MAILDROPY_WEB}/${email}`
}

export async function generateMaildropyEmail(domain = 'maildropy.com', customUser = '') {
  try {
    const cleanUser = (customUser || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
    if (cleanUser) {
      const customEmail = `${cleanUser}@${domain}`
      const response = await maildropyClient.post('/wxapi/set-email', { email: customEmail })
      const data = response.data || {}
      const email = data.email || customEmail
      return {
        status: response.status >= 200 && response.status < 300,
        data: {
          email,
          domain,
          approved: Boolean(data.approved),
          direct_url: getDirectUrl(email),
        },
      }
    }

    const response = await maildropyClient.post('/wxapi/generate', { domain })
    const data = response.data || {}
    if (data.email) data.direct_url = getDirectUrl(data.email)
    return {
      status: response.status >= 200 && response.status < 300,
      data,
    }
  } catch (error) {
    return { status: false, message: error.message }
  }
}

export async function validateMaildropyEmail(email) {
  if (!email) return { status: false, message: 'Email wajib diisi!' }
  try {
    const encoded = encodeURIComponent(email)
    const response = await maildropyClient.get(`/wxapi/email-status/${encoded}`)
    const data = response.data || {}
    data.direct_url = getDirectUrl(email)
    return {
      status: response.status >= 200 && response.status < 300,
      data,
    }
  } catch (error) {
    return { status: false, message: error.message }
  }
}

export async function checkMaildropyInbox(email) {
  if (!email) return { status: false, message: 'Email wajib diisi!' }
  try {
    const encoded = encodeURIComponent(email)
    const response = await maildropyClient.get(`/wxapi/messages/${encoded}`)
    const data = response.data || {}
    data.direct_url = getDirectUrl(email)
    return {
      status: response.status >= 200 && response.status < 300,
      data,
    }
  } catch (error) {
    return { status: false, message: error.message }
  }
}

export async function getMaildropyMessage(email, messageId) {
  if (!email || !messageId) return { status: false, message: 'Email dan messageId wajib diisi!' }
  try {
    const encEmail = encodeURIComponent(email)
    const encId = encodeURIComponent(messageId)
    const response = await maildropyClient.get(`/wxapi/message/${encEmail}/${encId}`)
    const data = response.data || {}
    data.direct_url = getDirectUrl(email)
    return {
      status: response.status >= 200 && response.status < 300,
      data,
    }
  } catch (error) {
    return { status: false, message: error.message }
  }
}

// ─────────────────────────────────────────────
// Polling Inbox Maildropy Mencari Magic Link
// ─────────────────────────────────────────────
async function waitForMaildropyVerifyLink(email, { maxAttempts = 20, intervalMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const inboxRes = await checkMaildropyInbox(email)
      const messages = inboxRes.data?.messages || []

      if (messages.length > 0) {
        for (const msg of messages) {
          // 1. Cek langsung dari preview/teks pesan
          let link = findVerifyLink([msg])
          if (link) return { link, attempts: attempt, msgId: msg.id }

          // 2. Jika belum ketemu, ambil body pesan penuh dari /wxapi/message/:email/:id
          const msgId = msg.id || msg._id
          if (msgId) {
            const detailRes = await getMaildropyMessage(email, msgId)
            const detailData = detailRes.data || {}
            link = findVerifyLink([detailData, msg])
            if (link) return { link, attempts: attempt, msgId }
          }
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─────────────────────────────────────────────
// Alight Motion Account Creator via Maildropy
// ─────────────────────────────────────────────
export async function createSingleAMAccount(index = 1, total = 1) {
  const prefix = total > 1 ? `[${index}/${total}] ` : ''
  console.log(`\n==================================================`)
  console.log(`${prefix}🚀 Memulai Pembuatan Akun Alight Motion Premium (Maildropy)`)
  console.log(`==================================================`)

  // Step 1: Create Maildropy email
  console.log(`${prefix}📧 [1/5] Membuat email temporary via Maildropy (maildropy.com)...`)
  const gen = await generateMaildropyEmail('maildropy.com')
  const email = gen.data?.email
  if (!email) {
    throw new Error(`Gagal membuat email Maildropy: ${gen.message || 'Respons kosong'}`)
  }
  const directUrl = getDirectUrl(email)
  console.log(`${prefix}   ➜ Email: ${email}`)
  console.log(`${prefix}   ➜ Web Inbox: ${directUrl}`)

  // Step 2: Send Firebase magic link
  console.log(`${prefix}📨 [2/5] Mengirim magic sign-in link dari Alight Creative...`)
  await sendMagicLink(email)
  console.log(`${prefix}   ✓ Magic link berhasil dikirim ke ${email}`)

  // Step 3: Wait for verification link in Maildropy inbox
  console.log(`${prefix}⏳ [3/5] Menunggu email masuk di Maildropy inbox...`)
  const found = await waitForMaildropyVerifyLink(email, { maxAttempts: 20, intervalMs: 2000 })
  if (!found?.link) {
    throw new Error(`Link verifikasi tidak ditemukan di inbox Maildropy ${email} setelah 40 detik`)
  }
  console.log(`${prefix}   ✓ Link verifikasi ditemukan dalam ${found.attempts * 2} detik!`)

  // Step 4: Verify magic link and get idToken
  console.log(`${prefix}🔑 [4/5] Memverifikasi login Firebase Auth...`)
  const authData = await verifyMagicLink(email, found.link)
  if (!authData.idToken) {
    throw new Error(`Gagal memperoleh idToken dari Firebase`)
  }
  console.log(`${prefix}   ✓ Login sukses! LocalID: ${authData.localId}`)

  // Step 5: Apply premium subscription
  console.log(`${prefix}⭐ [5/5] Mengaktifkan lisensi Alight Motion Premium...`)
  const purchaseRes = await applyPremium(authData.idToken)
  const orderId = purchaseRes.applied_order_id

  // Step 6: Check license status
  let license = { isPro: false, expiresAt: null, benefits: [] }
  try {
    license = await getLicenseStatus(authData.idToken)
  } catch (licErr) {
    console.warn(`${prefix}   ⚠ Warning saat membaca status lisensi: ${licErr.message}`)
  }

  const result = {
    status: true,
    email,
    orderId,
    isPro: license.isPro,
    expiresAt: license.expiresAt,
    localId: authData.localId,
    idToken: authData.idToken,
    refreshToken: authData.refreshToken,
    webInbox: directUrl,
    benefits: license.benefits,
  }

  console.log(`\n🎉 ${prefix}AKUN ALIGHT MOTION PREMIUM BERHASIL DIBUAT!`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📧 Email      : ${result.email}`)
  console.log(`💎 Status Pro : ${result.isPro ? 'AKTIF (PRO)' : 'TIDAK AKTIF'}`)
  console.log(`📅 Kadaluarsa : ${result.expiresAt || '-'}`)
  console.log(`🧾 Order ID   : ${result.orderId}`)
  console.log(`📬 Web Inbox  : ${result.webInbox}`)
  console.log(`🆔 Local ID   : ${result.localId}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

  return result
}

export async function runAMCreator(count = 1) {
  const total = Math.min(Math.max(parseInt(count, 10) || 1, 1), 10)
  console.log(`\n🎬 Alight Motion Premium Creator via Maildropy (Total: ${total} Akun)`)

  const results = []
  for (let i = 0; i < total; i++) {
    try {
      const res = await createSingleAMAccount(i + 1, total)
      results.push(res)
    } catch (err) {
      console.error(`❌ Gagal membuat akun ke-${i + 1}: ${err.message}`)
    }
    if (i < total - 1) {
      console.log(`⏳ Menunggu 2 detik sebelum akun berikutnya...`)
      await sleep(2000)
    }
  }

  console.log(`\n✨ Ringkasan: Selesai memproses ${results.length}/${total} akun Alight Motion Premium.`)
  return results
}

// ─────────────────────────────────────────────
// CLI Runner
// ─────────────────────────────────────────────
const command = (process.argv[2] || '').toLowerCase()
const param = process.argv[3]

;(async () => {
  try {
    // Mode AM Creator: node tes.js am [count]
    if (command === 'am' || command === 'bulkv4') {
      const count = parseInt(param, 10) || 1
      await runAMCreator(count)
      return
    }

    // Mode Maildropy: node tes.js [email]
    console.log('=== Maildropy Temp Mail Test ===\n')

    if (command && command.includes('@')) {
      console.log(`🔗 Akses Langsung Web: ${getDirectUrl(command)}\n`)

      console.log(`[1] Validating status untuk: ${command}`)
      const statusRes = await validateMaildropyEmail(command)
      console.log('Status result:', JSON.stringify(statusRes, null, 2))

      console.log(`\n[2] Checking inbox untuk: ${command}`)
      const inboxRes = await checkMaildropyInbox(command)
      console.log('Inbox result:', JSON.stringify(inboxRes, null, 2))
    } else {
      console.log('[1] Generating new email...')
      const genRes = await generateMaildropyEmail()
      console.log('Generate result:', JSON.stringify(genRes, null, 2))

      const generatedEmail = genRes.data?.email
      if (generatedEmail) {
        console.log(`\n🔗 Akses Langsung Web: ${getDirectUrl(generatedEmail)}`)

        console.log(`\n[2] Validating email: ${generatedEmail}`)
        const statusRes = await validateMaildropyEmail(generatedEmail)
        console.log('Validate result:', JSON.stringify(statusRes, null, 2))

        console.log(`\n[3] Checking inbox: ${generatedEmail}`)
        const inboxRes = await checkMaildropyInbox(generatedEmail)
        console.log('Inbox result:', JSON.stringify(inboxRes, null, 2))
      }

      console.log('\n💡 Tip:')
      console.log('• Jalankan pembuatan akun Alight Motion via Maildropy: node tes.js am')
      console.log('• Jalankan bulk beberapa akun:                        node tes.js am 2')
    }
  } catch (err) {
    console.error('Error:', err.message)
  }
})()