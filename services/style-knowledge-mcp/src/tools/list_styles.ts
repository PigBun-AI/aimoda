/**
 * Tool: list_styles — P1
 *
 * 列出知识库中的风格条目（简化版，不含 visual_description 全文）。
 * 支持按 category / source 筛选，支持分页。
 */

import { z } from "zod";
import { scrollPoints, countPoints } from "../qdrant.js";
import type { ListStyleItem } from "../types.js";

export const listStylesSchema = {
  category: z.string().optional().describe("按风格大类筛选"),
  source: z.string().optional().describe("按来源筛选"),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("返回数量上限，默认 20（避免占满上下文）"),
  offset: z
    .string()
    .optional()
    .describe("分页 offset（从上一次返回的 next_offset 获取）"),
};

export async function listStyles(args: {
  category?: string;
  source?: string;
  limit: number;
  offset?: string;
}) {
  const filterObj = {
    category: args.category,
    source: args.source,
  };

  // 并行获取数据和总数
  const [scrollResult, totalCount] = await Promise.all([
    scrollPoints(args.limit, filterObj, args.offset ?? null),
    countPoints(filterObj),
  ]);

  const styles: ListStyleItem[] = scrollResult.points.map((pt) => ({
    style_name: pt.payload.style_name,
    aliases: pt.payload.aliases,
    category: pt.payload.category,
    confidence: pt.payload.confidence,
    updated_at: pt.payload.updated_at,
  }));

  const result = {
    styles,
    returned: styles.length,
    total_count: totalCount,
    next_offset: scrollResult.nextOffset,
    has_more: scrollResult.nextOffset !== null,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 0) }],
  };
}
