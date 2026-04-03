#!/usr/bin/env node
/**
 * aimoda-style-knowledge-mcp — 风格知识库 MCP 服务
 *
 * 管理时尚风格的结构化知识（风格定义、视觉特征、别名映射等），
 * 存储在 Qdrant 向量数据库的 style_knowledge collection 中。
 *
 * 传输模式：
 *   --transport=http   HTTP 远程服务（默认，端口 18750）
 *   --transport=stdio  标准输入输出（本地开发用）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ensureCollection } from "./qdrant.js";
import { authMiddleware } from "./auth.js";

import { searchStyleSchema, searchStyle } from "./tools/search_style.js";
import { addStyleSchema, addStyle } from "./tools/add_style.js";
import {
  getStyleDetailSchema,
  getStyleDetail,
} from "./tools/get_style_detail.js";
import { listStylesSchema, listStyles } from "./tools/list_styles.js";
import { listStyleGapsSchema, listStyleGapsTool } from "./tools/list_style_gaps.js";
import { markStyleGapCoveredSchema, markStyleGapCoveredTool } from "./tools/mark_style_gap_covered.js";
import { updateStyleSchema, updateStyle } from "./tools/update_style.js";
import { deleteStyleSchema, deleteStyle } from "./tools/delete_style.js";
import {
  batchImportSchema,
  batchImportStyles,
} from "./tools/batch_import.js";
import { CONFIG } from "./config.js";

// ── Parse CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const transportArg = args.find((a) => a.startsWith("--transport="));
const transportMode = transportArg?.split("=")[1] ?? "http";
const PORT = CONFIG.PORT;

// ── Create MCP Server ──────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: "aimoda-style-knowledge",
    version: "1.0.0",
  });

  // ── P0: 搜索 ──────────────────────────────────────────────────
  server.tool(
    "search_style",
    `搜索风格知识库（精确匹配 + 模糊匹配 + 语义搜索）。
输入: query 支持中英文风格名、部分名称、或自然语言描述，如 "老钱风"、"老钱"、"quiet luxury"、"低调奢华感"。
搜索策略(4层): 1) 精确匹配 style_name/aliases 2) 模糊子串匹配("老钱"→"老钱风") 3) FashionCLIP 语义近邻搜索 4) 无结果则建议联网查询。
返回: 精简结果(style_name, aliases, category, confidence, match_type, score)，不含 visual_description。
获取完整信息请调用 get_style_detail(style_name)。
适用场景: fashion-report Agent 查找风格标签、匹配风格名称。`,
    searchStyleSchema,
    async (args) => searchStyle(args as any),
  );

  // ── P0: 获取详情 ──────────────────────────────────────────────
  server.tool(
    "get_style_detail",
    `获取单个风格的完整详细信息（含 visual_description、palette、fabric、reference_brands 等全部字段）。
输入: style_name（从 search_style 返回的结果中获取）。
适用场景: search_style 返回精简结果后，Agent 需要某个风格的完整视觉描述时调用。`,
    getStyleDetailSchema,
    async (args) => getStyleDetail(args as any),
  );

  // ── P0: 新增 ──────────────────────────────────────────────────
  server.tool(
    "add_style",
    `新增一条风格知识到库中，自动编码 visual_description 为 FashionCLIP 向量。
必填: style_name(英文规范名), aliases(多语言别名), visual_description(英文视觉描述)。
行为: 如果 style_name 已存在 → 自动合并(aliases 取并集，其他字段更新为最新值，visual_description 变更时重新编码向量)。
适用场景: 手动录入新风格定义，或 OpenClaw 采集后逐条入库。`,
    addStyleSchema,
    async (args) => addStyle(args as any),
  );

  // ── P1: 列表 ──────────────────────────────────────────────────
  server.tool(
    "list_styles",
    `列出知识库中风格条目（精简版，不含 visual_description）。
支持按 category(如 luxury/streetwear/romantic) 和 source(如 vogue/pinterest/xiaohongshu/manual) 筛选。
支持分页: 传入上次返回的 next_offset 获取下一页，默认每页 20 条。
返回: styles[], returned(本页条数), total_count(总数), next_offset, has_more。
适用场景: VLM 打标 pipeline 获取风格定义、管理后台浏览列表。`,
    listStylesSchema,
    async (args) => listStyles(args as any),
  );

  server.tool(
    "list_style_gaps",
    `列出 Aimoda 智能体在 search_style 阶段未命中的风格缺口。
返回: 用户近期检索但风格库尚未覆盖的风格词、触发次数(total_hits)、涉及会话数(unique_sessions)、最近一次上下文。
适用场景: OpenClaw 定向补采趋势风格、运营查看近期风格需求空白。`,
    listStyleGapsSchema,
    async (args) => listStyleGapsTool(args as any),
  );

  server.tool(
    "mark_style_gap_covered",
    `将某个风格缺口标记为已闭环。
适用场景: OpenClaw 补采并写入 style knowledge 后，调用本工具将缺口从 open 标记为 covered，并记录 linked_style_name 与 resolution_note。`,
    markStyleGapCoveredSchema,
    async (args) => markStyleGapCoveredTool(args as any),
  );

  // ── P1: 批量导入 ──────────────────────────────────────────────
  server.tool(
    "batch_import_styles",
    `批量导入多条风格知识（每条格式同 add_style）。
行为: 已存在的 style_name 自动合并，新的创建新条目，所有 visual_description 自动编码为向量。
返回: { total, created, merged, errors[] }。
适用场景: OpenClaw 自动化采集后一次性批量入库。`,
    batchImportSchema,
    async (args) => batchImportStyles(args as any),
  );

  // ── P2: 更新 ──────────────────────────────────────────────────
  server.tool(
    "update_style",
    `更新已有风格条目的部分字段（部分更新，未提供的字段保持不变）。
aliases 默认追加模式(新别名追加到已有列表)，设 replace_aliases=true 可覆盖。
visual_description 变更时自动重新编码向量。
返回: { updated_fields[] }。`,
    updateStyleSchema,
    async (args) => updateStyle(args as any),
  );

  // ── P2: 删除 ──────────────────────────────────────────────────
  server.tool(
    "delete_style",
    `删除一条风格知识（按 style_name 精确匹配删除）。
返回: { deleted: boolean }，不存在时 deleted=false。`,
    deleteStyleSchema,
    async (args) => deleteStyle(args as any),
  );

  return server;
}

// ── Startup ──────────────────────────────────────────────────────

async function main() {
  // 确保 Qdrant collection 存在
  try {
    await ensureCollection();
    console.error("✅ Qdrant collection ready");
  } catch (err) {
    console.error(
      `⚠️ Qdrant initialization warning: ${(err as Error).message}`,
    );
  }

  if (transportMode === "stdio") {
    // ── stdio 模式（本地开发） ──
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎨 style-knowledge-mcp running via stdio");
  } else {
    // ── HTTP 模式（远程服务） ──
    const express = await import("express");
    const app = express.default();
    app.use(express.default.json());

    // Health check (no auth required)
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "style-knowledge-mcp", version: "1.0.0" });
    });

    // MCP endpoint with auth
    app.post("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    // Handle GET and DELETE for SSE streams (session management)
    app.get("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    app.delete("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🎨 style-knowledge-mcp HTTP server listening on :${PORT}`);
      console.log(`   POST /mcp  — MCP endpoint (requires X-API-Key)`);
      console.log(`   GET  /health — Health check`);
    });
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
