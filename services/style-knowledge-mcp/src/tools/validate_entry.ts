import { z } from "zod";
import { addStyleSchema } from "./add_style.js";
import { jsonStringCompatibleArray, jsonStringCompatibleObject, parseStructuredArgs } from "../tool_input.js";
import { validateStyleEntries } from "../style_admin.js";

const singleEntrySchema = z.object({
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

const validateEntryRuntimeSchema = z.object({
  entry: singleEntrySchema.optional(),
  entries: z.array(singleEntrySchema).optional(),
  min_visual_words: z.number().optional().default(12),
  low_confidence_threshold: z.number().optional().default(0.5),
});

export const validateEntrySchema = {
  entry: jsonStringCompatibleObject(addStyleSchema).optional().describe("单条风格记录"),
  entries: jsonStringCompatibleArray(singleEntrySchema).optional().describe("多条风格记录"),
  min_visual_words: z.number().optional().default(12).describe("visual_description 最小建议词数"),
  low_confidence_threshold: z.number().optional().default(0.5).describe("低置信度阈值"),
};

export async function validateEntryTool(args: unknown) {
  const normalizedArgs = parseStructuredArgs(validateEntryRuntimeSchema, args, "validate_entry arguments");
  const entries = normalizedArgs.entries ?? (normalizedArgs.entry ? [normalizedArgs.entry] : []);
  if (entries.length === 0) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "entry or entries is required" }) }],
      isError: true,
    };
  }

  const issues = validateStyleEntries(entries, {
    minVisualWords: normalizedArgs.min_visual_words,
    lowConfidenceThreshold: normalizedArgs.low_confidence_threshold,
  });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        checked: entries.length,
        issue_count: issues.length,
        issues,
      }),
    }],
  };
}
