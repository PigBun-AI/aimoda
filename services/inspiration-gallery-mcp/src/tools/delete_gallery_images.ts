import { z } from "zod";
import { deleteGalleryImagesByIds } from "../db.js";
import { deleteObjectsByUrls } from "../oss.js";

export const deleteGalleryImagesSchema = {
  gallery_id: z.string().optional().describe("可选，限制删除范围到单个图集"),
  image_ids: z.array(z.string()).min(1).max(200).describe("要删除的图片 ID 列表"),
};

export async function deleteGalleryImagesTool(args: { gallery_id?: string; image_ids: string[] }) {
  try {
    const deletedImages = await deleteGalleryImagesByIds(args.image_ids, args.gallery_id);
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
