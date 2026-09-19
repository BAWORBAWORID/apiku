/**
 * Jolly AI Chat
 * Provider: chat.jollyai.online (jollygenapi.space)
 * Parameter: text, guest_hash
 * NO API KEY — guest quota 3 per hash, auto-rotate
 */

import crypto from "crypto";

const API = "https://jollygenapi.space/ai";
const ORIGIN = "https://chat.jollyai.online";
const GUEST_LIMIT = 3;

function getGuestHash() {
  return crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
}

async function getUsage(guestHash) {
  const r = await fetch(`${API}/usage-guest?guest_hash=${encodeURIComponent(guestHash)}`);
  if (!r.ok) return { used: 0, limit: GUEST_LIMIT };
  const d = await r.json();
  return { used: d.chat?.used || 0, limit: GUEST_LIMIT };
}

async function chat(message, guestHash) {
  const res = await fetch(API + "/chat-guest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN
    },
    body: JSON.stringify({ message, stream: true, guest_hash: guestHash }),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    const msg = d?.detail?.message || d?.detail || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", answer = "", doneUsage = null, streamErr = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const rawEvent = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = rawEvent.split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      let obj;
      try { obj = JSON.parse(data); } catch { continue; }
      if (obj.delta) {
        answer += obj.delta;
      } else if (obj.error) {
        streamErr = obj.error;
      } else if (obj.done) {
        doneUsage = obj.usage;
      }
    }
  }
  if (!answer && streamErr) throw new Error(streamErr);
  return { answer: stripLinks(answer), usage: doneUsage };
}

function stripLinks(text) {
  return String(text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/https?:\/\/[^\s)\]]+/g, "")
    .replace(/\*{2,}/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default {
  name: "Jolly AI Chat",
  description: "Chat dengan Jolly AI (image/video generator assistant) — guest mode, hash dibuat otomatis setiap request",
  category: "AI CHAT",
  methods: ["GET", "POST"],
  params: ["text"],
  paramsSchema: {
    text: {
      type: "string",
      required: true,
      description: "Pesan untuk AI",
      example: "Halo, siapa kamu?",
      minLength: 1,
      maxLength: 2000
    }
  },

  async run(req, res) {
    const { text } = { ...req.query, ...req.body };

    if (!text) {
      return res.status(400).json({ success: false, error: "Parameter text wajib diisi" });
    }

    try {
      const guestHash = getGuestHash();
      const { answer, usage: u } = await chat(text, guestHash);
      const used = u?.used || 1;

      return res.json({
        success: true,
        result: {
          answer,
          usage: { used, limit: GUEST_LIMIT }
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
};
