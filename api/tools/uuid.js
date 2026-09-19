import crypto from 'crypto';

export default {
  name: "UUID Generator",
  description: "UUID v4 generator",
  category: "Tools",
  methods: ["GET", "POST"],

  params: ["count", "upper"],

  paramsSchema: {
    count: {
      type: "number",
      required: false,
      default: 1,
      min: 1,
      max: 50,
      description: "Number of UUIDs to generate"
    },
    upper: {
      type: "boolean",
      required: false,
      default: false,
      description: "Uppercase output (true/false)"
    }
  },

  async run(req, res) {
    try {
      const { count: rawCount, upper: rawUpper } = { ...req.query, ...req.body };

      let count = parseInt(rawCount) || 1;
      if (count < 1) count = 1;
      if (count > 50) {
        return res.status(400).json({
          status: false,
          message: "Maximum count is 50"
        });
      }

      const upper = rawUpper === true || rawUpper === 'true' || rawUpper === '1';

      const uuids = [];
      for (let i = 0; i < count; i++) {
        let id = crypto.randomUUID();
        if (upper) id = id.toUpperCase();
        uuids.push(id);
      }

      return res.json({
        status: true,
        result: count === 1 ? { uuid: uuids[0], version: 4 } : { count, uuids, version: 4 }
      });
    } catch (e) {
      return res.status(500).json({
        status: false,
        message: e.message || "UUID generation failed"
      });
    }
  }
};
