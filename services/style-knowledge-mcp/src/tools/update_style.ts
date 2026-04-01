/**
 * Tool: update_style — P2
 *
 * 更新已有风格条目的部分字段。
 * - aliases 默认 append（追加），设 replace_aliases=true 可覆盖
 * - visual_description 变更时自动重新编码向量
 */

import { z } from "zod";
import { findByStyleName, upsertPoint } from "../qdrant.js";
import { encodeText } from "../encoder.js";
import type { StyleKnowledge } from "../types.js";

/** 在 payload 中追加 text 索引辅助字段 */
function withTextFields(payload: StyleKnowledge): Record<string, unknown> {
  return {
    ...payload,
    style_name_text: payload.style_name,
    aliases_text: payload.aliases.join(" "),
  };
}

export const updateStyleSchema = {
  style_name: z.string().describe("要更新的风格英文名"),
  updates: z
    .object({
      aliases: z.array(z.string()).optional(),
      visual_description: z.string().optional(),
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
    })
    .describe("要更新的字段（部分更新）"),
  replace_aliases: z
    .boolean()
    .optional()
    .default(false)
    .describe("true 时覆盖 aliases，否则追加"),
};

export async function updateStyle(args: {
  style_name: string;
  updates: Partial<StyleKnowledge>;
  replace_aliases: boolean;
}) {
  const existing = await findByStyleName(args.style_name);

  if (!existing) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "error",
            message: `style "${args.style_name}" not found`,
            updated_fields: [],
          }),
        },
      ],
    };
  }

  const oldPayload = existing.payload;
  const updatedFields: string[] = [];
  const now = new Date().toISOString();

  // 构建新 payload
  const newPayload: StyleKnowledge = { ...oldPayload, updated_at: now };

  if (args.updates.aliases) {
    if (args.replace_aliases) {
      newPayload.aliases = args.updates.aliases;
    } else {
      newPayload.aliases = Array.from(
        new Set([...oldPayload.aliases, ...args.updates.aliases])
      );
    }
    updatedFields.push("aliases");
  }

  // 简单的字段覆盖
  const simpleFields = [
    "palette",
    "silhouette",
    "fabric",
    "details",
    "reference_brands",
    "category",
    "season_relevance",
    "gender",
    "source",
    "source_url",
    "source_title",
    "confidence",
    "popularity_score",
  ] as const;

  for (const field of simpleFields) {
    if (args.updates[field] !== undefined) {
      (newPayload as any)[field] = args.updates[field];
      updatedFields.push(field);
    }
  }

  // visual_description 变更 → 重新编码向量
  let vector: number[];
  if (
    args.updates.visual_description &&
    args.updates.visual_description !== oldPayload.visual_description
  ) {
    newPayload.visual_description = args.updates.visual_description;
    vector = await encodeText(args.updates.visual_description);
    updatedFields.push("visual_description");
  } else {
    // 使用原向量（重新编码老描述以保持一致性）
    vector = await encodeText(newPayload.visual_description);
  }

  await upsertPoint(existing.id, withTextFields(newPayload), vector);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: "ok",
          updated_fields: updatedFields,
        }),
      },
    ],
  };
}
