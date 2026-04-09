/**
 * Tool: batch_import_styles — P1
 *
 * 批量导入风格数据。
 * - 已存在的 style_name 自动合并
 * - 新的 style_name 创建新条目
 * - 所有 visual_description 自动编码为向量
 */

import { z } from "zod";
import { addStyle } from "./add_style.js";
import {
  jsonStringCompatibleArray,
  parseStructuredArgs,
} from "../tool_input.js";

const styleItemSchema = z.object({
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

const batchImportRuntimeSchema = z.object({
  styles: z.array(styleItemSchema),
});

export const batchImportSchema = {
  styles: jsonStringCompatibleArray(styleItemSchema)
    .describe("风格条目列表（格式同 add_style 参数）"),
};

export async function batchImportStyles(args: {
  styles: Array<z.infer<typeof styleItemSchema>>;
}) {
  const normalizedArgs = parseStructuredArgs(
    batchImportRuntimeSchema,
    args,
    "batch_import_styles arguments",
  );
  let created = 0;
  let merged = 0;
  const errors: Array<{ style_name: string; error: string }> = [];

  for (const style of normalizedArgs.styles) {
    try {
      const result = await addStyle(style as any);
      const parsed = JSON.parse(result.content[0].text);
      if (parsed.merged) {
        merged++;
      } else {
        created++;
      }
    } catch (err) {
      errors.push({
        style_name: style.style_name,
        error: (err as Error).message,
      });
    }
  }

  const response = {
    status: errors.length === 0 ? "ok" : "partial",
    total: normalizedArgs.styles.length,
    created,
    merged,
    errors,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(response) }],
  };
}
