/**
 * get_gallery — 获取图集完整详情
 */

import { z } from "zod";
import { getGallery, getGalleryImages } from "../db.js";

export const getGallerySchema = {
  gallery_id: z.string().describe("图集 ID"),
};

export async function getGalleryTool(args: { gallery_id: string }) {
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

    const images = await getGalleryImages(args.gallery_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              gallery: {
                ...gallery,
                images: images.map((img) => ({
                  id: img.id,
                  image_url: img.image_url,
                  caption: img.caption,
                  sort_order: img.sort_order,
                  width: img.width,
                  height: img.height,
                })),
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
