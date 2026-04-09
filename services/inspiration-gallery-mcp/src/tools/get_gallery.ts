/**
 * get_gallery — 获取图集完整详情
 */

import { z } from "zod";
import { getGallery, getGalleryImages } from "../db.js";

export const getGallerySchema = {
  gallery_id: z.string().describe("图集 ID"),
  include_images: z.boolean().optional().default(true).describe("是否返回图片列表"),
  limit: z.number().optional().default(200).describe("图片分页大小"),
  offset: z.number().optional().default(0).describe("图片分页偏移量"),
};

export async function getGalleryTool(args: {
  gallery_id: string;
  include_images?: boolean;
  limit?: number;
  offset?: number;
}) {
  try {
    const gallery = await getGallery(args.gallery_id);
    if (!gallery) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `图集 ${args.gallery_id} 不存在`,
            }),
          },
        ],
        isError: true,
      };
    }

    const includeImages = args.include_images ?? true;
    const imageResult = includeImages
      ? await getGalleryImages(args.gallery_id, {
          limit: args.limit,
          offset: args.offset,
        })
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              gallery: {
                ...gallery,
                ...(includeImages
                  ? {
                      images: imageResult?.images.map((img) => ({
                        id: img.id,
                        image_url: img.image_url,
                        caption: img.caption,
                        sort_order: img.sort_order,
                        width: img.width,
                        height: img.height,
                      })),
                    }
                  : {}),
              },
              ...(includeImages
                ? {
                    pagination: {
                      total: imageResult?.total ?? 0,
                      returned: imageResult?.returned ?? 0,
                      has_more: imageResult?.has_more ?? false,
                      limit: imageResult?.limit ?? args.limit ?? 200,
                      offset: imageResult?.offset ?? args.offset ?? 0,
                    },
                  }
                : {}),
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
