#!/usr/bin/env node

const [,, command, ...args] = process.argv;

const API_BASE = 'https://cleantempmail.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Referer': 'https://cleantempmail.com/'
};

async function fetchAPI(endpoint, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { ...HEADERS, ...(options.headers || {}) }
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown API error');
    return json.data;
  } catch (err) {
    console.error('API Error:', err.message);
    process.exit(1);
  }
}

async function main() {
  if (command === 'list') {
    const data = await fetchAPI('/domains');
    console.log(`Available domains (${data.domains.length}):`);
    console.log(data.domains.join('\n'));
    return;
  }

  if (command === 'create') {
    let name = null;
    let domain = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--name') name = args[++i];
      if (args[i] === '--domain') domain = args[++i];
    }

    const body = {};
    if (name) body.prefix = name;
    if (domain) body.domain = domain;

    const options = {
      headers: { 'Content-Type': 'application/json' }
    };

    if (Object.keys(body).length > 0) {
      options.method = 'POST';
      options.body = JSON.stringify(body);
    } else {
      options.method = 'GET';
    }

    console.log('Generating email...');
    const data = await fetchAPI('/generate-email', options);
    console.log('\n✅ Email Created successfully!');
    console.log('-----------------------------');
    console.log('Email : ', data.email);
    console.log('-----------------------------');
    console.log(`To check inbox, run: node tmail.js inbox ${data.email}`);
    return;
  }

  if (command === 'inbox') {
    const email = args[0];
    if (!email) {
      console.error('Usage: node tmail.js inbox <email>');
      return;
    }

    console.log(`Checking inbox for ${email}...`);
    const data = await fetchAPI(`/emails?email=${encodeURIComponent(email)}`);
    const emails = data.emails;

    if (emails.length === 0) {
      console.log('Inbox is empty.');
      return;
    }

    console.log(`\n📬 Inbox (${emails.length} messages):\n`);
    for (const msg of emails) {
      console.log(`[ID: ${msg.id}]`);
      console.log(`From   : ${msg.from_address || msg.from_name}`);
      console.log(`Subject: ${msg.subject}`);
      console.log(`Date   : ${new Date(msg.created_at).toLocaleString()}`);
      
      try {
        const fullMsg = await fetchAPI(`/email/${msg.id}`);
        console.log(`\n--- Message Content ---`);
        console.log((fullMsg.content || fullMsg.html_content || '').substring(0, 500) + (fullMsg.content && fullMsg.content.length > 500 ? '...\n(truncated)' : ''));
        
        if (fullMsg.html_content) {
          const links = [...fullMsg.html_content.matchAll(/href=['"](https?:\/\/[^'"]+)['"]/g)];
          if (links.length > 0) {
            console.log(`\n--- Found Links ---`);
            links.forEach((l, i) => console.log(`[${i+1}] ${l[1]}`));
          }
        }
      } catch (e) {
        console.log(`(Failed to load full message content)`);
      }
      
      console.log('\n----------------------------------------\n');
    }
    return;
  }

  console.log(`CleanTempMail CLI Scraper
Usage:
  node tmail.js list                            # List all available domains
  node tmail.js create                          # Create a random email
  node tmail.js create --name <name>            # Create with custom name (prefix)
  node tmail.js create --domain <domain>        # Create with custom domain
  node tmail.js create --name <n> --domain <d>  # Custom name and domain
  node tmail.js inbox <email>                   # Check inbox messages
`);
}

main();
