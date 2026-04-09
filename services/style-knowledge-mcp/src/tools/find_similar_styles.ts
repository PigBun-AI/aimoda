import { z } from "zod";
import { findByStyleName, semanticSearch } from "../qdrant.js";
import { encodeText } from "../encoder.js";

export const findSimilarStylesSchema = {
  style_name: z.string().describe("已存在的风格名"),
  limit: z.number().optional().default(5).describe("返回数量上限，默认 5"),
  score_threshold: z.number().optional().default(0.75).describe("相似度阈值，默认 0.75"),
};

export async function findSimilarStylesTool(args: {
  style_name: string;
  limit?: number;
  score_threshold?: number;
}) {
  const existing = await findByStyleName(args.style_name);
  if (!existing) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: `style \"${args.style_name}\" not found` }) }],
      isError: true,
    };
  }

  const vector = await encodeText(existing.payload.rich_text || existing.payload.visual_description || existing.payload.style_name);
  const limit = Math.max(1, Math.min(args.limit ?? 5, 20));
  const threshold = args.score_threshold ?? 0.75;
  const neighbors = await semanticSearch(vector, limit + 1, threshold);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          style_name: existing.payload.style_name,
          neighbors: neighbors
            .filter((item) => item.payload.style_name !== existing.payload.style_name)
            .slice(0, limit)
            .map((item) => ({
              style_name: item.payload.style_name,
              aliases: item.payload.aliases,
              category: item.payload.category,
              similarity_score: item.score,
            })),
        }),
      },
    ],
  };
}
