import { encodeText } from "./encoder.js";
import { semanticSearch, scrollPoints } from "./qdrant.js";
import { normalizeExactToken } from "./style_text.js";
import type { AddStyleInput, StyleKnowledge } from "./types.js";

export interface TaxonomyOverview {
  categories: Record<string, number>;
  low_confidence_count: number;
  total: number;
  last_updated: string | null;
}

export interface DuplicateMatch {
  type: "alias" | "semantic";
  left_style_name: string;
  right_style_name: string;
  shared_aliases?: string[];
  similarity_score?: number;
}

export interface StyleValidationIssue {
  style_name: string;
  severity: "error" | "warning";
  field: string;
  code:
    | "missing_visual_description"
    | "short_visual_description"
    | "missing_chinese_alias"
    | "low_confidence"
    | "empty_structured_field"
    | "invalid_category";
  message: string;
}

const VALID_CATEGORIES = new Set([
  "avant_garde",
  "bohemian",
  "classic",
  "contemporary",
  "darkwear",
  "formal",
  "genderless",
  "luxury",
  "minimalist",
  "modern",
  "outdoor",
  "punk",
  "romantic",
  "sport",
  "streetwear",
  "tailoring",
  "vintage",
  "workwear",
  "youth",
]);

function extractChineseAliases(aliases: string[]): string[] {
  return aliases.filter((alias) => /[\u3400-\u9FFF]/.test(alias));
}

export function buildTaxonomyOverview(styles: StyleKnowledge[]): TaxonomyOverview {
  const categories: Record<string, number> = {};
  let lowConfidenceCount = 0;
  let lastUpdated: string | null = null;

  for (const style of styles) {
    const category = (style.category || "uncategorized").trim() || "uncategorized";
    categories[category] = (categories[category] ?? 0) + 1;
    if ((style.confidence ?? 0) < 0.5) {
      lowConfidenceCount += 1;
    }
    if (!lastUpdated || new Date(style.updated_at).getTime() > new Date(lastUpdated).getTime()) {
      lastUpdated = style.updated_at;
    }
  }

  return {
    categories: Object.fromEntries(Object.entries(categories).sort((a, b) => a[0].localeCompare(b[0]))),
    low_confidence_count: lowConfidenceCount,
    total: styles.length,
    last_updated: lastUpdated,
  };
}

export function validateStyleEntries(
  entries: Array<Pick<AddStyleInput, "style_name" | "aliases" | "visual_description" | "category" | "confidence"> & Partial<AddStyleInput>>,
  opts?: { minVisualWords?: number; lowConfidenceThreshold?: number },
): StyleValidationIssue[] {
  const issues: StyleValidationIssue[] = [];
  const minVisualWords = opts?.minVisualWords ?? 12;
  const lowConfidenceThreshold = opts?.lowConfidenceThreshold ?? 0.5;

  for (const entry of entries) {
    const styleName = entry.style_name;
    const visualDescription = (entry.visual_description ?? "").trim();
    const wordCount = visualDescription.split(/\s+/).filter(Boolean).length;
    if (!visualDescription) {
      issues.push({
        style_name: styleName,
        severity: "error",
        field: "visual_description",
        code: "missing_visual_description",
        message: "visual_description 不能为空",
      });
    } else if (wordCount < minVisualWords) {
      issues.push({
        style_name: styleName,
        severity: "warning",
        field: "visual_description",
        code: "short_visual_description",
        message: `visual_description 过短（${wordCount} 词，建议至少 ${minVisualWords} 词）`,
      });
    }

    if (extractChineseAliases(entry.aliases ?? []).length === 0) {
      issues.push({
        style_name: styleName,
        severity: "warning",
        field: "aliases",
        code: "missing_chinese_alias",
        message: "aliases 缺少中文别名",
      });
    }

    if ((entry.confidence ?? 1) < lowConfidenceThreshold) {
      issues.push({
        style_name: styleName,
        severity: "warning",
        field: "confidence",
        code: "low_confidence",
        message: `confidence 低于阈值 ${lowConfidenceThreshold}`,
      });
    }

    const structuredFields: Array<keyof AddStyleInput> = ["palette", "fabric", "details", "reference_brands"];
    for (const field of structuredFields) {
      const value = entry[field];
      if (Array.isArray(value) && value.length === 0) {
        issues.push({
          style_name: styleName,
          severity: "warning",
          field,
          code: "empty_structured_field",
          message: `${field} 为空数组`,
        });
      }
    }

    if (entry.category && !VALID_CATEGORIES.has(entry.category)) {
      issues.push({
        style_name: styleName,
        severity: "warning",
        field: "category",
        code: "invalid_category",
        message: `category \"${entry.category}\" 不在规范枚举中`,
      });
    }
  }

  return issues;
}

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("::");
}

export function detectAliasDuplicates(styles: StyleKnowledge[]): DuplicateMatch[] {
  const aliasMap = new Map<string, string[]>();
  for (const style of styles) {
    for (const alias of style.aliases ?? []) {
      const normalized = normalizeExactToken(alias);
      if (!normalized) continue;
      const owners = aliasMap.get(normalized) ?? [];
      owners.push(style.style_name);
      aliasMap.set(normalized, owners);
    }
  }

  const duplicates = new Map<string, DuplicateMatch>();
  for (const [alias, owners] of aliasMap) {
    const uniqueOwners = Array.from(new Set(owners)).sort();
    if (uniqueOwners.length < 2) continue;
    for (let i = 0; i < uniqueOwners.length; i += 1) {
      for (let j = i + 1; j < uniqueOwners.length; j += 1) {
        const key = pairKey(uniqueOwners[i], uniqueOwners[j]);
        const existing = duplicates.get(key);
        if (existing) {
          existing.shared_aliases = Array.from(new Set([...(existing.shared_aliases ?? []), alias]));
        } else {
          duplicates.set(key, {
            type: "alias",
            left_style_name: uniqueOwners[i],
            right_style_name: uniqueOwners[j],
            shared_aliases: [alias],
          });
        }
      }
    }
  }

  return Array.from(duplicates.values()).sort((a, b) => {
    const aliasDiff = (b.shared_aliases?.length ?? 0) - (a.shared_aliases?.length ?? 0);
    return aliasDiff || a.left_style_name.localeCompare(b.left_style_name);
  });
}

export async function detectSemanticDuplicates(styles: StyleKnowledge[], threshold = 0.92): Promise<DuplicateMatch[]> {
  const seen = new Set<string>();
  const duplicates: DuplicateMatch[] = [];

  for (const style of styles) {
    const vector = await encodeText(style.rich_text || style.visual_description || style.style_name);
    const neighbors = await semanticSearch(vector, 8, threshold);
    for (const neighbor of neighbors) {
      const otherName = neighbor.payload.style_name;
      if (otherName === style.style_name) continue;
      const key = pairKey(style.style_name, otherName);
      if (seen.has(key)) continue;
      seen.add(key);
      duplicates.push({
        type: "semantic",
        left_style_name: style.style_name,
        right_style_name: otherName,
        similarity_score: neighbor.score,
      });
    }
  }

  return duplicates.sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
}

export async function loadAllStyles(): Promise<StyleKnowledge[]> {
  const styles: StyleKnowledge[] = [];
  let offset: string | number | null = null;

  do {
    const page = await scrollPoints(128, undefined, offset);
    styles.push(...page.points.map((pt) => pt.payload));
    offset = page.nextOffset;
  } while (offset !== null);

  return styles;
}
