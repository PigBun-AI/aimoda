import { z } from "zod";
import { detectAliasDuplicates, detectSemanticDuplicates, loadAllStyles } from "../style_admin.js";

export const detectDuplicatesSchema = {
  mode: z.enum(["alias", "semantic", "both"]).optional().default("both").describe("检测模式"),
  semantic_threshold: z.number().optional().default(0.92).describe("语义重复阈值"),
};

export async function detectDuplicatesTool(args: { mode?: "alias" | "semantic" | "both"; semantic_threshold?: number }) {
  const styles = await loadAllStyles();
  const mode = args.mode ?? "both";
  const aliasDuplicates = mode === "alias" || mode === "both" ? detectAliasDuplicates(styles) : [];
  const semanticDuplicates = mode === "semantic" || mode === "both" ? await detectSemanticDuplicates(styles, args.semantic_threshold ?? 0.92) : [];

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        success: true,
        mode,
        alias_duplicates: aliasDuplicates,
        semantic_duplicates: semanticDuplicates,
      }),
    }],
  };
}
