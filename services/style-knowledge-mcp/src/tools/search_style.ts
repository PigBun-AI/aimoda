/**
 * Tool: search_style — P0
 *
 * 搜索风格知识库。4 层搜索策略：
 * 1. 精确匹配 style_name / aliases
 * 2. 模糊子串匹配（"老钱" → "老钱风"）
 * 3. FashionCLIP 语义搜索
 * 4. 无结果 → 建议联网查询
 *
 * 返回精简结果（不含 visual_description），Agent 需要详情时调用 get_style_detail。
 */

import { z } from "zod";
import {
  findByNameOrAlias,
  fuzzyMatchByNameOrAlias,
  semanticSearch,
} from "../qdrant.js";
import { encodeText } from "../encoder.js";
import { CONFIG } from "../config.js";
import { buildStyleRichText, normalizeExactToken } from "../style_text.js";

export const searchStyleSchema = {
  query: z
    .string()
    .describe('风格名称或描述（中/英文均可），如 "老钱风", "quiet luxury", "老钱"'),
  limit: z.number().optional().default(5).describe("返回结果数量上限，默认 5"),
};

/** 精简的搜索结果条目（不含 visual_description 等重字段） */
interface SearchResultSlim {
  style_name: string;
  aliases: string[];
  category: string;
  confidence: number;
  match_type: "name_exact" | "alias_exact" | "fuzzy" | "semantic";
  score?: number;
}

function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 0) }],
  };
}

function toSlim(
  payload: any,
  matchType: SearchResultSlim["match_type"],
  score?: number
): SearchResultSlim {
  return {
    style_name: payload.style_name,
    aliases: payload.aliases,
    category: payload.category,
    confidence: payload.confidence,
    match_type: matchType,
    ...(score !== undefined ? { score } : {}),
  };
}

function compactVisualDescription(text: string, maxWords = 48): string {
  const words = text.replace(/\n/g, " ").split(" ").filter(Boolean);
  return words.length <= maxWords ? words.join(" ") : words.slice(0, maxWords).join(" ");
}

export async function searchStyle(args: {
  query: string;
  limit: number;
}) {
  const query = args.query.trim();
  const normalized = normalizeExactToken(query);
  const limit = args.limit;

  // Step 1: 精确匹配 style_name 或 aliases
  const exactMatches = await findByNameOrAlias(query, limit);

  if (exactMatches.length > 0) {
    const results = exactMatches.map((m) =>
      toSlim(
        m.payload,
        normalizeExactToken(m.payload.style_name) === normalized ? "name_exact" : "alias_exact"
      )
    );

    return textContent({
      results,
      total: results.length,
      rich_text: buildStyleRichText(exactMatches[0].payload),
      rich_text_summary: compactVisualDescription(exactMatches[0].payload.visual_description ?? ""),
      fallback_suggestion: null,
      hint: "使用 get_style_detail(style_name) 获取完整视觉描述",
    });
  }

  // Step 1.5: 模糊子串匹配（"老钱" → "老钱风"）
  try {
    const fuzzyMatches = await fuzzyMatchByNameOrAlias(query, limit);

    if (fuzzyMatches.length > 0) {
      const results = fuzzyMatches.map((m) => toSlim(m.payload, "fuzzy"));

      return textContent({
        results,
        total: results.length,
        rich_text: buildStyleRichText(fuzzyMatches[0].payload),
        rich_text_summary: compactVisualDescription(fuzzyMatches[0].payload.visual_description ?? ""),
        fallback_suggestion: null,
        hint: "使用 get_style_detail(style_name) 获取完整视觉描述",
      });
    }
  } catch {
    // 模糊匹配失败时跳过，继续语义搜索
  }

  // Step 2: 语义搜索（FashionCLIP 编码 query → 向量近邻）
  try {
    const vector = await encodeText(query);
    const semanticResults = await semanticSearch(vector, limit);

    const filtered = semanticResults.filter(
      (r) => r.score >= CONFIG.SEMANTIC_SCORE_THRESHOLD
    );

    if (filtered.length === 0) {
      return textContent({
        results: [],
        total: 0,
        fallback_suggestion: "未找到匹配风格，建议联网搜索",
      });
    }

    const results = filtered.map((r) =>
      toSlim(r.payload, "semantic", r.score)
    );

    return textContent({
      results,
      total: results.length,
      rich_text: buildStyleRichText(filtered[0].payload),
      rich_text_summary: compactVisualDescription(filtered[0].payload.visual_description ?? ""),
      fallback_suggestion: null,
      hint: "使用 get_style_detail(style_name) 获取完整视觉描述",
    });
  } catch (err) {
    return textContent({
      results: [],
      total: 0,
      fallback_suggestion: `语义搜索失败 (${(err as Error).message})，建议联网搜索`,
    });
  }
}
