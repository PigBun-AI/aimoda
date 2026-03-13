import fs from 'node:fs'

import multer from 'multer'

import { config } from '../config/index.js'

fs.mkdirSync(config.UPLOAD_TMP_DIR, { recursive: true })

const upload = multer({
  dest: config.UPLOAD_TMP_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    const isZipMimeType = ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'].includes(file.mimetype)
    const hasZipExtension = file.originalname.toLowerCase().endsWith('.zip')

    if (!isZipMimeType && !hasZipExtension) {
      callback(new Error('仅支持上传 zip 压缩包'))
      return
    }

    callback(null, true)
  }
})

export const reportUploadMiddleware = upload.single('file')
