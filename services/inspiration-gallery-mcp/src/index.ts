#!/usr/bin/env node
/**
 * aimoda-inspiration-gallery-mcp — 灵感情报站 MCP 服务
 *
 * 管理灵感图集的创建、上传、更新、删除。
 * OpenClaw Agent 通过此服务自动化上传采集到的灵感图集。
 *
 * 传输模式：
 *   --transport=http   HTTP 远程服务（默认，端口 18760）
 *   --transport=stdio  标准输入输出（本地开发用）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CONFIG } from "./config.js";
import { ensureSchema } from "./db.js";
import { authMiddleware } from "./auth.js";
import { uploadToOSS } from "./oss.js";

import { getUploadSpecSchema, getUploadSpec } from "./tools/get_upload_spec.js";
import {
  createGallerySchema,
  createGalleryTool,
} from "./tools/create_gallery.js";
import { addImagesSchema, addImagesTool } from "./tools/add_images.js";
import {
  listGalleriesSchema,
  listGalleriesTool,
} from "./tools/list_galleries.js";
import { getGallerySchema, getGalleryTool } from "./tools/get_gallery.js";
import {
  updateGallerySchema,
  updateGalleryTool,
} from "./tools/update_gallery.js";
import {
  deleteGallerySchema,
  deleteGalleryTool,
} from "./tools/delete_gallery.js";
import {
  batchGetGalleriesSchema,
  batchGetGalleriesTool,
} from "./tools/batch_get_galleries.js";
import {
  updateGalleryImagesSchema,
  updateGalleryImagesTool,
} from "./tools/update_gallery_images.js";
import {
  deleteGalleryImagesSchema,
  deleteGalleryImagesTool,
} from "./tools/delete_gallery_images.js";
import {
  batchDeleteGalleriesSchema,
  batchDeleteGalleriesTool,
} from "./tools/batch_delete_galleries.js";

// ── Parse CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const transportArg = args.find((a) => a.startsWith("--transport="));
const transportMode = transportArg?.split("=")[1] ?? "http";

// ── Create MCP Server ──────────────────────────────────────────

function createServer(): McpServer {
  const server = new McpServer({
    name: "aimoda-inspiration-gallery",
    version: "1.1.0",
  });

  server.tool(
    "get_upload_spec",
    `获取灵感情报站图集打包规范。
返回: 完整的目录结构规范、manifest.json 格式说明、分类枚举、标签建议。
适用场景: Agent 首次使用前调用此工具了解打包要求。`,
    getUploadSpecSchema,
    async () => getUploadSpec(),
  );

  server.tool(
    "create_gallery",
    `创建一个新的灵感图集（仅元数据，不含图片）。
返回: gallery_id（用于后续 add_images 调用）。
流程: 先 create_gallery 获取 ID → 再 add_images 上传图片。`,
    createGallerySchema,
    async (args) => createGalleryTool(args as any),
  );

  server.tool(
    "add_images",
    `向已创建的图集添加图片。
支持两种模式:
  1. base64: 传入 { filename, data: "<base64>" } — 自动上传到 OSS
  2. url: 传入 { filename, url: "https://..." } — 直接引用外部 URL
每张图可附带 caption(说明) 和 sort_order(排序)。
调用前需先通过 create_gallery 获取 gallery_id。`,
    addImagesSchema,
    async (args) => addImagesTool(args as any),
  );

  server.tool(
    "list_galleries",
    `列出灵感情报站中的图集。
支持按 category(trend/collection/street_style/editorial/inspiration)、tag、status 筛选。
支持分页: limit + offset。默认只返回 published 状态的图集。`,
    listGalleriesSchema,
    async (args) => listGalleriesTool(args as any),
  );

  server.tool(
    "get_gallery",
    `获取单个图集的完整详情，支持图片分页与按需返回图片列表。
输入: gallery_id。`,
    getGallerySchema,
    async (args) => getGalleryTool(args as any),
  );

  server.tool(
    "batch_get_galleries",
    `批量获取多个图集详情，可选择带 description 和图片预览。
输入: gallery_ids。`,
    batchGetGalleriesSchema,
    async (args) => batchGetGalleriesTool(args as any),
  );

  server.tool(
    "update_gallery",
    `更新图集元数据（标题、描述、分类、标签、状态等）。
未提供的字段保持不变。tags 为覆盖模式。`,
    updateGallerySchema,
    async (args) => updateGalleryTool(args as any),
  );

  server.tool(
    "delete_gallery",
    `删除图集及其所有图片（同时清理 OSS 存储）。
输入: gallery_id。`,
    deleteGallerySchema,
    async (args) => deleteGalleryTool(args as any),
  );

  server.tool(
    "update_gallery_images",
    `批量更新图集内图片的 caption 或 sort_order。`,
    updateGalleryImagesSchema,
    async (args) => updateGalleryImagesTool(args as any),
  );

  server.tool(
    "delete_gallery_images",
    `删除图集内的单张或多张图片，并同步清理 OSS 对象。`,
    deleteGalleryImagesSchema,
    async (args) => deleteGalleryImagesTool(args as any),
  );

  server.tool(
    "batch_delete_galleries",
    `批量删除多个图集，并清理关联 OSS 数据。`,
    batchDeleteGalleriesSchema,
    async (args) => batchDeleteGalleriesTool(args as any),
  );

  return server;
}

// ── Startup ──────────────────────────────────────────────────────

async function main() {
  // Ensure DB tables exist
  try {
    await ensureSchema();
    console.error("✅ PostgreSQL schema ready");
  } catch (err) {
    console.error(`⚠️ DB init warning: ${(err as Error).message}`);
  }

  if (transportMode === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🎨 inspiration-gallery-mcp running via stdio");
  } else {
    const express = await import("express");
    const multer = await import("multer");
    const app = express.default();
    app.use(express.default.json({ limit: "50mb" }));

    // Health check (no auth)
    app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        service: "inspiration-gallery-mcp",
        version: "1.1.0",
      });
    });

    // ── REST: Batch image upload ──
    const upload = multer.default({ storage: multer.default.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    app.post(
      "/upload",
      authMiddleware,
      upload.array("images", 50),
      async (req: any, res) => {
        try {
          const galleryId = req.body.gallery_id || req.query.gallery_id;
          if (!galleryId) {
            res.status(400).json({ error: "gallery_id required" });
            return;
          }

          const files = (req.files || []) as Express.Multer.File[];
          const urls: string[] = [];

          for (const f of files) {
            const url = await uploadToOSS(
              galleryId,
              f.originalname,
              f.buffer,
              f.mimetype,
            );
            urls.push(url);
          }

          res.json({ success: true, gallery_id: galleryId, urls });
        } catch (err) {
          res.status(500).json({ error: (err as Error).message });
        }
      },
    );

    // ── MCP endpoint ──
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

    app.listen(CONFIG.PORT, "0.0.0.0", () => {
      console.log(
        `🎨 inspiration-gallery-mcp HTTP server listening on :${CONFIG.PORT}`,
      );
      console.log(`   POST /mcp     — MCP endpoint (requires X-API-Key)`);
      console.log(`   POST /upload  — Batch image upload`);
      console.log(`   GET  /health  — Health check`);
    });
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
