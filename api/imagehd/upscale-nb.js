import { randomBytes } from "node:crypto";

const BASE_URL = "https://api2.ashirwadinfotech.com:22993";
const UA = "okhttp/4.12.0";

const toBlob = async (input) => {
  let res = await fetch(input);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const html = await res.text();
    const m =
      html.match(/<img[^>]+id=["']img_preview["'][^>]+src=["']([^"']+)["']/i) ||
      html.match(/<a[^>]+class=["']download["'][^>]+href=["']([^"']+)["']/i);
    if (m) res = await fetch(m[1]);
    else return new Blob([html]);
  }
  return new Blob([await res.arrayBuffer()]);
};

const createDeviceSession = async () => {
  const id = randomBytes(8).toString("hex");
  const form = new FormData();
  form.append("android_id", id);
  form.append("app_id", "dalle2-bhargav");
  form.append("in_app", "");
  form.append("in_app_sku", "");
  form.append("app_version", "20");
  form.append("package_name", "com.bhargav.nanobananaai");
  form.append("is_premium", "false");
  form.append("fcm_token", "");
  form.append("country_code", "US");

  const res = await fetch(`${BASE_URL}/api/image/android-app-config/`, {
    method: "POST",
    headers: { "User-Agent": UA },
    body: form,
  });
  if (!res.ok) throw new Error("Device initialization failed");
  return id;
};

const pollJob = async (jobId, timeoutMs = 120000) => {
  const start = Date.now();
  const pollUrl = `${BASE_URL}/api/image/image-generator/${jobId}/`;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(pollUrl, { headers: { "User-Agent": UA } });
    const data = await res.json();
    if (data.status === "COMPLETED") return data.output;
    if (data.status === "FAILED") throw new Error(data.error || "Generation failed");
  }
  throw new Error("Polling timeout");
};

const executeTask = async ({ imageBlob, processType, trendName }) => {
  const androidId = await createDeviceSession();
  const form = new FormData();
  form.append("image", imageBlob, "input.png");
  form.append("prompt", "");
  form.append("app_id", "dalle2-bhargav");
  form.append("android_id", androidId);
  form.append("is_premium", "false");
  form.append("app_version", "20");
  form.append("process_type", processType);
  form.append("image_style", "");
  form.append("aspect_ratio", "square");
  form.append("scale", "12");
  form.append("steps", "20");
  form.append("enhance", "false");
  form.append("is_ref_image", "true");
  form.append("country_code", "US");
  form.append("trend_name", trendName);
  form.append("use_queue", "true");

  const res = await fetch(`${BASE_URL}/api/image/image-generator/`, {
    method: "POST",
    headers: { "User-Agent": UA },
    body: form,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.[0] || data.output?.[0] || "Request failed");

  const url = await pollJob(data.job_id);
  return { url, jobId: data.job_id };
};

const handler = (processType, trendName) =>
  async function run(req, res) {
    const start = Date.now();
    try {
      const params = { ...req.body, ...req.query };
      const url = String(params.url ?? "").trim();

      if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' wajib diisi" });
      }

      const imageBlob = await toBlob(url);
      const result = await executeTask({ imageBlob, processType, trendName });

      return res.json({
        status: true,
        image_url: result.url,
        metadata: { processing_time: `${Date.now() - start}ms` },
        attribution: "@zyvorapi",
      });
    } catch (err) {
      return res.status(502).json({
        status: false,
        message: err?.message || "Upstream error",
        metadata: { processing_time: `${Date.now() - start}ms` },
      });
    }
  };

export default {
  name: "NanoBanana Upscale",
  description: "Upscale & tingkatkan kualitas gambar",
  category: "Image HD",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL gambar sumber",
      example: "https://example.com/foto.jpg",
    },
  },
  run: handler("image_upscale", "Image Enhance"),
};
