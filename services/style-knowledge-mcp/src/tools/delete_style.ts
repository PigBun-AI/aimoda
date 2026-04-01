/**
 * Tool: delete_style — P2
 *
 * 删除一条风格知识（按 style_name）。
 */

import { z } from "zod";
import { deleteByStyleName } from "../qdrant.js";

export const deleteStyleSchema = {
  style_name: z.string().describe("要删除的风格英文名"),
};

export async function deleteStyle(args: { style_name: string }) {
  const deleted = await deleteByStyleName(args.style_name);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          status: deleted ? "ok" : "not_found",
          deleted,
        }),
      },
    ],
  };
}
