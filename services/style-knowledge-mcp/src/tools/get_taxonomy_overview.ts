import { buildTaxonomyOverview, loadAllStyles } from "../style_admin.js";

export const getTaxonomyOverviewSchema = {};

export async function getTaxonomyOverviewTool() {
  const styles = await loadAllStyles();
  const overview = buildTaxonomyOverview(styles);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(overview),
      },
    ],
  };
}
