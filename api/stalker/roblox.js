export default {
  name: "Roblox Stalker",
  description: "Stalker profil player Roblox (Maintenance)",
  category: "Stalker",
  methods: ["GET", "POST"],
  async run(req, res) {
    return res.status(503).json({
      status: false,
      message: "Endpoint Roblox Stalker sedang dalam perbaikan (Maintenance) karena pembatasan rate limit dari upstream API."
    });
  }
};
