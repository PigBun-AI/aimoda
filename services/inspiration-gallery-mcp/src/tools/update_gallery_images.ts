import { z } from "zod";
import { updateGalleryImages } from "../db.js";

export const updateGalleryImagesSchema = {
  images: z
    .array(
      z.object({
        id: z.string().describe("图片 ID"),
        caption: z.string().optional().describe("新的图片说明"),
        sort_order: z.number().optional().describe("新的排序值"),
      }),
    )
    .min(1)
    .max(200)
    .describe("要批量更新的图片"),
};

export async function updateGalleryImagesTool(args: {
  images: Array<{ id: string; caption?: string; sort_order?: number }>;
}) {
  try {
    const images = await updateGalleryImages(args.images);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: true, updated: images.length, images }, null, 2),
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
