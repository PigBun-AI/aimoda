import test from "node:test";
import assert from "node:assert/strict";

import { buildTaxonomyOverview, detectAliasDuplicates, validateStyleEntries } from "./style_admin.js";
import type { StyleKnowledge } from "./types.js";

const baseStyle = (overrides: Partial<StyleKnowledge>): StyleKnowledge => ({
  style_name: "quiet_luxury",
  aliases: ["静奢风", "quiet luxury"],
  visual_description: "muted tailoring with soft neutral layering and refined luxury accessories",
  rich_text: "",
  palette: ["cream"],
  silhouette: ["tailored"],
  fabric: ["wool"],
  details: ["clean lines"],
  reference_brands: ["The Row"],
  category: "luxury",
  season_relevance: ["fw"],
  gender: "women",
  source: "manual",
  source_url: "",
  source_title: "",
  created_at: "2026-04-09T00:00:00.000Z",
  updated_at: "2026-04-10T00:00:00.000Z",
  confidence: 0.8,
  popularity_score: 0.2,
  ...overrides,
});

test("buildTaxonomyOverview aggregates categories and latest update", () => {
  const overview = buildTaxonomyOverview([
    baseStyle({ style_name: "quiet_luxury", category: "luxury", updated_at: "2026-04-08T00:00:00.000Z" }),
    baseStyle({ style_name: "soft_girl", category: "romantic", updated_at: "2026-04-10T00:00:00.000Z", confidence: 0.3 }),
    baseStyle({ style_name: "old_money", category: "luxury", updated_at: "2026-04-09T00:00:00.000Z" }),
  ]);

  assert.deepEqual(overview.categories, { luxury: 2, romantic: 1 });
  assert.equal(overview.low_confidence_count, 1);
  assert.equal(overview.total, 3);
  assert.equal(overview.last_updated, "2026-04-10T00:00:00.000Z");
});

test("detectAliasDuplicates finds shared aliases across styles", () => {
  const duplicates = detectAliasDuplicates([
    baseStyle({ style_name: "soft_girl", aliases: ["少女感", "soft girl"] }),
    baseStyle({ style_name: "balletcore", aliases: ["少女感", "ballet core"] }),
  ]);

  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0].shared_aliases, ["少女感"]);
});

test("validateStyleEntries flags missing Chinese alias and invalid category", () => {
  const issues = validateStyleEntries([
    {
      style_name: "animecore",
      aliases: ["animecore"],
      visual_description: "anime inspired",
      category: "unknown",
      confidence: 0.4,
      palette: [],
    },
  ]);

  assert.ok(issues.some((issue) => issue.code === "missing_chinese_alias"));
  assert.ok(issues.some((issue) => issue.code === "invalid_category"));
  assert.ok(issues.some((issue) => issue.code === "low_confidence"));
});
