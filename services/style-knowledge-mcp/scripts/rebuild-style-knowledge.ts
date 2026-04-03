import { getClient, ensureCollection, upsertPoint } from '../src/qdrant.js';
import { CONFIG } from '../src/config.js';
import type { StyleKnowledge } from '../src/types.js';
import { buildStyleRichText, withSearchFields } from '../src/style_text.js';
import { encodeText } from '../src/encoder.js';

const AUXILIARY_FIELDS = new Set([
  'style_name_text',
  'aliases_text',
  'style_name_norm',
  'aliases_norm',
  'rich_text_text',
]);

function sanitizePayload(payload: Record<string, unknown>): StyleKnowledge {
  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !AUXILIARY_FIELDS.has(key)),
  ) as unknown as Partial<StyleKnowledge>;

  return {
    style_name: String(cleaned.style_name ?? '').trim(),
    aliases: Array.isArray(cleaned.aliases) ? cleaned.aliases.map((item) => String(item)) : [],
    visual_description: String(cleaned.visual_description ?? '').trim(),
    rich_text: String(cleaned.rich_text ?? '').trim(),
    palette: Array.isArray(cleaned.palette) ? cleaned.palette.map((item) => String(item)) : [],
    silhouette: Array.isArray(cleaned.silhouette) ? cleaned.silhouette.map((item) => String(item)) : [],
    fabric: Array.isArray(cleaned.fabric) ? cleaned.fabric.map((item) => String(item)) : [],
    details: Array.isArray(cleaned.details) ? cleaned.details.map((item) => String(item)) : [],
    reference_brands: Array.isArray(cleaned.reference_brands) ? cleaned.reference_brands.map((item) => String(item)) : [],
    category: String(cleaned.category ?? '').trim(),
    season_relevance: Array.isArray(cleaned.season_relevance) ? cleaned.season_relevance.map((item) => String(item)) : [],
    gender: String(cleaned.gender ?? 'unisex').trim() || 'unisex',
    source: String(cleaned.source ?? '').trim(),
    source_url: String(cleaned.source_url ?? '').trim(),
    source_title: String(cleaned.source_title ?? '').trim(),
    created_at: String(cleaned.created_at ?? new Date().toISOString()),
    updated_at: String(cleaned.updated_at ?? new Date().toISOString()),
    confidence: Number(cleaned.confidence ?? 0.6),
    popularity_score: Number(cleaned.popularity_score ?? 0),
  };
}

async function loadAllPoints() {
  const client = getClient();
  let offset: string | number | null | undefined = undefined;
  const points: Array<{ id: string | number; payload: StyleKnowledge }> = [];

  while (true) {
    const result = await client.scroll(CONFIG.QDRANT_COLLECTION, {
      with_payload: true,
      limit: 100,
      offset,
    });
    for (const point of result.points) {
      points.push({ id: point.id as string | number, payload: sanitizePayload(point.payload as Record<string, unknown>) });
    }
    if (!result.next_page_offset) break;
    offset = result.next_page_offset;
  }

  return points;
}

async function main() {
  const client = getClient();
  const { exists } = await client.collectionExists(CONFIG.QDRANT_COLLECTION);
  const existingPoints = exists ? await loadAllPoints() : [];

  process.stdout.write(`[rebuild-style-knowledge] loaded ${existingPoints.length} style payload(s) from ${CONFIG.QDRANT_COLLECTION}\n`);

  if (exists) {
    process.stdout.write(`[rebuild-style-knowledge] deleting existing collection ${CONFIG.QDRANT_COLLECTION}\n`);
    await client.deleteCollection(CONFIG.QDRANT_COLLECTION);
  }

  await ensureCollection();

  let rebuilt = 0;
  for (const point of existingPoints) {
    const payload: StyleKnowledge = {
      ...point.payload,
      rich_text: buildStyleRichText(point.payload),
    };
    const vector = await encodeText(payload.rich_text);
    await upsertPoint(point.id, withSearchFields(payload), vector);
    rebuilt += 1;
    if (rebuilt % 25 === 0 || rebuilt === existingPoints.length) {
      process.stdout.write(`[rebuild-style-knowledge] rebuilt ${rebuilt}/${existingPoints.length}\n`);
    }
  }

  process.stdout.write(`[rebuild-style-knowledge] done\n`);
}

main().catch((error) => {
  console.error('[rebuild-style-knowledge] failed', error);
  process.exit(1);
});
