const BASE_URL = 'https://tempmailbackend.projonmoit.ltd';
const USER_AGENT = 'Dart/3.5 (dart:io)';

async function apiRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || 20000)
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  if (!res.ok) {
    const message = (json && (json.message || json.error)) || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`Mailbin API error (${res.status}): ${message}`);
  }

  return json;
}

async function generateMailbox(domain) {
  const body = domain ? { domain } : {};
  const data = await apiRequest('/public/mailboxes/generate', { method: 'POST', body });
  return {
    address: data.address,
    domain: data.domain,
    expiresAt: data.expiresAt ?? null
  };
}

async function fetchMessages(address) {
  const messages = await apiRequest(`/public/messages/${encodeURIComponent(address.trim().toLowerCase())}`);
  return (messages || []).map(m => ({
    messageId: m.messageId || null,
    from: m.from || '',
    to: m.to || address,
    subject: m.subject || '',
    text: m.text || '',
    html: m.html || '',
    receivedAt: m.receivedAt || null
  }));
}

async function fetchDomains() {
  const domains = await apiRequest('/public/domains');
  return (domains || [])
    .filter(d => d.type === 'free' && d.isActive)
    .map(d => d.name);
}

export default {
  name: 'Mailbin Temp Mail',
  description: 'Temporary email via Mailbin — generate mailbox, cek inbox, dan list domain gratis.',
  category: 'Tempmail',
  methods: ['GET', 'POST'],
  params: ['action', 'email', 'domain'],

  paramsSchema: {
    action: {
      type: 'string',
      required: true,
      enum: ['generate', 'inbox', 'domains'],
      description: 'Aksi: generate (buat mailbox baru), inbox (cek pesan), domains (list domain gratis)',
      example: 'generate'
    },
    email: {
      type: 'string',
      required: false,
      description: 'Alamat email untuk cek inbox (wajib jika action=inbox)',
      example: 'abc123@mailbin.buzz'
    },
    domain: {
      type: 'string',
      required: false,
      description: 'Domain pilihan saat generate (opsional)',
      example: 'mailbin.buzz'
    }
  },

  async run(req, res) {
    const start = Date.now();
    const { action, email, domain } = { ...req.query, ...req.body };

    if (!action || !['generate', 'inbox', 'domains'].includes(action)) {
      return res.status(400).json({
        status: false,
        message: "Parameter 'action' harus 'generate', 'inbox', atau 'domains'"
      });
    }

    try {
      if (action === 'generate') {
        const mailbox = await generateMailbox(domain || null);
        return res.json({
          status: true,
          action,
          result: {
            address: mailbox.address,
            domain: mailbox.domain,
            expiresAt: mailbox.expiresAt,
            expiresIn: mailbox.expiresAt
              ? Math.max(0, Math.floor((mailbox.expiresAt - Date.now()) / 1000)) + 's'
              : null
          },
          responseTime: `${Date.now() - start}ms`
        });
      }

      if (action === 'inbox') {
        if (!email) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'email' wajib diisi untuk action=inbox"
          });
        }
        const messages = await fetchMessages(email);
        return res.json({
          status: true,
          action,
          result: {
            email,
            count: messages.length,
            messages
          },
          responseTime: `${Date.now() - start}ms`
        });
      }

      if (action === 'domains') {
        const domains = await fetchDomains();
        return res.json({
          status: true,
          action,
          result: { domains, count: domains.length },
          responseTime: `${Date.now() - start}ms`
        });
      }

    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || 'Mailbin request failed',
        responseTime: `${Date.now() - start}ms`
      });
    }
  }
};
