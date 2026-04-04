#!/usr/bin/env node
/**
 * aimoda-fashion-report-mcp — 报告管理 MCP 服务
 *
 * 3 个工具:
 *   get_report_spec  — 返回报告打包规范
 *   upload_report    — 上传报告 zip（代理到 backend internal capability）
 *   list_reports     — 查询报告列表（代理到 backend internal capability）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CONFIG } from "./config.js";
import { authMiddleware } from "./auth.js";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const args = process.argv.slice(2);
const transportArg = args.find((arg) => arg.startsWith("--transport="));
const transportMode = transportArg?.split("=")[1] ?? "http";

function logEvent(event: string, payload: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: "fashion-report-mcp",
    event,
    ...payload,
  }));
}

function formatErrorPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function internalHeaders(extraHeaders: Record<string, string> = {}) {
  return {
    "X-Internal-Token": CONFIG.BACKEND_INTERNAL_TOKEN,
    "X-Internal-Service": CONFIG.BACKEND_INTERNAL_SERVICE_NAME,
    ...extraHeaders,
  };
}

async function callInternalApi<T>(
  path: string,
  init: RequestInit,
  meta: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  const response = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
    ...init,
    headers: internalHeaders((init.headers ?? {}) as Record<string, string>),
  });

  const rawText = await response.text();
  let payload: unknown = rawText;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  logEvent("backend_call", {
    path,
    status: response.status,
    ok: response.ok,
    duration_ms: Date.now() - start,
    ...meta,
  });

  if (!response.ok) {
    throw new Error(`${meta.operation ?? path} failed (${response.status}): ${formatErrorPayload(payload)}`);
  }

  return payload as T;
}

async function proxyGetReportSpec() {
  const payload = await callInternalApi<{ success: boolean; spec: JsonObject }>(
    "/api/internal/report-mcp/spec",
    { method: "GET" },
    { operation: "get_report_spec" },
  );
  return payload.spec;
}

async function proxyListReports(slug?: string, page = 1, limit = 20) {
  const query = slug
    ? `slug=${encodeURIComponent(slug)}`
    : `page=${page}&limit=${limit}`;

  return callInternalApi<JsonObject>(
    `/api/internal/report-mcp/reports?${query}`,
    { method: "GET" },
    { operation: "list_reports", slug: slug ?? null, page, limit },
  );
}

async function proxyUploadReport(zipBase64: string, filename: string) {
  const buffer = Buffer.from(zipBase64, "base64");
  const boundary = `----MCP${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return callInternalApi<JsonObject>(
    "/api/internal/report-mcp/upload",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    },
    { operation: "upload_report", filename, size_bytes: buffer.length },
  );
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "aimoda-fashion-report",
    version: "1.0.0",
  });

  server.tool(
    "get_report_spec",
    `获取 WWWD 报告打包规范。
返回: 文件夹结构、命名规范、必需文件说明、上传流程、检查清单。
适用场景: Agent 生成报告前应先查阅此规范。`,
    {},
    async () => {
      try {
        const result = await proxyGetReportSpec();
        logEvent("tool_result", { tool: "get_report_spec", ok: true });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logEvent("tool_result", { tool: "get_report_spec", ok: false, error: (err as Error).message });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: (err as Error).message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "upload_report",
    `上传报告 zip 压缩包到 WWWD 平台。
输入: base64 编码的 zip 文件 + 文件名。
服务端自动: 解压 → 提取元数据 → 上传 OSS → 写入数据库。`,
    {
      file_base64: z.string().describe("zip 文件的 base64 编码"),
      filename: z.string().optional().default("report.zip").describe("文件名"),
    },
    async (toolArgs) => {
      try {
        const result = await proxyUploadReport(toolArgs.file_base64, toolArgs.filename ?? "report.zip");
        logEvent("tool_result", { tool: "upload_report", ok: true, filename: toolArgs.filename ?? "report.zip" });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logEvent("tool_result", {
          tool: "upload_report",
          ok: false,
          filename: toolArgs.filename ?? "report.zip",
          error: (err as Error).message,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: (err as Error).message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "list_reports",
    `查询平台上已发布的报告列表。
可通过 slug 精确查找单篇报告（用于上传后验证）。
省略 slug 则返回分页列表。`,
    {
      slug: z.string().optional().describe("按 slug 精确查找，如 zimmermann-fall-2026"),
      page: z.number().optional().default(1).describe("页码"),
      limit: z.number().optional().default(20).describe("每页条数"),
    },
    async (toolArgs) => {
      try {
        const result = await proxyListReports(toolArgs.slug, toolArgs.page, toolArgs.limit);
        logEvent("tool_result", {
          tool: "list_reports",
          ok: true,
          slug: toolArgs.slug ?? null,
          page: toolArgs.page,
          limit: toolArgs.limit,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        logEvent("tool_result", {
          tool: "list_reports",
          ok: false,
          slug: toolArgs.slug ?? null,
          page: toolArgs.page,
          limit: toolArgs.limit,
          error: (err as Error).message,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: (err as Error).message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

async function mountTransport(req: any, res: any) {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

async function main() {
  if (transportMode === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("📋 fashion-report-mcp running via stdio");
    return;
  }

  const express = await import("express");
  const app = express.default();
  app.use(express.default.json({ limit: "100mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "fashion-report-mcp", version: "1.0.0" });
  });

  app.post("/mcp", authMiddleware, async (req, res) => {
    await mountTransport(req, res);
  });

  app.get("/mcp", authMiddleware, async (req, res) => {
    await mountTransport(req, res);
  });

  app.delete("/mcp", authMiddleware, async (req, res) => {
    await mountTransport(req, res);
  });

  app.listen(CONFIG.PORT, "0.0.0.0", () => {
    logEvent("startup", {
      port: CONFIG.PORT,
      backend_url: CONFIG.BACKEND_URL,
      internal_service_name: CONFIG.BACKEND_INTERNAL_SERVICE_NAME,
    });
    console.log(`📋 fashion-report-mcp HTTP server listening on :${CONFIG.PORT}`);
    console.log("   POST /mcp    — MCP endpoint (requires X-API-Key)");
    console.log("   GET  /health — Health check");
  });
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
