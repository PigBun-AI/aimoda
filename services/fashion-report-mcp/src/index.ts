#!/usr/bin/env node
/**
 * aimoda-fashion-report-mcp — 报告管理 MCP 服务
 *
 * 3 个工具:
 *   get_report_spec  — 返回报告打包规范
 *   upload_report    — 上传报告 zip（代理到 backend）
 *   list_reports     — 查询报告列表（代理到 backend）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CONFIG } from "./config.js";
import { authMiddleware } from "./auth.js";

// ── Inline report spec ──────────────────────────────────────────
const REPORT_SPEC = `# WWWD 报告规范

World Wear Watch Daily (WWWD) 时尚趋势报告的资源层级规范。

---

## 1. 文件夹结构

\`\`\`
{brand}-{season}-{year}/
├── index.html          # 必需：主报告页面
├── cover.jpg           # 必需：封面图片（首页截图）
├── overview.html       # 必需：品牌纵览页面
├── metadata.json       # 可选：元数据
└── images/             # 图片资源目录
    ├── look-01.jpg
    ├── look-02.jpg
    └── ...
\`\`\`

### 命名规范

| 元素 | 规范 | 示例 |
|------|------|------|
| 文件夹 | \`{品牌英文名}-{季节}-{年份}\` | \`zimmermann-fall-2026\` |
| 季节 | 小写英文 | \`fall\`, \`spring\`, \`resort\`, \`pre-fall\` |
| 封面 | \`cover.jpg\` | 固定文件名 |

### 图片命名说明

- **无数量限制**：图片数量不限
- **格式灵活**：支持 .jpg、.jpeg、.png、.webp
- **命名自由**：只要 index.html 能正确引用即可

---

## 2. 必需文件

### index.html
- 主报告页面，嵌入 iframe 展示
- 必须支持响应式布局

### cover.jpg
- 16:9 比例，推荐 1920x1080
- **必须使用 Playwright 截取真实页面**

### overview.html
- 品牌纵览/数据看板（上传时必需）

### metadata.json（可选）
\`\`\`json
{
  "brand": "Zimmermann",
  "season": "Fall",
  "year": 2026,
  "title": "Zimmermann Fall 2026 RTW 趋势报告",
  "lookCount": 16
}
\`\`\`

---

## 3. 上传流程

1. 生成报告文件（index.html + overview.html + images/）
2. 使用 Playwright 截取首页保存为 cover.jpg
3. 打包为 zip 文件
4. 调用 upload_report 工具上传

## 4. 快速检查清单

上传前确认：
- [ ] 文件夹命名符合 \`{brand}-{season}-{year}\` 格式
- [ ] 包含 index.html 和 overview.html
- [ ] 封面使用 Playwright 截取（不是手动绘制）
- [ ] 封面比例 16:9（1920x1080 或 1280x720）
- [ ] 打包为 zip 文件`;

// ── Parse CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const transportArg = args.find((a) => a.startsWith("--transport="));
const transportMode = transportArg?.split("=")[1] ?? "http";

// ── Backend proxy helpers ───────────────────────────────────────

async function proxyListReports(slug?: string, page = 1, limit = 20) {
  const url = slug
    ? `${CONFIG.BACKEND_URL}/api/reports?slug=${encodeURIComponent(slug)}`
    : `${CONFIG.BACKEND_URL}/api/reports?page=${page}&limit=${limit}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Backend returned ${resp.status}`);
  return resp.json();
}

async function proxyUploadReport(zipBase64: string, filename: string) {
  // Convert base64 to binary and POST as multipart
  const buffer = Buffer.from(zipBase64, "base64");
  const boundary = "----MCP" + Date.now();
  const parts: Buffer[] = [];

  // File part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`
  ));
  parts.push(buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const resp = await fetch(`${CONFIG.BACKEND_URL}/api/mcp/upload`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ── MCP Server ──────────────────────────────────────────────────

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
    async () => ({
      content: [{ type: "text" as const, text: REPORT_SPEC }],
    }),
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
    async (args) => {
      try {
        const result = await proxyUploadReport(
          args.file_base64,
          args.filename ?? "report.zip",
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
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
    async (args) => {
      try {
        const result = await proxyListReports(args.slug, args.page, args.limit);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
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

// ── Startup ──────────────────────────────────────────────────────

async function main() {
  if (transportMode === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("📋 fashion-report-mcp running via stdio");
  } else {
    const express = await import("express");
    const app = express.default();
    app.use(express.default.json({ limit: "100mb" }));

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "fashion-report-mcp", version: "1.0.0" });
    });

    app.post("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    app.delete("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    app.listen(CONFIG.PORT, "0.0.0.0", () => {
      console.log(`📋 fashion-report-mcp HTTP server listening on :${CONFIG.PORT}`);
      console.log(`   POST /mcp    — MCP endpoint (requires X-API-Key)`);
      console.log(`   GET  /health — Health check`);
    });
  }
}

main().catch((err) => { console.error(`Fatal: ${err}`); process.exit(1); });
