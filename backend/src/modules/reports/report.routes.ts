import { Router } from 'express'

import { requireAuth, requireRole } from '../../middleware/auth.middleware.js'
import { asyncHandler } from '../../middleware/error.middleware.js'
import { uploadRateLimiter } from '../../middleware/rate-limit.middleware.js'
import { reportUploadMiddleware } from '../../middleware/upload.middleware.js'
import { checkReportViewPermission, getViewStatus } from '../../middleware/permission.middleware.js'
import { deleteReport, getReports, getReport, getReportSpec, uploadReportArchive } from './report.service.js'
import { logActivity } from '../activity/activity.repository.js'

export const reportRouter = Router()

// 获取报告列表
reportRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (request, response) => {
    const page = Number(request.query.page) || 1
    const limit = Number(request.query.limit) || 12
    const result = getReports(page, limit)
    response.json({ success: true, data: result.reports, meta: { total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) } })
  })
)

// 获取查看状态
reportRouter.get(
  '/view-status',
  requireAuth,
  asyncHandler(async (request, response) => {
    const status = getViewStatus(request.user!.id, request.user!.role)
    response.json({ success: true, data: status })
  })
)

// 获取单个报告 - 添加查看权限检查
reportRouter.get(
  '/:id',
  requireAuth,
  checkReportViewPermission,
  asyncHandler(async (request, response) => {
    const id = Number(request.params.id)
    const report = getReport(id)

    if (!report) {
      response.status(404).json({ success: false, error: '未找到对应报告' })
      return
    }

    logActivity(request.user!.id, 'view_report')

    // 返回查看状态信息
    const viewStatus = getViewStatus(request.user!.id, request.user!.role)

    response.json({
      success: true,
      data: report,
      meta: { viewStatus }
    })
  })
)

// 获取报告规范
reportRouter.get(
  '/spec',
  asyncHandler(async (_request, response) => {
    response.json({ success: true, data: getReportSpec() })
  })
)

// 上传报告
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

// 删除报告
reportRouter.delete(
  '/:id',
  requireAuth,
  requireRole(['admin']),
  asyncHandler(async (request, response) => {
    const id = Number(request.params.id)

    if (Number.isNaN(id)) {
      response.status(400).json({ success: false, error: '无效的报告 ID' })
      return
    }

    const deleted = deleteReport(id)

    if (!deleted) {
      response.status(404).json({ success: false, error: '未找到对应报告' })
      return
    }

    response.json({ success: true, message: '报告删除成功' })
  })
)