/**
 * Tool: get_style_detail — 按 style_name 获取单条完整风格信息
 *
 * 返回完整的 StyleKnowledge（含 visual_description、palette、fabric 等全部字段）。
 * Agent 在 search_style 得到精简结果后，按需调用此工具获取完整详情。
 */

import { z } from "zod";
import { findByStyleName } from "../qdrant.js";

export const getStyleDetailSchema = {
  style_name: z
    .string()
    .describe("风格英文名（从 search_style 结果中获取）"),
};

export async function getStyleDetail(args: { style_name: string }) {
  const result = await findByStyleName(args.style_name);

  if (!result) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "not_found",
            message: `style "${args.style_name}" not found`,
          }),
        },
      ],
    };
  }

  // 返回完整 payload（排除 text 索引辅助字段）
  const { style_name_text, aliases_text, ...cleanPayload } =
    result.payload as any;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "ok",
          style: cleanPayload,
        }),
      },
    ],
  };
}
