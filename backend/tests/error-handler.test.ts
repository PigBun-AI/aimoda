import { describe, expect, it, vi } from 'vitest'

import { errorHandler } from '../src/middleware/error.middleware.js'

describe('error handler', () => {
  it('returns generic message for unexpected errors', () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }

    errorHandler(new Error('unexpected failure'), {} as never, response as never, vi.fn())

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({ success: false, error: '服务器内部错误' })
  })

  it('returns validation error details for known client errors', () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    }

    errorHandler(new Error('缺少必需文件 index.html'), {} as never, response as never, vi.fn())

    expect(response.status).toHaveBeenCalledWith(400)
  })
})
