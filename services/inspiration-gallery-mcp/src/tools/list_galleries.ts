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
  description_empty: z.boolean().optional().describe("仅返回 description 为空的图集"),
  image_count_gt: z.number().optional().describe("仅返回图片数量大于该值的图集"),
  created_before: z.string().optional().describe("仅返回早于该时间创建的图集（ISO 时间）"),
  include_description: z.boolean().optional().default(false).describe("是否在列表中返回 description"),
  include_images: z.boolean().optional().default(false).describe("是否在列表中返回图片预览"),
  image_limit: z.number().optional().default(12).describe("列表模式下每个图集返回的图片数量上限"),
  limit: z.number().optional().default(20).describe("每页条数（默认 20）"),
  offset: z.number().optional().default(0).describe("偏移量"),
};

export async function listGalleriesTool(args: {
  category?: string;
  tag?: string;
  status?: string;
  description_empty?: boolean;
  image_count_gt?: number;
  created_before?: string;
  include_description?: boolean;
  include_images?: boolean;
  image_limit?: number;
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
                ...(args.include_description ? { description: g.description } : {}),
                ...(args.include_images ? { images: g.images ?? [] } : {}),
              })),
              total,
              returned: galleries.length,
              has_more: (args.offset ?? 0) + galleries.length < total,
              filters: {
                category: args.category ?? null,
                tag: args.tag ?? null,
                status: args.status ?? "published",
                description_empty: args.description_empty ?? false,
                image_count_gt: args.image_count_gt ?? null,
                created_before: args.created_before ?? null,
              },
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
