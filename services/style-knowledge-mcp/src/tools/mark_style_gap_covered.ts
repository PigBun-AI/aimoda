import { z } from "zod";
import { markStyleGapCovered } from "../feedback_db.js";

export const markStyleGapCoveredSchema = {
  signal_id: z.string().optional().describe("缺口记录 ID，优先使用"),
  query_normalized: z.string().optional().describe("归一化后的缺口词，作为备用定位方式"),
  linked_style_name: z.string().optional().describe("最终补入知识库的标准风格名"),
  resolution_note: z.string().optional().describe("处理备注，如采集来源、处理策略"),
  resolved_by: z.string().optional().default("openclaw").describe("执行闭环的 Agent 或操作者"),
};

export async function markStyleGapCoveredTool(args: {
  signal_id?: string;
  query_normalized?: string;
  linked_style_name?: string;
  resolution_note?: string;
  resolved_by?: string;
}) {
  if (!args.signal_id && !args.query_normalized) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "error",
            message: "signal_id or query_normalized is required",
          }),
        },
      ],
    };
  }

  const result = await markStyleGapCovered(args);
  if (!result) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "not_found",
            message: "style gap signal not found",
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "ok",
          gap: result,
        }),
      },
    ],
  };
}
