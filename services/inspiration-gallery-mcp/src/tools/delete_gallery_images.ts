import { z } from "zod";
import { deleteGalleryImagesByIds } from "../db.js";
import { deleteObjectsByUrls } from "../oss.js";
import { jsonStringCompatibleArray, parseStructuredArgs } from "../tool_input.js";

const deleteGalleryImagesRuntimeSchema = z.object({
  gallery_id: z.string().optional(),
  image_ids: z.array(z.string()).min(1).max(200),
});

export const deleteGalleryImagesSchema = {
  gallery_id: z.string().optional().describe("可选，限制删除范围到单个图集"),
  image_ids: jsonStringCompatibleArray(z.string()).describe("要删除的图片 ID 列表"),
};

export async function deleteGalleryImagesTool(args: { gallery_id?: string; image_ids: string[] }) {
  try {
    const normalizedArgs = parseStructuredArgs(
      deleteGalleryImagesRuntimeSchema,
      args,
      "delete_gallery_images arguments",
    );
    const deletedImages = await deleteGalleryImagesByIds(normalizedArgs.image_ids, normalizedArgs.gallery_id);
    await deleteObjectsByUrls(deletedImages.map((item) => item.image_url));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              deleted: deletedImages.length,
              images: deletedImages.map((item) => ({ id: item.id, gallery_id: item.gallery_id })),
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
