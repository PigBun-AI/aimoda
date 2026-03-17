import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'

import { asyncHandler } from '../../middleware/error.middleware.js'
import { uploadRateLimiter } from '../../middleware/rate-limit.middleware.js'
import { uploadReportArchive, getReports } from '../reports/report.service.js'
import { findReportBySlug } from '../reports/report.repository.js'
import { config } from '../../config/index.js'

// skills 目录位于项目根目录（/app）
const SKILLS_DIR = path.resolve(process.cwd(), 'skills')

// 从外部文件读取 WWWD Report Spec Skill
const getReportSpecSkill = (): string => {
  const skillPath = path.join(SKILLS_DIR, 'wwwd-report-spec/SKILL.md')
  return fs.readFileSync(skillPath, 'utf-8')
}
// MCP JSON-RPC 2.0 types
interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// Tool definitions
const mcpTools = [
  {
    name: 'get_report_spec',
    description: '获取最新报告文件夹层级、iframe 解析规则、命名规范和元数据规则。Agent 在生成报告前应先查阅此规范。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'upload_report',
    description: '上传报告压缩包（zip）到 WWWD 平台。使用 multipart/form-data POST 到返回的 URL。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'list_reports',
    description: '查询平台上已发布的报告列表。可通过 slug 精确查找单篇报告（用于上传后验证）。',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '按 slug 精确查找（如 zimmermann-fall-2026）。省略则返回全部报告列表。'
        },
        page: { type: 'number', description: '页码，默认 1' },
        limit: { type: 'number', description: '每页条数，默认 20' }
      },
      required: []
    }
  }
] as const

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB limit
  }
})

export const mcpRouter = Router()

// MCP HTTP endpoint (JSON-RPC 2.0)
mcpRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const mcpRequest = request.body as MCPRequest

    // Validate JSON-RPC 2.0 request
    if (!mcpRequest.jsonrpc || mcpRequest.jsonrpc !== '2.0') {
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: mcpRequest.id ?? 0,
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc version must be "2.0"'
        }
      }
      response.status(400).json(errorResponse)
      return
    }

    const { id, method, params } = mcpRequest

    try {
      // Handle methods
      switch (method) {
        case 'initialize': {
          // MCP protocol initialization
          const result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'wwwd-mcp-server',
              version: '1.0.0'
            }
          }
          response.json({ jsonrpc: '2.0', id, result })
          return
        }

        case 'tools/list': {
          const result = {
            tools: mcpTools.map(tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema
            }))
          }
          response.json({ jsonrpc: '2.0', id, result })
          return
        }

        case 'tools/call': {
          const toolName = params?.name as string
          const toolArgs = (params?.arguments as Record<string, unknown>) || {}

          if (!toolName) {
            response.json({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32602,
                message: 'Missing tool name'
              }
            })
            return
          }

          switch (toolName) {
            case 'get_report_spec': {
              const skillContent = getReportSpecSkill()
              const result = {
                content: [
                  {
                    type: 'text',
                    text: skillContent
                  }
                ]
              }
              response.json({ jsonrpc: '2.0', id, result })
              return
            }

            case 'upload_report': {
              const serverUrl = config.SERVER_URL || 'http://localhost:38180'
              const result = {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      uploadUrl: `${serverUrl}/api/mcp/upload`,
                      method: 'POST',
                      contentType: 'multipart/form-data',
                      fields: {
                        file: '(二进制文件，必需)',
                        uploadedBy: '(用户ID，可选，默认1)'
                      }
                    }, null, 2)
                  }
                ]
              }
              response.json({ jsonrpc: '2.0', id, result })
              return
            }

            case 'list_reports': {
              const slug = toolArgs.slug as string | undefined

              const sanitize = (r: { id: number; slug: string; title: string; brand: string; season: string; year: number; lookCount: number; createdAt: string; updatedAt: string }) => ({
                id: r.id,
                slug: r.slug,
                title: r.title,
                brand: r.brand,
                season: r.season,
                year: r.year,
                lookCount: r.lookCount,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt
              })

              if (slug) {
                const report = findReportBySlug(slug)
                const payload = report
                  ? { found: true, report: sanitize(report) }
                  : { found: false, slug, message: `未找到 slug 为 "${slug}" 的报告` }
                response.json({
                  jsonrpc: '2.0', id,
                  result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
                })
                return
              }

              const page = Number(toolArgs.page) || 1
              const limit = Number(toolArgs.limit) || 20
              const { reports, total } = getReports(page, limit)
              const payload = {
                reports: reports.map(sanitize),
                pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
              }
              response.json({
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
              })
              return
            }

            default: {
              response.json({
                jsonrpc: '2.0',
                id,
                error: {
                  code: -32601,
                  message: `Tool not found: ${toolName}`
                }
              })
              return
            }
          }
        }

        default: {
          response.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`
            }
          })
          return
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      response.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: errorMessage
        }
      })
    }
  })
)

// Alternative: Direct file upload endpoint for MCP
mcpRouter.post(
  '/upload',
  uploadRateLimiter,
  upload.single('file'),
  asyncHandler(async (request, response) => {
    if (!request.file) {
      response.status(400).json({
        success: false,
        error: '未提供上传文件'
      })
      return
    }

    const report = await uploadReportArchive({
      archivePath: request.file.path,
      uploadedBy: Number(request.body.uploadedBy) || 1
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