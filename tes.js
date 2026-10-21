import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEY_FILE = path.resolve(__dirname, 'data/key-reach.json');
const API_ENDPOINT = 'https://apiv2.reactionwa.online/api/v2/react';
const GENERATE_ENDPOINT = 'https://apiv2.reactionwa.online/api/v2/generate_key';

const LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)\/(\d+)/i;
const EMOJI_REGEX = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?/gu;

const VIP_PROFILES = [
    {
        vipKey: 'VIP-SYNOZG8C',
        email: 'abovezephyrax@gmail.com',
        uid: 'syNOzg8C4dfMq8CwnE0inNDNdwn1',
        domain: 'https://reactionwa.online'
    },
    {
        vipKey: 'VIP-G3FA579P',
        email: 'berrymodapk@gmail.com',
        uid: 'G3FA579Px5MLiC4zISunSqergX43',
        domain: 'https://berrymodapk.com'
    }
];

function loadKey() {
    if (fs.existsSync(KEY_FILE)) {
        try {
            const raw = fs.readFileSync(KEY_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.apiKey) {
                return data;
            }
        } catch {}
    }
    return { ...VIP_PROFILES[0] };
}

function saveKey(keyData) {
    try {
        fs.writeFileSync(KEY_FILE, JSON.stringify(keyData, null, 2));
    } catch (err) {
        console.error('Gagal menyimpan key ke key.json:', err.message);
    }
}

async function generateApiKey(profileIndex = 0) {
    const profile = VIP_PROFILES[profileIndex] || VIP_PROFILES[0];
    const response = await axios.post(GENERATE_ENDPOINT, {
        vipKey: profile.vipKey,
        email: profile.email,
        domain: profile.domain,
        uid: profile.uid
    }, {
        headers: {
            'Content-Type': 'application/json'
        },
        timeout: 15000
    });

    if (response.data && response.data.success && response.data.apiKey) {
        const keyData = {
            vipKey: profile.vipKey,
            email: profile.email,
            uid: profile.uid,
            domain: profile.domain,
            apiKey: response.data.apiKey,
            updatedAt: new Date().toISOString()
        };
        saveKey(keyData);
        return keyData;
    }

    throw new Error(response.data?.message || 'Gagal generate API Key');
}

function isLimitReached(msg) {
    if (!msg) return false;
    const lower = String(msg).toLowerCase();
    return lower.includes('limit') ||
           lower.includes('kuota') ||
           lower.includes('habis') ||
           lower.includes('depleted') ||
           lower.includes('quota');
}

function normalizeUrl(inputUrl) {
    const match = String(inputUrl || '').match(LINK_REGEX);
    if (!match) return null;
    return `https://whatsapp.com/channel/${match[1]}/${match[2]}`;
}

function parseEmojis(inputEmoji) {
    const str = String(inputEmoji || '');
    const matches = str.match(EMOJI_REGEX);
    if (!matches || matches.length === 0) return null;
    return matches.slice(0, 5).join(', ');
}

async function sendReactionRequest(targetUrl, reactionText, keyObj) {
    const origin = keyObj.domain === '*' ? 'https://reactionwa.online' : keyObj.domain;
    const referer = origin.endsWith('/') ? origin : origin + '/';

    const response = await axios.post(API_ENDPOINT, {
        url: targetUrl,
        reaction: reactionText
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': origin,
            'Referer': referer,
            'x-api-key': keyObj.apiKey,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
        },
        timeout: 45000
    });

    return response.data;
}

async function react(targetUrl, reactionInput) {
    const startTime = Date.now();
    const normalizedUrl = normalizeUrl(targetUrl);
    if (!normalizedUrl) {
        return {
            status: false,
            time: `${Date.now() - startTime}ms`,
            error: 'Format URL WhatsApp Channel tidak valid. Contoh: https://whatsapp.com/channel/0029Vb8vO7o2f3EEsjefzm0w/243'
        };
    }

    const emojiString = parseEmojis(reactionInput);
    if (!emojiString) {
        return {
            status: false,
            time: `${Date.now() - startTime}ms`,
            error: 'Emoji tidak valid atau kosong. Masukkan minimal 1 emoji (contoh: "👍" atau "❤️").'
        };
    }

    let keyData = loadKey();
    if (!keyData || !keyData.apiKey) {
        keyData = await generateApiKey(0);
    }

    let attempts = 0;
    const maxAttempts = 2;
    let lastError = 'Terjadi kesalahan pada server';

    while (attempts < maxAttempts) {
        try {
            const result = await sendReactionRequest(normalizedUrl, emojiString, keyData);

            if (result && (result.success === true || result.status === 'success')) {
                const task = (result.data && result.data.task) || {};
                const vipInfo = (result.data && result.data.vip) || {};

                return {
                    status: true,
                    time: `${Date.now() - startTime}ms`,
                    message: result.message || 'Reaction VIP API masuk antrean.',
                    data: {
                        target: normalizedUrl,
                        emojis: task.reaction_code || emojiString,
                        vip_package: vipInfo.packageName || 'VIP Permanent',
                        usage_today: result.usage_today || null,
                        limit: result.limit || 50
                    }
                };
            }

            if (result && result.error) {
                lastError = result.error;
                if (isLimitReached(lastError) && attempts === 0) {
                    keyData = await generateApiKey(0);
                    attempts++;
                    continue;
                }
            }
        } catch (err) {
            const errData = err.response && err.response.data;
            if (errData && errData.error) {
                lastError = errData.error;
            } else {
                lastError = err.message || 'Terjadi kesalahan pada server';
            }

            if (isLimitReached(lastError) && attempts === 0) {
                try {
                    keyData = await generateApiKey(0);
                    attempts++;
                    continue;
                } catch (genErr) {
                    lastError = `Limit habis & gagal generate key baru: ${genErr.message}`;
                    break;
                }
            }
        }

        attempts++;
    }

    return {
        status: false,
        time: `${Date.now() - startTime}ms`,
        error: lastError
    };
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage:\n node tes.js <link> <emoji>');
        process.exit(1);
    }

    const [url, emoji] = args;
    const res = await react(url, emoji);
    console.log(JSON.stringify(res, null, 2));
    if (!res.status) {
        process.exit(1);
    }
}

export {
    react,
    generateApiKey,
    loadKey,
    saveKey,
    normalizeUrl,
    parseEmojis
};

export default {
    react,
    generateApiKey,
    loadKey,
    saveKey,
    normalizeUrl,
    parseEmojis
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main();
}
