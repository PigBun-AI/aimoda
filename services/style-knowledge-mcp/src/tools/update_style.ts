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
import { buildStyleRichText, withSearchFields } from "../style_text.js";
import {
  jsonStringCompatibleArray,
  jsonStringCompatibleObject,
  parseStructuredArgs,
} from "../tool_input.js";

const updateFieldsRuntimeSchema = z.object({
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
});

const updateStyleRuntimeSchema = z.object({
  style_name: z.string(),
  updates: updateFieldsRuntimeSchema,
  replace_aliases: z.boolean().optional().default(false),
});

export const updateStyleSchema = {
  style_name: z.string().describe("要更新的风格英文名"),
  updates: jsonStringCompatibleObject({
      aliases: jsonStringCompatibleArray(z.string()).optional(),
      visual_description: z.string().optional(),
      palette: jsonStringCompatibleArray(z.string()).optional(),
      silhouette: jsonStringCompatibleArray(z.string()).optional(),
      fabric: jsonStringCompatibleArray(z.string()).optional(),
      details: jsonStringCompatibleArray(z.string()).optional(),
      reference_brands: jsonStringCompatibleArray(z.string()).optional(),
      category: z.string().optional(),
      season_relevance: jsonStringCompatibleArray(z.string()).optional(),
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
  const normalizedArgs = parseStructuredArgs(
    updateStyleRuntimeSchema,
    args,
    "update_style arguments",
  );

  const existing = await findByStyleName(normalizedArgs.style_name);

  if (!existing) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "error",
            message: `style "${normalizedArgs.style_name}" not found`,
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

  if (normalizedArgs.updates.aliases) {
    if (normalizedArgs.replace_aliases) {
      newPayload.aliases = normalizedArgs.updates.aliases;
    } else {
      newPayload.aliases = Array.from(
        new Set([...oldPayload.aliases, ...normalizedArgs.updates.aliases])
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
    if (normalizedArgs.updates[field] !== undefined) {
      (newPayload as any)[field] = normalizedArgs.updates[field];
      updatedFields.push(field);
    }
  }

  // visual_description 变更 → 重新编码向量
  let vector: number[];
  if (
    normalizedArgs.updates.visual_description &&
    normalizedArgs.updates.visual_description !== oldPayload.visual_description
  ) {
    newPayload.visual_description = normalizedArgs.updates.visual_description;
    updatedFields.push("visual_description");
  }

  newPayload.rich_text = buildStyleRichText(newPayload);
  vector = await encodeText(newPayload.rich_text);

  await upsertPoint(existing.id, withSearchFields(newPayload), vector);

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
