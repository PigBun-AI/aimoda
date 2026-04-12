/**
 * create_gallery — 创建图集
 */

import { z } from "zod";
import { createGallery } from "../db.js";
import { jsonStringCompatibleArray, parseStructuredArgs } from "../tool_input.js";

const createGalleryRuntimeSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  category: z
    .enum(["trend", "collection", "street_style", "editorial", "inspiration"])
    .optional()
    .default("inspiration"),
  tags: z.array(z.string()).optional().default([]),
  source: z.string().optional().default("manual"),
  status: z
    .enum(["draft", "published", "archived"])
    .optional()
    .default("published"),
});

export const createGallerySchema = {
  title: z.string().describe("图集标题"),
  description: z.string().optional().describe("图集描述"),
  category: z
    .enum(["trend", "collection", "street_style", "editorial", "inspiration"])
    .optional()
    .default("inspiration")
    .describe("分类: trend/collection/street_style/editorial/inspiration"),
  tags: jsonStringCompatibleArray(z.string())
    .optional()
    .describe("标签数组，如 ['minimalist', 'ss25', 'runway']"),
  source: z.string().optional().default("manual").describe("来源: vogue/pinterest/xiaohongshu/manual"),
  status: z
    .enum(["draft", "published", "archived"])
    .optional()
    .default("published")
    .describe("状态: draft/published/archived"),
};

export async function createGalleryTool(args: {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  source?: string;
  status?: string;
}) {
  try {
    const normalizedArgs = parseStructuredArgs(
      createGalleryRuntimeSchema,
      args,
      "create_gallery arguments",
    );
    const gallery = await createGallery({
      title: normalizedArgs.title,
      description: normalizedArgs.description,
      category: normalizedArgs.category,
      tags: normalizedArgs.tags,
      source: normalizedArgs.source,
      status: normalizedArgs.status,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              gallery_id: gallery.id,
              title: gallery.title,
              category: gallery.category,
              status: gallery.status,
              message: `图集「${gallery.title}」创建成功。接下来可调用 add_images(gallery_id="${gallery.id}") 上传图片。`,
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
