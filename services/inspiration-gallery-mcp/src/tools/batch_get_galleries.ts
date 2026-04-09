import { z } from "zod";
import { batchGetGalleries } from "../db.js";

export const batchGetGalleriesSchema = {
  gallery_ids: z.array(z.string()).min(1).max(100).describe("批量图集 ID 列表"),
  include_images: z.boolean().optional().default(false).describe("是否包含图片列表"),
  include_description: z.boolean().optional().default(true).describe("是否包含描述"),
  image_limit: z.number().optional().default(12).describe("每个图集最多返回多少张图片"),
};

export async function batchGetGalleriesTool(args: {
  gallery_ids: string[];
  include_images?: boolean;
  include_description?: boolean;
  image_limit?: number;
}) {
  try {
    const galleries = await batchGetGalleries(args.gallery_ids, {
      includeImages: args.include_images ?? false,
      includeDescription: args.include_description ?? true,
      imageLimit: args.image_limit ?? 12,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              galleries,
              returned: galleries.length,
              requested: args.gallery_ids.length,
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
          text: JSON.stringify({ success: false, error: (err as Error).message }),
        },
      ],
      isError: true,
    };
  }
}
