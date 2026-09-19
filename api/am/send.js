import amService from "../../src/utils/amService.js";

export default {
  name: "AlightMotion Send",
  description: "Kirim email verifikasi Alight Motion Premium",
  category: "AlightMotion",
  methods: ["GET", "POST"],
  params: ["email"],
  paramsSchema: {
    email: {
      type: "string",
      required: true,
      description: "Email tujuan untuk magic link verifikasi",
      example: "user@email.com"
    }
  },
  async run(req, res) {
    const { email } = { ...req.query, ...req.body };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({
        success: false,
        error: "Parameter 'email' wajib diisi dan harus valid"
      });
    }

    try {
      const result = await amService.sendMagicLink(email.trim());
      if (!result.success) {
        return res.status(502).json({ success: false, error: result.error || "Gagal mengirim magic link" });
      }
      return res.json({
        success: true,
        email: email.trim(),
        message: result.message
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
};
