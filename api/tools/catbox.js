import fs from "node:fs"
import path from "node:path"
import axios from "axios"
import FormData from "form-data"

const CATBOX_API = "https://catbox.moe/user/api.php"

export default {
  name: "CatBox Uploader",
  description: "Upload file",
  category: "Tools",
  methods: ["POST"],
  params: ["file"],
  paramsSchema: {
    file: {
      type: "file",
      required: true,
      description: "File yang akan diupload (multipart/form-data)",
    },
    userhash: {
      type: "string",
      required: false,
      description: "CatBox userhash opsional",
      example: "",
    },
  },
  async run(req, res) {
    const { userhash } = { ...req.query, ...req.body }

    const uploadedFile = req.files?.file
    if (!uploadedFile) {
      return res.json({ status: "error", message: "Parameter file wajib (multipart/form-data)" })
    }

    const filePath = uploadedFile.tempFilePath || uploadedFile.path

    try {
      const body = new FormData()
      body.append("reqtype", "fileupload")

      if (userhash?.trim()) {
        body.append("userhash", userhash)
      }

      body.append(
        "fileToUpload",
        fs.createReadStream(filePath),
        path.basename(uploadedFile.originalFilename || uploadedFile.name)
      )

      const response = await axios({
        method: "POST",
        url: CATBOX_API,
        data: body,
        timeout: 120000,
        maxBodyLength: Infinity,
        headers: {
          ...body.getHeaders(),
          "User-Agent": "NodeJS Upload Client",
        },
      })

      const uploaded =
        typeof response.data === "string" &&
        response.data.includes("https://")

      if (uploaded) {
        res.json({
          status: "success",
          data: {
            url: response.data.trim(),
            filename: uploadedFile.originalFilename || uploadedFile.name,
          },
        })
      } else {
        res.json({ status: "error", message: "Upload gagal", data: response.data })
      }
    } catch (error) {
      res.json({ status: "error", message: error.message })
    } finally {
      // Cleanup temp file
      if (filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath) } catch {}
      }
    }
  },
}