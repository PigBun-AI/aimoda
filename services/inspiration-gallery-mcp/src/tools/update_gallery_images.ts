import { z } from "zod";
import { updateGalleryImages } from "../db.js";
import { jsonStringCompatibleArray, parseStructuredArgs } from "../tool_input.js";

const updateGalleryImagesRuntimeSchema = z.object({
  images: z
    .array(
      z.object({
        id: z.string(),
        caption: z.string().optional(),
        sort_order: z.number().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const updateGalleryImagesSchema = {
  images: jsonStringCompatibleArray(
    z.object({
      id: z.string().describe("图片 ID"),
      caption: z.string().optional().describe("新的图片说明"),
      sort_order: z.number().optional().describe("新的排序值"),
    }),
  )
    .describe("要批量更新的图片"),
};

export async function updateGalleryImagesTool(args: {
  images: Array<{ id: string; caption?: string; sort_order?: number }>;
}) {
  try {
    const normalizedArgs = parseStructuredArgs(
      updateGalleryImagesRuntimeSchema,
      args,
      "update_gallery_images arguments",
    );
    const images = await updateGalleryImages(normalizedArgs.images);
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
