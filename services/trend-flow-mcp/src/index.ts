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

async function proxyUploadTrendFlow(zipBase64: string, filename: string) {
  const buffer = Buffer.from(zipBase64, 'base64')
  const boundary = `----MCP${Date.now()}`
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])

  return callInternalApi<JsonObject>(
    '/api/internal/trend-flow-mcp/upload',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    },
    { operation: 'publish_trend_flow', filename, size_bytes: buffer.length },
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
  const server = new McpServer({ name: 'aimoda-trend-flow', version: '1.0.0' })

  server.tool(
    'get_trend_flow_spec',
    '获取趋势流动 ZIP 打包规范，包含 manifest、时间轴要求与目录结构。',
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
    '获取趋势流动 ZIP 模板，适合外部 Agent 直接据此构建单品牌四季度包。',
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
    'publish_trend_flow',
    '发布一个趋势流动 ZIP。要求 manifest 中 brand、timeline、entryHtml 完整，timeline 必须是连续四个季度。',
    {
      file_base64: z.string().describe('zip 文件的 base64 编码'),
      filename: z.string().optional().default('trend-flow.zip').describe('zip 文件名'),
    },
    async (toolArgs) => {
      try {
        return toolSuccess(await proxyUploadTrendFlow(toolArgs.file_base64, toolArgs.filename ?? 'trend-flow.zip'))
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
    res.json({ status: 'ok', service: 'trend-flow-mcp', version: '1.0.0' })
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
