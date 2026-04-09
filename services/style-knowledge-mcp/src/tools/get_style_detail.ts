/**
 * Tool: get_style_detail — 按 style_name 获取单条或多条完整风格信息
 */

import { z } from "zod";
import { findByStyleName } from "../qdrant.js";
import { jsonStringCompatibleArray, parseStructuredArgs } from "../tool_input.js";

const getStyleDetailRuntimeSchema = z.object({
  style_name: z.string().optional(),
  style_names: z.array(z.string()).optional(),
});

export const getStyleDetailSchema = {
  style_name: z.string().optional().describe("单个风格英文名"),
  style_names: jsonStringCompatibleArray(z.string()).optional().describe("批量风格英文名列表"),
};

function stripSearchFields(payload: any) {
  const { style_name_text, aliases_text, style_name_norm, aliases_norm, rich_text_text, ...cleanPayload } = payload;
  return cleanPayload;
}

function isFoundStyle(
  value: { input: string; style: unknown } | null,
): value is { input: string; style: unknown } {
  return value !== null;
}

export async function getStyleDetail(args: { style_name?: string; style_names?: string[] }) {
  const normalizedArgs = parseStructuredArgs(getStyleDetailRuntimeSchema, args, "get_style_detail arguments");
  const styleNames = normalizedArgs.style_names ?? (normalizedArgs.style_name ? [normalizedArgs.style_name] : []);

  if (styleNames.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "error", message: "style_name or style_names is required" }),
        },
      ],
      isError: true,
    };
  }

  const rows = await Promise.all(styleNames.map((styleName) => findByStyleName(styleName)));
  const found = rows
    .map((row, index) => (row ? { input: styleNames[index], style: stripSearchFields(row.payload) } : null))
    .filter(isFoundStyle);
  const missing = rows
    .map((row, index) => (row ? null : styleNames[index]))
    .filter((value): value is string => value !== null);

  if (styleNames.length === 1) {
    if (!found[0]) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "not_found", message: `style "${styleNames[0]}" not found` }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok", style: found[0].style }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: missing.length === 0 ? "ok" : "partial",
          styles: found.map((item) => item.style),
          missing,
          returned: found.length,
          requested: styleNames.length,
        }),
      },
    ],
  };
}
