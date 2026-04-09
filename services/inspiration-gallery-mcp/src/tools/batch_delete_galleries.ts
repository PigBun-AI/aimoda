import { z } from "zod";
import { batchDeleteGalleries } from "../db.js";
import { deleteGalleryFromOSS } from "../oss.js";

export const batchDeleteGalleriesSchema = {
  gallery_ids: z.array(z.string()).min(1).max(100).describe("要删除的图集 ID 列表"),
};

export async function batchDeleteGalleriesTool(args: { gallery_ids: string[] }) {
  try {
    await Promise.all(
      args.gallery_ids.map(async (galleryId) => {
        try {
          await deleteGalleryFromOSS(galleryId);
        } catch (err) {
          console.error(`[oss] Failed to clean up gallery ${galleryId}:`, err);
        }
      }),
    );

    const deletedIds = await batchDeleteGalleries(args.gallery_ids);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: true, deleted: deletedIds.length, gallery_ids: deletedIds }, null, 2),
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
