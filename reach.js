import axios from "axios";
import crypto from "crypto";

const baseUrl = "https://react.v1.zfile.web.id";

async function sendReaction(url, emoji) {
  const requestId = `req-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const payload = {
    url: url,
    reaction: [emoji],
    agreeTerms: true,
    requestId: requestId
  };

  try {
    console.log(`[+] Mengirim reaksi '${emoji}' ke: ${url}`);
    const response = await axios.post(`${baseUrl}/api/react`, payload, {
      headers: {
        "Content-Type": "application/json",
        "Origin": baseUrl,
        "Referer": `${baseUrl}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const data = response.data;
    console.log(`[+] Respons API:`, data);

    if (data.success) {
      console.log(`[+] Reaksi diterima! Memeriksa status antrean...`);
      await checkQueue(requestId);
    } else {
      console.log(`[-] Gagal: ${data.message} (Code: ${data.code})`);
    }
  } catch (error) {
    if (error.response) {
      console.log(`[-] Error dari server:`, error.response.data);
    } else {
      console.log(`[-] Request error:`, error.message);
    }
  }
}

async function checkQueue(requestId) {
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await axios.get(`${baseUrl}/api/queue-status?requestId=${requestId}`, {
        headers: {
          "Origin": baseUrl,
          "Referer": `${baseUrl}/`
        }
      });
      
      const data = res.data;
      console.log(`[Queue ${attempts}] Status: ${data.status} | Pesan: ${data.message || "-"}`);

      if (data.status === "COMPLETED" || data.status === "completed") {
        console.log(`[+] Sukses mengirim reaksi!`);
        break;
      } else if (data.status === "FAILED" || data.status === "failed") {
        console.log(`[-] Gagal diproses dalam antrean.`);
        break;
      }
      
      // Tunggu 3 detik sebelum cek lagi
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.log(`[-] Error cek antrean: ${err.message}`);
      break;
    }
  }
}

// Eksekusi CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Penggunaan: node tes.js <link_whatsapp_channel> <emoji>");
  console.log("Contoh: node tes.js https://whatsapp.com/channel/0029VbCV1ck8fewpdNb2TY2k/748 👍");
  process.exit(1);
}

const targetUrl = args[0];
const targetEmoji = args[1];

sendReaction(targetUrl, targetEmoji);
