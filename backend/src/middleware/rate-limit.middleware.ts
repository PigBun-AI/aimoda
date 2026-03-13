import rateLimit from 'express-rate-limit'
import type { Request } from 'express'

// 获取真实 IP（支持 Cloudflare 代理）
const getRealIp = (request: Request): string => {
  // Cloudflare 传递的真实 IP
  const cfIp = request.headers['cf-connecting-ip']
  if (cfIp && typeof cfIp === 'string') {
    return cfIp
  }
  // 通用代理 IP
  const forwarded = request.headers['x-forwarded-for']
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return request.ip ?? 'unknown'
}

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 500, // 增加到 500 次
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => getRealIp(request),
  message: {
    success: false,
    error: '请求过于频繁，请稍后重试'
  }
})

export const authLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 50, // 增加到 50 次（支持 CDN 代理场景）
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => getRealIp(request),
  message: {
    success: false,
    error: '登录请求过于频繁，请稍后重试'
  }
})

export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 50, // 增加到 50 次
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (request) => getRealIp(request),
  message: {
    success: false,
    error: '上传请求过于频繁，请稍后重试'
  }
})
