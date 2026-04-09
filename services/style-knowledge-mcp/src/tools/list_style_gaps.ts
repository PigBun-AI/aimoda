import { z } from "zod";
import { listStyleGaps } from "../feedback_db.js";
import { encodeText } from "../encoder.js";
import { semanticSearch } from "../qdrant.js";

export const listStyleGapsSchema = {
  status: z
    .enum(["open", "covered", "ignored"])
    .optional()
    .default("open")
    .describe("缺口状态筛选，默认 open"),
  limit: z.number().optional().default(20).describe("返回数量上限，默认 20，最大 100"),
  offset: z.number().optional().default(0).describe("分页偏移量，默认 0"),
  min_hits: z.number().optional().default(1).describe("最小触发次数，默认 1"),
  include_nearest: z.boolean().optional().default(true).describe("是否返回最接近的已有风格建议"),
};

async function enrichNearestStyle(gap: { query_raw?: string; query_normalized: string }) {
  const query = (gap.query_raw || gap.query_normalized || "").trim();
  if (!query) return null;

  try {
    const vector = await encodeText(query);
    const matches = await semanticSearch(vector, 1, 0.5);
    const nearest = matches[0];
    if (!nearest) return null;
    return {
      nearest_style_name: nearest.payload.style_name,
      similarity_score: nearest.score,
    };
  } catch {
    return null;
  }
}

export async function listStyleGapsTool(args: {
  status?: "open" | "covered" | "ignored";
  limit?: number;
  offset?: number;
  min_hits?: number;
  include_nearest?: boolean;
}) {
  const status = args.status ?? "open";
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const minHits = args.min_hits ?? 1;
  const includeNearest = args.include_nearest ?? true;

  const result = await listStyleGaps({
    status,
    limit,
    offset,
    min_hits: minHits,
  });

  const gaps = includeNearest
    ? await Promise.all(
        result.gaps.map(async (gap) => ({
          ...gap,
          ...(await enrichNearestStyle(gap)),
        })),
      )
    : result.gaps;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          gaps,
          pagination: {
            status,
            limit: Math.max(1, Math.min(limit, 100)),
            offset: Math.max(0, offset),
            min_hits: Math.max(1, minHits),
            total: result.total,
            returned: gaps.length,
          },
        }),
      },
    ],
  };
}
