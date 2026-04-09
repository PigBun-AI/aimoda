import { z } from "zod";
import { batchImportStyles } from "./batch_import.js";
import { jsonStringCompatibleArray, parseStructuredArgs } from "../tool_input.js";

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

const bulkUpsertRuntimeSchema = z.object({
  payload: z.string().optional(),
  styles: z.array(styleItemSchema).optional(),
});

export const bulkUpsertStylesSchema = {
  payload: z.string().optional().describe("JSON 字符串，格式为 {\"styles\":[...]} 或直接为 styles 数组"),
  styles: jsonStringCompatibleArray(styleItemSchema).optional().describe("可直接传 styles 数组"),
};

export async function bulkUpsertStylesTool(args: unknown) {
  const normalizedArgs = parseStructuredArgs(bulkUpsertRuntimeSchema, args, "bulk_upsert_styles arguments");
  let styles = normalizedArgs.styles ?? [];

  if (normalizedArgs.payload) {
    const parsedPayload = JSON.parse(normalizedArgs.payload);
    if (Array.isArray(parsedPayload)) {
      styles = parsedPayload;
    } else if (Array.isArray(parsedPayload?.styles)) {
      styles = parsedPayload.styles;
    } else {
      throw new Error("payload must be a JSON array or an object with styles[]");
    }
  }

  return batchImportStyles({ styles });
}
