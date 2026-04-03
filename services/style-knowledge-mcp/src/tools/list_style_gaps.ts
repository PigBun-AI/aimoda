import { z } from "zod";
import { listStyleGaps } from "../feedback_db.js";

export const listStyleGapsSchema = {
  status: z
    .enum(["open", "covered", "ignored"])
    .optional()
    .default("open")
    .describe("缺口状态筛选，默认 open"),
  limit: z.number().optional().default(20).describe("返回数量上限，默认 20，最大 100"),
  offset: z.number().optional().default(0).describe("分页偏移量，默认 0"),
  min_hits: z.number().optional().default(1).describe("最小触发次数，默认 1"),
};

export async function listStyleGapsTool(args: {
  status?: "open" | "covered" | "ignored";
  limit?: number;
  offset?: number;
  min_hits?: number;
}) {
  const status = args.status ?? "open";
  const limit = args.limit ?? 20;
  const offset = args.offset ?? 0;
  const minHits = args.min_hits ?? 1;

  const result = await listStyleGaps({
    status,
    limit,
    offset,
    min_hits: minHits,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          gaps: result.gaps,
          pagination: {
            status,
            limit: Math.max(1, Math.min(limit, 100)),
            offset: Math.max(0, offset),
            min_hits: Math.max(1, minHits),
            total: result.total,
            returned: result.gaps.length,
          },
        }),
      },
    ],
  };
}
