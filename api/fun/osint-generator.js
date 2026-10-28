/**
 * 【 Umbrella OSINT — Account Generator 】
 * Target   : https://umbrella-osint-neo.vercel.app/
 * Category : Fun
 * Desc     : Auto-generate akun di Umbrella OSINT via Firebase yang ter-expose di client
 */

import logger from '../../src/utils/logger.js'

const DB_URL = 'https://rfz-tracker-a1dd7-default-rtdb.asia-southeast1.firebasedatabase.app'
const ADMIN_KEY = 'RFZ2025'
const ROLES = ['user', 'viewer', 'editor']

function hashPassword(password) {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}

function genId(prefix = 'user') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = prefix + '_'
  for (let i = 0; i < 13; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

function genUsername() {
  const adj = ['dark', 'neo', 'ultra', 'hyper', 'alpha', 'cyber', 'shadow', 'ghost', 'void', 'storm']
  const noun = ['blade', 'zero', 'core', 'pulse', 'nexus', 'viper', 'raven', 'wolf', 'hawk', 'byte']
  return adj[Math.floor(Math.random() * adj.length)] +
         noun[Math.floor(Math.random() * noun.length)] +
         Math.floor(Math.random() * 999)
}

function genPassword(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function parseExpiry(input) {
  // input: "2027-12-31" atau days integer
  if (!input) {
    // default 365 hari
    const d = new Date(Date.now() + 365 * 86400000)
    return formatExpiry(d)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(input))) {
    return `${input} 23:59`
  }
  const days = parseInt(input)
  if (!isNaN(days) && days > 0) {
    const d = new Date(Date.now() + days * 86400000)
    return formatExpiry(d)
  }
  throw new Error("Format expired tidak valid. Gunakan 'YYYY-MM-DD' atau jumlah hari (angka)")
}

function formatExpiry(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 23:59`
}

async function dbSet(path, data) {
  const res = await fetch(`${DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) throw new Error(`DB write failed: HTTP ${res.status}`)
  return res.json()
}

async function dbGet(path) {
  const res = await fetch(`${DB_URL}/${path}.json`)
  if (!res.ok) throw new Error(`DB read failed: HTTP ${res.status}`)
  return res.json()
}

async function checkUsernameExists(username) {
  const [users, phising] = await Promise.all([
    dbGet('users'),
    dbGet('phising_users')
  ])
  const inUsers = users && Object.values(users).some(u => u.username === username)
  const inPhising = phising && Object.values(phising).some(u => u.username === username)
  return inUsers || inPhising
}

async function createAccount({ username, password, role, expiry }) {
  const exists = await checkUsernameExists(username)
  if (exists) throw new Error(`Username "${username}" sudah dipakai`)

  const userId = genId('user')
  const phisingId = genId('phising')
  const hashedPass = hashPassword(password)
  const now = new Date().toISOString()

  const userData = {
    username,
    password: hashedPass,
    role,
    expiry_date: expiry,
    created_by: 'admin',
    created_at: now,
    status: 'active'
  }

  await Promise.all([
    dbSet(`users/${userId}`, userData),
    dbSet(`phising_users/${phisingId}`, userData)
  ])

  return {
    username,
    password,
    role,
    expiry_date: expiry,
    user_id: userId,
    phising_id: phisingId,
    login_url: 'https://umbrella-osint-neo.vercel.app/'
  }
}

export default {
  name: 'Umbrella OSINT Generator',
  description: 'Auto-generate akun di Umbrella OSINT (umbrella-osint-neo.vercel.app)',
  category: 'Fun',
  methods: ['GET', 'POST'],
  params: ['username', 'password', 'role', 'expired'],

  paramsSchema: {
    username: {
      type: 'string',
      required: false,
      description: 'Username akun (min 3 karakter). Jika kosong, di-generate otomatis.',
      example: 'mynewuser'
    },
    password: {
      type: 'string',
      required: false,
      description: 'Password akun (min 4 karakter). Jika kosong, di-generate otomatis.',
      example: 'mypassword'
    },
    role: {
      type: 'string',
      required: false,
      default: 'user',
      enum: ROLES,
      description: 'Role akun: user | viewer | editor (default: user)'
    },
    expired: {
      type: 'string',
      required: false,
      default: '365',
      description: "Tanggal expired: format 'YYYY-MM-DD' atau jumlah hari (default: 365)"
    }
  },

  async run(req, res) {
    try {
      const { username, password, role = 'user', expired } = { ...req.query, ...req.body }

      // Validate role
      const normalizedRole = String(role).toLowerCase()
      if (!ROLES.includes(normalizedRole)) {
        return res.status(400).json({
          status: false,
          message: `Role tidak valid. Pilihan: ${ROLES.join(', ')}`
        })
      }

      // Resolve username & password
      const finalUsername = username ? String(username).trim() : genUsername()
      const finalPassword = password ? String(password).trim() : genPassword()

      if (finalUsername.length < 3) {
        return res.status(400).json({ status: false, message: 'Username minimal 3 karakter' })
      }
      if (finalPassword.length < 4) {
        return res.status(400).json({ status: false, message: 'Password minimal 4 karakter' })
      }

      // Parse expiry
      let expiry
      try {
        expiry = parseExpiry(expired)
      } catch (e) {
        return res.status(400).json({ status: false, message: e.message })
      }

      const result = await createAccount({
        username: finalUsername,
        password: finalPassword,
        role: normalizedRole,
        expiry
      })

      logger.info(`[OSINT-GEN] Created: ${result.username} [${result.role}] exp=${result.expiry_date}`)

      return res.json({ status: true, result })
    } catch (err) {
      logger.error(`[OSINT-GEN] Error: ${err.message}`)
      return res.status(500).json({ status: false, message: err.message || 'Gagal membuat akun' })
    }
  }
}
