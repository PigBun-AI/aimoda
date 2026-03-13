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
    const statusCode = error.message.includes('已存在') || error.message.includes('缺少') || error.message.includes('无法') || error.message.includes('非法路径')
      ? 400
      : 500

    response.status(statusCode).json({
      success: false,
      error: statusCode === 500 ? '服务器内部错误' : error.message
    })
    return
  }

  response.status(500).json({ success: false, error: '服务器内部错误' })
}
