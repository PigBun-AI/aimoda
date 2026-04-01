/**
 * delete_gallery — 删除图集及其所有图片
 */

import { z } from "zod";
import { deleteGallery } from "../db.js";
import { deleteGalleryFromOSS } from "../oss.js";

export const deleteGallerySchema = {
  gallery_id: z.string().describe("图集 ID"),
};

export async function deleteGalleryTool(args: { gallery_id: string }) {
  try {
    // Delete from OSS first
    try {
      await deleteGalleryFromOSS(args.gallery_id);
    } catch (err) {
      console.error(`[oss] Failed to clean up gallery ${args.gallery_id}:`, err);
    }

    // Delete from DB (CASCADE deletes gallery_images too)
    const deleted = await deleteGallery(args.gallery_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            deleted,
            gallery_id: args.gallery_id,
          }),
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
