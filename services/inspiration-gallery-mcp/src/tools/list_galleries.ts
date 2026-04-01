/**
 * list_galleries — 列出图集（分页 + 筛选）
 */

import { z } from "zod";
import { listGalleries } from "../db.js";

export const listGalleriesSchema = {
  category: z
    .enum(["trend", "collection", "street_style", "editorial", "inspiration"])
    .optional()
    .describe("按分类筛选"),
  tag: z.string().optional().describe("按标签筛选"),
  status: z
    .enum(["draft", "published", "archived"])
    .optional()
    .describe("按状态筛选（默认 published）"),
  limit: z.number().optional().default(20).describe("每页条数（默认 20）"),
  offset: z.number().optional().default(0).describe("偏移量"),
};

export async function listGalleriesTool(args: {
  category?: string;
  tag?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  try {
    const { galleries, total } = await listGalleries(args);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              galleries: galleries.map((g) => ({
                id: g.id,
                title: g.title,
                category: g.category,
                tags: g.tags,
                cover_url: g.cover_url,
                image_count: g.image_count,
                source: g.source,
                status: g.status,
                created_at: g.created_at,
              })),
              total,
              returned: galleries.length,
              has_more: (args.offset ?? 0) + galleries.length < total,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: (err as Error).message,
          }),
        },
      ],
      isError: true,
    };
  }
}
