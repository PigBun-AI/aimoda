#!/usr/bin/env node
/**
 * aimoda-style-knowledge-mcp — 风格知识库 MCP 服务
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ensureCollection } from "./qdrant.js";
import { authMiddleware } from "./auth.js";

import { searchStyleSchema, searchStyle } from "./tools/search_style.js";
import { addStyleSchema, addStyle } from "./tools/add_style.js";
import { getStyleDetailSchema, getStyleDetail } from "./tools/get_style_detail.js";
import { listStylesSchema, listStyles } from "./tools/list_styles.js";
import { listStyleGapsSchema, listStyleGapsTool } from "./tools/list_style_gaps.js";
import { markStyleGapCoveredSchema, markStyleGapCoveredTool } from "./tools/mark_style_gap_covered.js";
import { updateStyleSchema, updateStyle } from "./tools/update_style.js";
import { deleteStyleSchema, deleteStyle } from "./tools/delete_style.js";
import { batchImportSchema, batchImportStyles } from "./tools/batch_import.js";
import { getTaxonomyOverviewSchema, getTaxonomyOverviewTool } from "./tools/get_taxonomy_overview.js";
import { findSimilarStylesSchema, findSimilarStylesTool } from "./tools/find_similar_styles.js";
import { validateEntrySchema, validateEntryTool } from "./tools/validate_entry.js";
import { detectDuplicatesSchema, detectDuplicatesTool } from "./tools/detect_duplicates.js";
import { exportKbSchema, exportKbTool } from "./tools/export_kb.js";
import { bulkUpsertStylesSchema, bulkUpsertStylesTool } from "./tools/bulk_upsert_styles.js";
import { CONFIG } from "./config.js";

const args = process.argv.slice(2);
const transportArg = args.find((a) => a.startsWith("--transport="));
const transportMode = transportArg?.split("=")[1] ?? "http";
const PORT = CONFIG.PORT;

function createServer(): McpServer {
  const server = new McpServer({
    name: "aimoda-style-knowledge",
    version: "1.1.0",
  });

  server.tool("search_style", `搜索风格知识库（精确匹配 + 模糊匹配 + 语义搜索）。`, searchStyleSchema, async (args) => searchStyle(args as any));
  server.tool("get_style_detail", `获取单个或多个风格的完整详细信息。`, getStyleDetailSchema, async (args) => getStyleDetail(args as any));
  server.tool("add_style", `新增一条风格知识到库中，自动编码 visual_description 为 FashionCLIP 向量。`, addStyleSchema, async (args) => addStyle(args as any));
  server.tool("list_styles", `列出知识库中风格条目（精简版，不含 visual_description）。`, listStylesSchema, async (args) => listStyles(args as any));
  server.tool("get_taxonomy_overview", `返回风格库概览，包括 category 聚合、低置信度数量、总条数与最近更新时间。`, getTaxonomyOverviewSchema, async () => getTaxonomyOverviewTool());
  server.tool("find_similar_styles", `基于 FashionCLIP 语义向量查找某个风格的近邻风格。`, findSimilarStylesSchema, async (args) => findSimilarStylesTool(args as any));
  server.tool("list_style_gaps", `列出 Aimoda 智能体在 search_style 阶段未命中的风格缺口，并可附带最近似已有风格建议。`, listStyleGapsSchema, async (args) => listStyleGapsTool(args as any));
  server.tool("mark_style_gap_covered", `将某个风格缺口标记为已闭环。`, markStyleGapCoveredSchema, async (args) => markStyleGapCoveredTool(args as any));
  server.tool("batch_import_styles", `批量导入多条风格知识（每条格式同 add_style）。`, batchImportSchema, async (args) => batchImportStyles(args as any));
  server.tool("bulk_upsert_styles", `批量写入/更新风格条目，支持 payload JSON 字符串，规避外部 client 对数组/对象的错误序列化。`, bulkUpsertStylesSchema, async (args) => bulkUpsertStylesTool(args));
  server.tool("validate_entry", `校验单条或多条风格条目的完整性与字段质量。`, validateEntrySchema, async (args) => validateEntryTool(args));
  server.tool("detect_duplicates", `检测别名重复或语义近似重复的风格条目。`, detectDuplicatesSchema, async (args) => detectDuplicatesTool(args as any));
  server.tool("update_style", `更新已有风格条目的部分字段（部分更新，未提供的字段保持不变）。`, updateStyleSchema, async (args) => updateStyle(args as any));
  server.tool("delete_style", `删除一条风格知识（按 style_name 精确匹配删除）。`, deleteStyleSchema, async (args) => deleteStyle(args as any));
  server.tool("export_kb", `导出全量风格知识库，支持 JSON 或 CSV。`, exportKbSchema, async (args) => exportKbTool(args as any));

  return server;
}

async function main() {
  try {
    await ensureCollection();
    console.error("✅ Qdrant collection ready");
  } catch (err) {
    console.error(`⚠️ Qdrant initialization warning: ${(err as Error).message}`);
  }

  if (transportMode === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎨 style-knowledge-mcp running via stdio");
  } else {
    const express = await import("express");
    const app = express.default();
    app.use(express.default.json());

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "style-knowledge-mcp", version: "1.1.0" });
    });

    app.post("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });

    app.delete("/mcp", authMiddleware, async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
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
