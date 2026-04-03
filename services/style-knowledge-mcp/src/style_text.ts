import type { StyleKnowledge } from './types.js';

export function normalizeExactToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanList(values: unknown[] | undefined, limit?: number): string[] {
  const unique = Array.from(
    new Set((values ?? []).map((item) => String(item).trim()).filter(Boolean)),
  );
  return typeof limit === 'number' ? unique.slice(0, limit) : unique;
}

export function buildStyleRichText(style: Pick<StyleKnowledge,
  | 'style_name'
  | 'aliases'
  | 'visual_description'
  | 'palette'
  | 'silhouette'
  | 'fabric'
  | 'details'
  | 'reference_brands'
  | 'category'
  | 'season_relevance'
  | 'gender'
> & { rich_text?: string }): string {
  if (style.rich_text?.trim()) return style.rich_text.trim();

  const sections: string[] = [];
  const aliases = cleanList(style.aliases, 8);
  const palette = cleanList(style.palette, 6);
  const silhouette = cleanList(style.silhouette, 6);
  const fabric = cleanList(style.fabric, 6);
  const details = cleanList(style.details, 8);
  const brands = cleanList(style.reference_brands, 6);
  const seasons = cleanList(style.season_relevance, 4);

  if (style.style_name.trim()) sections.push(`style_name: ${style.style_name.trim()}`);
  if (aliases.length > 0) sections.push(`aliases: ${aliases.join(', ')}`);
  if (style.category.trim()) sections.push(`category: ${style.category.trim()}`);
  if (style.gender.trim()) sections.push(`gender: ${style.gender.trim()}`);
  if (style.visual_description.trim()) sections.push(`visual_description: ${style.visual_description.trim()}`);
  if (palette.length > 0) sections.push(`palette: ${palette.join(', ')}`);
  if (silhouette.length > 0) sections.push(`silhouette: ${silhouette.join(', ')}`);
  if (fabric.length > 0) sections.push(`fabric: ${fabric.join(', ')}`);
  if (details.length > 0) sections.push(`details: ${details.join(', ')}`);
  if (brands.length > 0) sections.push(`reference_brands: ${brands.join(', ')}`);
  if (seasons.length > 0) sections.push(`season_relevance: ${seasons.join(', ')}`);

  return sections.join('\n');
}

export function withSearchFields(payload: StyleKnowledge): Record<string, unknown> {
  const normalizedStyleName = normalizeExactToken(payload.style_name);
  const normalizedAliases = cleanList(payload.aliases).map((alias) => normalizeExactToken(alias));
  const richText = buildStyleRichText(payload);

  return {
    ...payload,
    rich_text: richText,
    style_name_norm: normalizedStyleName,
    aliases_norm: normalizedAliases,
    style_name_text: normalizedStyleName,
    aliases_text: normalizedAliases.join(' '),
    rich_text_text: richText.toLowerCase(),
  };
}
