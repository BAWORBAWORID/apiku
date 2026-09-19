/**
 * XL Check API
 *
 * GET /checknumber/xlcheck?number=081915895220
 * POST /checknumber/xlcheck
 *
 * Base: https://xl-ku.my.id/
 * Creator: Nimzz
 */

import axios from "axios"
import logger from "../../src/utils/logger.js"

export default {
  name: "XL Check",
  description: "Cek informasi nomor kartu XL/Axis — paket, kuota, masa aktif",
  category: "Check Number",
  methods: ["GET", "POST"],
  params: ["number"],

  paramsSchema: {
    number: {
      type: "string",
      required: true,
      description: "Nomor XL/Axis (format: 08xxx atau 628xxx)",
      example: "081915895220",
    },
  },

  async run(req, res) {
    try {
      const number = req.query?.number || req.body?.number

      if (!number) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'number' wajib diisi",
        })
      }

      const cleanNumber = number.replace(/\D/g, "")
      const formatted = cleanNumber.startsWith("628")
        ? "0" + cleanNumber.slice(2)
        : cleanNumber

      const { data } = await axios.get("https://xl-ku.my.id/end.php", {
        params: {
          check: "package",
          number: formatted,
          version: "2",
        },
        timeout: 15000,
      })

      if (!data.success) {
        return res.status(400).json({
          status: false,
          message: data.message || "Gagal cek paket XL",
        })
      }

      const info = data.data.subs_info
      const packages = data.data.package_info.packages

      const result = {
        nomor: info.msisdn,
        operator: info.operator,
        jaringan: info.net_type,
        masa_aktif: info.tenure,
        masa_berakhir: info.exp_date,
        tenggang_hingga: info.grace_until,
        volte: info.volte,
        paket: packages.map((pkg) => ({
          nama: pkg.name,
          berakhir: pkg.expiry,
          kuota: pkg.quotas
            .filter(
              (q) =>
                parseFloat(q.remaining) > 0 ||
                q.remaining.includes("Menit")
            )
            .map((q) => ({
              nama: q.name,
              total: q.total,
              sisa: q.remaining,
              persen: q.percent.toFixed(1) + "%",
            })),
        })),
      }

      logger.info(`[XL-CHECK] success | ip=${req.ip} | number=${formatted}`)

      return res.json({
        status: true,
        result: result,
      })
    } catch (error) {
      logger.error(
        `[XL-CHECK] Error | ip=${req.ip} | error=${error.message}`
      )
      return res.status(500).json({
        status: false,
        message: error.message || "Failed to check XL number",
      })
    }
  },
}
