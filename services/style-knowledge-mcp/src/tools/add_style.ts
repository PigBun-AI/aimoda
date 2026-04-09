/**
 * Tool: add_style — P0
 *
 * 新增一条风格知识到库中。
 * - 如果 style_name 已存在，自动合并（aliases 取并集，其他字段更新）
 * - 自动编码 visual_description 为向量
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { findByStyleName, upsertPoint } from "../qdrant.js";
import { encodeText } from "../encoder.js";
import type { StyleKnowledge } from "../types.js";
import { buildStyleRichText, withSearchFields } from "../style_text.js";
import {
  jsonStringCompatibleArray,
  parseStructuredArgs,
} from "../tool_input.js";

const addStyleRuntimeSchema = z.object({
  style_name: z.string(),
  aliases: z.array(z.string()),
  visual_description: z.string(),
  palette: z.array(z.string()).optional(),
  silhouette: z.array(z.string()).optional(),
  fabric: z.array(z.string()).optional(),
  details: z.array(z.string()).optional(),
  reference_brands: z.array(z.string()).optional(),
  category: z.string().optional(),
  season_relevance: z.array(z.string()).optional(),
  gender: z.string().optional(),
  source: z.string().optional(),
  source_url: z.string().optional(),
  source_title: z.string().optional(),
  confidence: z.number().optional(),
  popularity_score: z.number().optional(),
});

export const addStyleSchema = {
  style_name: z.string().describe("英文规范名（唯一标识）"),
  aliases: jsonStringCompatibleArray(z.string())
    .describe("多语言别名列表（至少包含中文名）"),
  visual_description: z
    .string()
    .describe("具体的英文视觉特征描述（会被向量化）"),
  palette: jsonStringCompatibleArray(z.string()).optional().describe("色调关键词列表"),
  silhouette: jsonStringCompatibleArray(z.string()).optional().describe("廓形关键词列表"),
  fabric: jsonStringCompatibleArray(z.string()).optional().describe("面料关键词列表"),
  details: jsonStringCompatibleArray(z.string()).optional().describe("设计细节列表"),
  reference_brands: jsonStringCompatibleArray(z.string()).optional().describe("代表品牌列表"),
  category: z.string().optional().describe("风格大类"),
  season_relevance: jsonStringCompatibleArray(z.string()).optional().describe("适合季节"),
  gender: z.string().optional().describe('"women" | "men" | "unisex"'),
  source: z
    .string()
    .optional()
    .describe('"vogue" | "pinterest" | "xiaohongshu" | "manual"'),
  source_url: z.string().optional().describe("原始 URL"),
  source_title: z.string().optional().describe("文章标题"),
  confidence: z.number().optional().describe("可信度 0-1"),
  popularity_score: z.number().optional().describe("流行度评分"),
};

export async function addStyle(args: {
  style_name: string;
  aliases: string[];
  visual_description: string;
  palette?: string[];
  silhouette?: string[];
  fabric?: string[];
  details?: string[];
  reference_brands?: string[];
  category?: string;
  season_relevance?: string[];
  gender?: string;
  source?: string;
  source_url?: string;
  source_title?: string;
  confidence?: number;
  popularity_score?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const normalizedArgs = parseStructuredArgs(addStyleRuntimeSchema, args, "add_style arguments");
  const now = new Date().toISOString();

  // 检查是否已存在
  const existing = await findByStyleName(normalizedArgs.style_name);
  let merged = false;
  let pointId: string | number;

  if (existing) {
    // 合并模式：aliases 取并集，其他字段更新
    merged = true;
    pointId = existing.id;

    const oldPayload = existing.payload;
    const mergedAliases = Array.from(
      new Set([...oldPayload.aliases, ...normalizedArgs.aliases])
    );

    const payload: StyleKnowledge = {
      style_name: normalizedArgs.style_name,
      aliases: mergedAliases,
      visual_description: normalizedArgs.visual_description,
      rich_text: buildStyleRichText({
        style_name: normalizedArgs.style_name,
        aliases: mergedAliases,
        visual_description: normalizedArgs.visual_description,
        palette: normalizedArgs.palette ?? oldPayload.palette ?? [],
        silhouette: normalizedArgs.silhouette ?? oldPayload.silhouette ?? [],
        fabric: normalizedArgs.fabric ?? oldPayload.fabric ?? [],
        details: normalizedArgs.details ?? oldPayload.details ?? [],
        reference_brands: normalizedArgs.reference_brands ?? oldPayload.reference_brands ?? [],
        category: normalizedArgs.category ?? oldPayload.category ?? "",
        season_relevance: normalizedArgs.season_relevance ?? oldPayload.season_relevance ?? [],
        gender: normalizedArgs.gender ?? oldPayload.gender ?? "unisex",
      }),
      palette: normalizedArgs.palette ?? oldPayload.palette ?? [],
      silhouette: normalizedArgs.silhouette ?? oldPayload.silhouette ?? [],
      fabric: normalizedArgs.fabric ?? oldPayload.fabric ?? [],
      details: normalizedArgs.details ?? oldPayload.details ?? [],
      reference_brands:
        normalizedArgs.reference_brands ?? oldPayload.reference_brands ?? [],
      category: normalizedArgs.category ?? oldPayload.category ?? "",
      season_relevance:
        normalizedArgs.season_relevance ?? oldPayload.season_relevance ?? [],
      gender: normalizedArgs.gender ?? oldPayload.gender ?? "unisex",
      source: normalizedArgs.source ?? oldPayload.source ?? "",
      source_url: normalizedArgs.source_url ?? oldPayload.source_url ?? "",
      source_title: normalizedArgs.source_title ?? oldPayload.source_title ?? "",
      created_at: oldPayload.created_at,
      updated_at: now,
      confidence: normalizedArgs.confidence ?? oldPayload.confidence ?? 0.6,
      popularity_score:
        normalizedArgs.popularity_score ?? oldPayload.popularity_score ?? 0,
    };

    const vector = await encodeText(payload.rich_text);
    await upsertPoint(pointId, withSearchFields(payload), vector);
  } else {
    // 新建
    pointId = randomUUID();

    const payload: StyleKnowledge = {
      style_name: normalizedArgs.style_name,
      aliases: normalizedArgs.aliases,
      visual_description: normalizedArgs.visual_description,
      rich_text: buildStyleRichText({
        style_name: normalizedArgs.style_name,
        aliases: normalizedArgs.aliases,
        visual_description: normalizedArgs.visual_description,
        palette: normalizedArgs.palette ?? [],
        silhouette: normalizedArgs.silhouette ?? [],
        fabric: normalizedArgs.fabric ?? [],
        details: normalizedArgs.details ?? [],
        reference_brands: normalizedArgs.reference_brands ?? [],
        category: normalizedArgs.category ?? "",
        season_relevance: normalizedArgs.season_relevance ?? [],
        gender: normalizedArgs.gender ?? "unisex",
      }),
      palette: normalizedArgs.palette ?? [],
      silhouette: normalizedArgs.silhouette ?? [],
      fabric: normalizedArgs.fabric ?? [],
      details: normalizedArgs.details ?? [],
      reference_brands: normalizedArgs.reference_brands ?? [],
      category: normalizedArgs.category ?? "",
      season_relevance: normalizedArgs.season_relevance ?? [],
      gender: normalizedArgs.gender ?? "unisex",
      source: normalizedArgs.source ?? "",
      source_url: normalizedArgs.source_url ?? "",
      source_title: normalizedArgs.source_title ?? "",
      created_at: now,
      updated_at: now,
      confidence: normalizedArgs.confidence ?? 0.6,
      popularity_score: normalizedArgs.popularity_score ?? 0,
    };

    const vector = await encodeText(payload.rich_text);
    await upsertPoint(pointId, withSearchFields(payload), vector);
  }

  const result = {
    status: "ok",
    point_id: String(pointId),
    merged,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
  };
}
