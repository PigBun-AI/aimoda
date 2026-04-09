import { z } from "zod";
import { loadAllStyles } from "../style_admin.js";

function toCsvRow(fields: string[]): string {
  return fields
    .map((field) => {
      const escaped = field.replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(",");
}

export const exportKbSchema = {
  format: z.enum(["json", "csv"]).optional().default("json").describe("导出格式"),
};

export async function exportKbTool(args: { format?: "json" | "csv" }) {
  const styles = await loadAllStyles();
  const format = args.format ?? "json";

  if (format === "csv") {
    const header = ["style_name", "aliases", "category", "confidence", "updated_at", "visual_description"];
    const rows = styles.map((style) =>
      toCsvRow([
        style.style_name,
        style.aliases.join(" | "),
        style.category ?? "",
        String(style.confidence ?? ""),
        style.updated_at ?? "",
        style.visual_description ?? "",
      ]),
    );

    return {
      content: [{ type: "text" as const, text: [toCsvRow(header), ...rows].join("\n") }],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, total: styles.length, styles }),
      },
    ],
  };
}
