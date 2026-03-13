import { Router } from 'express'

import { requireAuth, requireRole } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { uploadRateLimiter } from '../../middleware/rate-limit.middleware.js'
import { reportUploadMiddleware } from '../../middleware/upload.middleware.js'
import { getReports, getReport, getReportSpec, uploadReportArchive } from './report.service.js'
import { logActivity } from '../activity/activity.repository.js'

export const reportRouter = Router()

reportRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_request, response) => {
    response.json({ success: true, data: getReports() })
  })
)

reportRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (request, response) => {
    const id = Number(request.params.id)
    const report = getReport(id)

    if (!report) {
      response.status(404).json({ success: false, error: '未找到对应报告' })
      return
    }

    logActivity(request.user!.id, 'view_report')

    response.json({ success: true, data: report })
  })
)

reportRouter.get(
  '/spec',
  asyncHandler(async (_request, response) => {
    response.json({ success: true, data: getReportSpec() })
  })
)

reportRouter.post(
  '/upload',
  requireAuth,
  requireRole(['admin', 'editor']),
  uploadRateLimiter,
  reportUploadMiddleware,
  asyncHandler(async (request, response) => {
    if (!request.file) {
      response.status(400).json({ success: false, error: '未提供上传文件' })
      return
    }

    const report = await uploadReportArchive({
      archivePath: request.file.path,
      uploadedBy: request.user!.id
    })

    response.status(201).json({
      success: true,
      message: '报告上传成功',
      report: {
        id: report.id,
        slug: report.slug,
        title: report.title,
        brand: report.brand,
        season: `${report.season} ${report.year}`,
        lookCount: report.lookCount
      }
    })
  })
)
