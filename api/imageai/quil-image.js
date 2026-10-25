import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { accessSync, constants } from "fs";

const SCRAPER = join(dirname(fileURLToPath(import.meta.url)), "../../scrape/quil-image.js");
const SCRAPER_DIR = dirname(SCRAPER);

const STYLES = ["Auto", "3D Scene", "Anime", "Artistic", "Cinematic", "Digital Art", "Educational", "Fantasy World", "Prototyping & Mockup", "Realism"];
const ASPECTS = ["Auto", "1:1", "4:3", "3:4", "16:9", "9:16"];

const ASPECT_MAP = {
  "Auto": [1024, 1024],
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
};

const STYLE_PREFIX = {
  "3D Scene": "3D scene render, ",
  "Anime": "anime style illustration, ",
  "Artistic": "artistic painting, ",
  "Cinematic": "cinematic film still, ",
  "Digital Art": "digital art, ",
  "Educational": "educational illustration, ",
  "Fantasy World": "fantasy world concept art, ",
  "Prototyping & Mockup": "UI mockup design, ",
  "Realism": "photorealistic, ",
};

function runScraper(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [SCRAPER, ...args], { cwd: SCRAPER_DIR });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Request timed out"));
    }, timeoutMs);

    proc.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(stderr.trim() || "Script failed"));
      }
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

export default {
  name: "Quillbot Image Generator",
  description: "Generate gambar AI dengan berbagai style dan aspect ratio",
  category: "Image AI",
  methods: ["GET", "POST"],
  params: ["prompt", "style", "aspect"],
  paramsSchema: {
    prompt: {
      type: "string",
      required: true,
      description: "Deskripsi gambar yang ingin di-generate",
      example: "a cat sitting gracefully",
      minLength: 3,
      maxLength: 500,
    },
    style: {
      type: "string",
      required: false,
      description: `Style gambar. Default: Auto. Pilihan: ${STYLES.join(", ")}`,
      example: "Anime",
      default: "Auto",
    },
    aspect: {
      type: "string",
      required: false,
      description: `Aspect ratio. Default: Auto. Pilihan: ${ASPECTS.join(", ")}`,
      example: "1:1",
      default: "Auto",
    },
  },

  async run(req, res) {
    let { prompt, style = "Auto", aspect = "Auto" } = { ...req.query, ...req.body };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib diisi" });
    }

    prompt = prompt.trim();
    style = (style || "Auto").trim();
    aspect = (aspect || "Auto").trim();

    if (!STYLES.includes(style)) {
      return res.status(400).json({ status: false, message: `Style tidak valid. Pilihan: ${STYLES.join(", ")}` });
    }
    if (!ASPECTS.includes(aspect)) {
      return res.status(400).json({ status: false, message: `Aspect ratio tidak valid. Pilihan: ${ASPECTS.join(", ")}` });
    }

    // Primary: scraper quillbot (jika file scraper tersedia)
    let generator = "pollinations-fallback";
    try {
      accessSync(SCRAPER, constants.F_OK);
      const data = await runScraper(["--prompt", prompt, "--style", style, "--aspect", aspect]);
      if (data.success && data.images?.length) {
        return res.json({
          status: true,
          result: {
            prompt: data.prompt,
            style: data.style,
            aspect: data.aspectRatio,
            images: data.images,
            count: data.imageCount,
          },
        });
      }
    } catch {
      // scraper tidak ada / gagal → fallback di bawah
    }

    // Fallback: Pollinations (proxy binary, tanpa API key)
    try {
      const [w, h] = ASPECT_MAP[aspect] || [1024, 1024];
      const styled = (STYLE_PREFIX[style] || "") + prompt;
      const seed = Math.floor(Math.random() * 1_000_000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;

      // Pollinations kadang balik 402/429 rate-limit per-IP → retry hingga 3x dengan seed baru
      let buf = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            signal: AbortSignal.timeout(90000),
          });
          if (r.ok) {
            buf = Buffer.from(await r.arrayBuffer());
            break;
          }
          lastErr = new Error(`Upstream ${r.status}`);
          await new Promise((s) => setTimeout(s, 3000 * (attempt + 1)));
        } catch (e) {
          lastErr = e;
        }
      }
      if (!buf) throw lastErr || new Error("Gagal mengambil gambar");

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", buf.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-Image-Generator", generator);
      res.setHeader("X-Prompt", prompt);
      return res.send(buf);
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: `Gagal generate gambar: ${err.message}`,
      });
    }
  },
};
