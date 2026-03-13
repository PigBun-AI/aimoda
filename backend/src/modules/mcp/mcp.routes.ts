import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'

import { asyncHandler } from '../../middleware/error.middleware.js'
import { uploadRateLimiter } from '../../middleware/rate-limit.middleware.js'
import { uploadReportArchive } from '../reports/report.service.js'

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
    description: '上传报告压缩包（zip），支持两种方式：1) base64Content: 传入 base64 编码的文件内容；2) 通过 /api/mcp/upload 端点进行 HTTP multipart 上传。推荐使用 multipart 方式上传大文件。',
    inputSchema: {
      type: 'object',
      properties: {
        base64Content: {
          type: 'string',
          description: 'ZIP 文件的 Base64 编码内容（可选，与 filePath 二选一）'
        },
        fileName: {
          type: 'string',
          description: '文件名，例如 report.zip'
        },
        uploadedBy: {
          type: 'number',
          description: '上传者用户 ID',
          default: 1
        }
      },
      required: ['fileName']
    }
  },
  {
    name: 'get_upload_url',
    description: '获取一个预签名的上传 URL，用于大文件上传。支持 PUT 方法上传文件。',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '要上传的文件名'
        },
        contentType: {
          type: 'string',
          description: '文件的 MIME 类型',
          default: 'application/zip'
        }
      },
      required: ['fileName']
    }
  }
] as const

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
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
              const base64Content = toolArgs.base64Content as string | undefined
              const fileName = toolArgs.fileName as string | undefined

              if (!fileName) {
                response.json({
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32602,
                    message: 'Missing required parameter: fileName'
                  }
                })
                return
              }

              const uploadedBy = (toolArgs.uploadedBy as number) || 1

              // Handle base64 content
              if (base64Content) {
                // Decode base64 and write to temp file
                const buffer = Buffer.from(base64Content, 'base64')
                const tempPath = `/tmp/${Date.now()}-${fileName}`
                fs.writeFileSync(tempPath, buffer)

                try {
                  const report = await uploadReportArchive({
                    archivePath: tempPath,
                    uploadedBy
                  })

                  const result = {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify({
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
                        }, null, 2)
                      }
                    ]
                  }
                  response.json({ jsonrpc: '2.0', id, result })
                } finally {
                  // Clean up temp file
                  fs.rmSync(tempPath, { force: true })
                }
                return
              }

              // If no base64, suggest using multipart upload
              response.json({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        error: '请使用以下方式上传文件：',
                        methods: [
                          '1. 通过 base64Content 参数传入文件的 Base64 编码',
                          '2. 通过 HTTP POST 到 /api/mcp/upload 端点进行 multipart 上传'
                        ],
                        uploadEndpoint: '/api/mcp/upload',
                        example: {
                          method: 'multipart',
                          contentType: 'multipart/form-data',
                          fieldName: 'file'
                        }
                      }, null, 2)
                    }
                  ]
                }
              })
              return
            }

            case 'get_upload_url': {
              // For now, return the direct upload URL
              const uploadFileName = toolArgs.fileName as string
              const result = {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      message: '请使用 multipart 方式上传文件',
                      uploadUrl: '/api/mcp/upload',
                      method: 'POST',
                      contentType: 'multipart/form-data',
                      fields: {
                        file: '(二进制文件)',
                        uploadedBy: '(用户ID，可选，默认1)'
                      }
                    }, null, 2)
                  }
                ]
              }
              response.json({ jsonrpc: '2.0', id, result })
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