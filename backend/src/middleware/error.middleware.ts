import type { NextFunction, Request, Response } from 'express'

import multer from 'multer'
import { ZodError } from 'zod'

import { AppError } from '../types/app-error.js'

export const asyncHandler =
  (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next)
  }

export const errorHandler = (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      error: '请求参数校验失败',
      details: error.flatten()
    })
    return
  }

  if (error instanceof multer.MulterError) {
    response.status(400).json({ success: false, error: error.message })
    return
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({ success: false, error: error.message })
    return
  }

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ success: false, error: '请求体 JSON 格式不合法' })
    return
  }

  if (error instanceof Error) {
    // 定义已知的业务错误关键词，这些错误应该返回 400 而不是 500
    const businessErrorKeywords = [
      '已存在',
      '缺少',
      '无法',
      '非法路径',
      '必需文件',
      '格式不正确',
      '无效',
      '不支持',
      '超过',
      '限制'
    ]

    const isBusinessError = businessErrorKeywords.some(keyword => error.message.includes(keyword))
    const statusCode = isBusinessError ? 400 : 500

    // 开发环境返回详细错误，生产环境隐藏 500 错误详情
    const isDev = process.env.NODE_ENV !== 'production'

    response.status(statusCode).json({
      success: false,
      error: statusCode === 500 && !isDev ? '服务器内部错误' : error.message
    })
    return
  }

  response.status(500).json({ success: false, error: '服务器内部错误' })
}
