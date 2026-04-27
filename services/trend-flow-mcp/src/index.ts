#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

import { authMiddleware } from './auth.js'
import { CONFIG } from './config.js'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

const args = process.argv.slice(2)
const transportArg = args.find((arg) => arg.startsWith('--transport='))
const transportMode = transportArg?.split('=')[1] ?? 'http'

function logEvent(event: string, payload: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'trend-flow-mcp',
    event,
    ...payload,
  }))
}

function formatErrorPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function internalHeaders(extraHeaders: Record<string, string> = {}) {
  return {
    'X-Internal-Token': CONFIG.BACKEND_INTERNAL_TOKEN,
    'X-Internal-Service': CONFIG.BACKEND_INTERNAL_SERVICE_NAME,
    ...extraHeaders,
  }
}

async function callInternalApi<T>(
  path: string,
  init: RequestInit,
  meta: Record<string, unknown>,
): Promise<T> {
  const start = Date.now()
  const response = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
    ...init,
    headers: internalHeaders((init.headers ?? {}) as Record<string, string>),
  })

  const rawText = await response.text()
  let payload: unknown = rawText
  try {
    payload = rawText ? JSON.parse(rawText) : null
  } catch {
    payload = rawText
  }

  logEvent('backend_call', {
    path,
    status: response.status,
    ok: response.ok,
    duration_ms: Date.now() - start,
    ...meta,
  })

  if (!response.ok) {
    throw new Error(`${meta.operation ?? path} failed (${response.status}): ${formatErrorPayload(payload)}`)
  }

  return payload as T
}

async function proxyGetTrendFlowSpec() {
  const payload = await callInternalApi<{ success: boolean; spec: JsonObject }>(
    '/api/internal/trend-flow-mcp/spec',
    { method: 'GET' },
    { operation: 'get_trend_flow_spec' },
  )
  return payload.spec
}

async function proxyGetTrendFlowTemplate() {
  const payload = await callInternalApi<{ success: boolean; template: JsonObject }>(
    '/api/internal/trend-flow-mcp/template',
    { method: 'GET' },
    { operation: 'get_trend_flow_template' },
  )
  return payload.template
}

async function proxyListTrendFlows(slug?: string, page = 1, limit = 20, q?: string) {
  const params = new URLSearchParams()
  if (slug) {
    params.set('slug', slug)
  } else {
    params.set('page', String(page))
    params.set('limit', String(limit))
    if (q?.trim()) {
      params.set('q', q.trim())
    }
  }

  return callInternalApi<JsonObject>(
    `/api/internal/trend-flow-mcp/items?${params.toString()}`,
    { method: 'GET' },
    { operation: 'list_trend_flows', slug: slug ?? null, page, limit, q: q ?? null },
  )
}

async function proxyPrepareTrendFlowUpload(filename: string, fileSizeBytes: number, contentType = 'application/zip') {
  return callInternalApi<JsonObject>(
    '/api/internal/trend-flow-mcp/upload/prepare',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        file_size_bytes: fileSizeBytes,
        content_type: contentType,
      }),
    },
    { operation: 'prepare_trend_flow_upload', filename, size_bytes: fileSizeBytes },
  )
}

async function proxyCompleteTrendFlowUpload(jobId: string, objectKey?: string) {
  return callInternalApi<JsonObject>(
    '/api/internal/trend-flow-mcp/upload/complete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        object_key: objectKey ?? null,
      }),
    },
    { operation: 'complete_trend_flow_upload', job_id: jobId, object_key: objectKey ?? null },
  )
}

async function proxyGetTrendFlowUploadStatus(jobId: string) {
  return callInternalApi<JsonObject>(
    `/api/internal/trend-flow-mcp/upload-jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET' },
    { operation: 'get_trend_flow_upload_status', job_id: jobId },
  )
}

function toolSuccess(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  }
}

function toolError(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: (err as Error).message }) }],
    isError: true,
  }
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'aimoda-trend-flow', version: '2.0.0' })

  server.tool(
    'get_trend_flow_spec',
    '获取趋势流动 ZIP 打包规范，包含 manifest、时间轴要求、目录结构，以及 template 或正文 data-aimoda-cover-fragment 封面标记规范。',
    {},
    async () => {
      try {
        return toolSuccess(await proxyGetTrendFlowSpec())
      } catch (err) {
        return toolError(err)
      }
    },
  )

  server.tool(
    'get_trend_flow_template',
    '获取趋势流动 ZIP 模板，含 entryHtml 内的 cover template 示例；如果封面就是正文 C 区块，也可用 data-aimoda-cover-fragment 标记该区块。',
    {},
    async () => {
      try {
        return toolSuccess(await proxyGetTrendFlowTemplate())
      } catch (err) {
        return toolError(err)
      }
    },
  )

  server.tool(
    'prepare_trend_flow_upload',
    '创建趋势流动 ZIP 的直传 OSS 上传任务。返回 job 信息、预签名 PUT URL、必需 headers 和 objectKey；调用方应将 zip 文件直接上传到 upload.url，然后调用 complete_trend_flow_upload。',
    {
      filename: z.string().min(1).describe('zip 文件名'),
      file_size_bytes: z.number().int().positive().describe('zip 文件大小（字节）'),
      content_type: z.string().optional().default('application/zip').describe('上传内容类型'),
    },
    async (toolArgs) => {
      try {
        return toolSuccess(await proxyPrepareTrendFlowUpload(
          toolArgs.filename,
          toolArgs.file_size_bytes,
          toolArgs.content_type ?? 'application/zip',
        ))
      } catch (err) {
        return toolError(err)
      }
    },
  )

  server.tool(
    'complete_trend_flow_upload',
    '在调用方完成 OSS 直传后，通知平台开始异步处理趋势流动 ZIP。输入 prepare_trend_flow_upload 返回的 job_id；可选回传 object_key 做一致性校验。',
    {
      job_id: z.string().min(1).describe('prepare_trend_flow_upload 返回的 job_id'),
      object_key: z.string().optional().describe('可选，prepare_trend_flow_upload 返回的 objectKey'),
    },
    async (toolArgs) => {
      try {
        return toolSuccess(await proxyCompleteTrendFlowUpload(toolArgs.job_id, toolArgs.object_key))
      } catch (err) {
        return toolError(err)
      }
    },
  )

  server.tool(
    'get_trend_flow_upload_status',
    '查询趋势流动异步上传/处理任务状态。返回 pending / processing / completed / failed，以及成功后的 trend_flow_id / trend_flow_slug。',
    {
      job_id: z.string().min(1).describe('上传任务 job_id'),
    },
    async (toolArgs) => {
      try {
        return toolSuccess(await proxyGetTrendFlowUploadStatus(toolArgs.job_id))
      } catch (err) {
        return toolError(err)
      }
    },
  )

  server.tool(
    'list_trend_flows',
    '查询平台上已发布的趋势流动。可传 slug 精确查找单条，也可按分页和关键词搜索。',
    {
      slug: z.string().optional().describe('按 slug 精确查找'),
      page: z.number().optional().default(1).describe('页码'),
      limit: z.number().optional().default(20).describe('每页条数'),
      q: z.string().optional().describe('搜索关键词'),
    },
    async (toolArgs) => {
      try {
        return toolSuccess(await proxyListTrendFlows(toolArgs.slug, toolArgs.page, toolArgs.limit, toolArgs.q))
      } catch (err) {
        return toolError(err)
      }
    },
  )

  server.tool(
    'get_trend_flow',
    '按 slug 获取单条趋势流动详情，用于上传后的验证或内容复用。',
    {
      slug: z.string().min(1).describe('趋势流动 slug'),
    },
    async (toolArgs) => {
      try {
        return toolSuccess(await proxyListTrendFlows(toolArgs.slug))
      } catch (err) {
        return toolError(err)
      }
    },
  )

  return server
}

async function mountTransport(req: any, res: any) {
  const server = createServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}

async function main() {
  if (transportMode === 'stdio') {
    const server = createServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('📈 trend-flow-mcp running via stdio')
    return
  }

  const express = await import('express')
  const app = express.default()
  app.use(express.default.json({ limit: '100mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'trend-flow-mcp', version: '2.0.0' })
  })

  app.post('/mcp', authMiddleware, async (req, res) => {
    await mountTransport(req, res)
  })

  app.get('/mcp', authMiddleware, async (req, res) => {
    await mountTransport(req, res)
  })

  app.delete('/mcp', authMiddleware, async (req, res) => {
    await mountTransport(req, res)
  })

  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    logEvent('startup', {
      port: CONFIG.PORT,
      backend_url: CONFIG.BACKEND_URL,
      internal_service_name: CONFIG.BACKEND_INTERNAL_SERVICE_NAME,
    })
    console.log(`📈 trend-flow-mcp HTTP server listening on :${CONFIG.PORT}`)
  })
}

main().catch((err) => {
  console.error(`Fatal: ${err}`)
  process.exit(1)
})
