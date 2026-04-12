/**
 * update_gallery — 更新图集元数据
 */

import { z } from "zod";
import { updateGallery } from "../db.js";
import { jsonStringCompatibleArray, parseStructuredArgs } from "../tool_input.js";

const updateGalleryRuntimeSchema = z.object({
  gallery_id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z
    .enum(["trend", "collection", "street_style", "editorial", "inspiration"])
    .optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  status: z
    .enum(["draft", "published", "archived"])
    .optional(),
});

export const updateGallerySchema = {
  gallery_id: z.string().describe("图集 ID"),
  title: z.string().optional().describe("新标题"),
  description: z.string().optional().describe("新描述"),
  category: z
    .enum(["trend", "collection", "street_style", "editorial", "inspiration"])
    .optional()
    .describe("新分类"),
  tags: jsonStringCompatibleArray(z.string()).optional().describe("新标签数组（覆盖原有标签）"),
  source: z.string().optional().describe("新来源"),
  status: z
    .enum(["draft", "published", "archived"])
    .optional()
    .describe("新状态"),
};

export async function updateGalleryTool(args: {
  gallery_id: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  source?: string;
  status?: string;
}) {
  try {
    const normalizedArgs = parseStructuredArgs(
      updateGalleryRuntimeSchema,
      args,
      "update_gallery arguments",
    );
    const { gallery_id, ...updates } = normalizedArgs;
    const gallery = await updateGallery(gallery_id, updates);

    if (!gallery) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `图集 ${gallery_id} 不存在`,
            }),
          },
        ],
        isError: true,
      };
    }

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
              updated_at: gallery.updated_at,
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
