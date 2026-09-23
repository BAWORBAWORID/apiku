import axios from 'axios'
import logger from "../../src/utils/logger.js"

const API_KEY = 'AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0'
const CONTINUE_URL = 'https://alightcreative.com'
const VERIFY_PURCHASE_URL = 'https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase'
const PRODUCT_ID = 'am.full.sub.annual.19q4'
const TOKEN = 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw'
const SKU_TYPE = 'subs'
const FIREBASE_INSTANCE_ID_TOKEN = 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'

const firebaseHeaders = {
  'Content-Type': 'application/json',
  'X-Android-Package': 'com.alightcreative.motion',
  'X-Android-Cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 15; 23127PN0CC Build/BP1A.250505.005)'
}

const purchaseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'okhttp/3.12.1'
}

function extractOobCode(fullUrl) {
  if (!fullUrl) return null
  try {
    let cleanUrl = fullUrl.replace(/&/g, '&')
    try { cleanUrl = decodeURIComponent(cleanUrl) } catch (e) {}
    const match = cleanUrl.match(/[?&]oobCode=([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/oobCode=([a-zA-Z0-9_-]+)/i)
    if (match && match[1]) return match[1].replace(/[^a-zA-Z0-9_-]/g, '')
  } catch (e) {}
  return null
}

function generateCodeOrder() {
  const r = (len) => {
    let str = "";
    for (let i = 0; i < len; i++) str += Math.floor(Math.random() * 10);
    return str;
  };
  return `GPA.${r(4)}.${r(4)}.${r(4)}.${r(5)}`;
}

async function signInWithEmailLink(email, oobCode) {
  const headers = {
    ...firebaseHeaders,
    'Referer': 'https://alight-creative.firebaseapp.com'
  }
  const response = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${API_KEY}`,
    { email, oobCode },
    { headers, timeout: 30000 }
  )
  return response.data
}

async function applyPremium(idToken, customOrderId) {
  const codeorder = generateCodeOrder()
  const finalOrderId = customOrderId ? customOrderId : codeorder
  const headers = {
    ...purchaseHeaders,
    'authorization': `Bearer ${idToken}`,
    'firebase-instance-id-token': FIREBASE_INSTANCE_ID_TOKEN
  }
  const response = await axios.post(VERIFY_PURCHASE_URL, {
    data: {
      productId: PRODUCT_ID,
      token: TOKEN,
      skuType: SKU_TYPE,
      orderId: finalOrderId
    }
  }, { headers, timeout: 30000 })
  
  if (response.data && typeof response.data === 'object') {
    response.data.applied_order_id = finalOrderId;
  }
  return response.data
}

export default {
  name: "AlightMotion Verify v2",
  description: "Verifikasi email link & apply premium Alight Motion (signInWithEmailLink + verifyPurchase)",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email", "link", "orderid"],
  paramsSchema: {
    email: { type: "string", required: true, description: "Email yang dikirim magic link", example: "user@email.com" },
    link: { type: "string", required: true, description: "Full link verifikasi dari email", example: "https://alightcreative.com/auth_action/?mode=signIn&oobCode=xxx" },
    orderid: { type: "string", required: false, description: "Custom Order ID untuk Google Play (opsional)", example: "GPA.1234.5678.9012.34567" }
  },

  async run(req, res) {
    try {
      const { email, link, orderid } = { ...req.query, ...req.body }

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ status: false, error: "Parameter 'email' wajib diisi dan harus valid" })
      }

      if (!link || typeof link !== 'string' || !link.includes('oobCode=')) {
        return res.status(400).json({ status: false, error: "Parameter 'link' wajib diisi dan harus mengandung oobCode" })
      }

      const oobCode = extractOobCode(link)
      if (!oobCode) {
        return res.status(400).json({ status: false, error: "Gagal mengekstrak oobCode dari link" })
      }

      const signinRes = await signInWithEmailLink(email.trim(), oobCode)
      const idToken = signinRes.idToken
      if (!idToken) {
        return res.status(502).json({ status: false, error: "Gagal mendapatkan idToken dari verifikasi" })
      }

      const premiumRes = await applyPremium(idToken, orderid)

      return res.json({
        status: true,
        email: email.trim(),
        message: "Premium berhasil diterapkan",
        signin: {
          localId: signinRes.localId,
          email: signinRes.email,
          isNewUser: signinRes.isNewUser
        },
        premium: premiumRes
      })

    } catch (err) {
      logger.error(`[AM VERIFYv2] Error: ${err.message}`)
      const errMsg = err.response?.data?.error?.message || err.message
      return res.status(500).json({ status: false, error: errMsg })
    }
  }
}