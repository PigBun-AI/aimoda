/**
 * Qdrant 客户端封装
 *
 * - 初始化 QdrantClient
 * - ensureCollection: 检查/创建 style_knowledge collection
 * - 通用查询/写入辅助函数
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { CONFIG } from "./config.js";
import type { StyleKnowledge } from "./types.js";
import { normalizeExactToken } from "./style_text.js";

let _client: QdrantClient | null = null;

/** 获取单例 Qdrant 客户端 */
export function getClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({
      url: CONFIG.QDRANT_URL,
      apiKey: CONFIG.QDRANT_API_KEY,
    });
  }
  return _client;
}

/**
 * 确保 collection 存在（含向量配置 + payload 索引）
 */
export async function ensureCollection(): Promise<void> {
  const client = getClient();
  const name = CONFIG.QDRANT_COLLECTION;

  try {
    const { exists } = await client.collectionExists(name);
    if (exists) {
      process.stderr.write(`[qdrant] collection "${name}" already exists\n`);
      return;
    }
  } catch {
    // collection 不存在时继续创建
  }

  process.stderr.write(`[qdrant] creating collection "${name}"...\n`);

  await client.createCollection(name, {
    vectors: {
      description: {
        size: CONFIG.VECTOR_DIM,
        distance: "Cosine",
      },
    },
  });

  // 创建 keyword 索引（精确匹配）
  const keywordFields = [
    "style_name",
    "aliases",
    "style_name_norm",
    "aliases_norm",
    "source",
    "category",
    "updated_at",
  ];

  for (const field of keywordFields) {
    try {
      await client.createPayloadIndex(name, {
        field_name: field,
        field_schema: "keyword",
      });
    } catch (err) {
      process.stderr.write(
        `[qdrant] keyword index "${field}" may already exist: ${err}\n`
      );
    }
  }

  // 创建 text 索引（子串模糊匹配）
  const textFields = ["style_name_text", "aliases_text", "rich_text_text"];
  for (const field of textFields) {
    try {
      await client.createPayloadIndex(name, {
        field_name: field,
        field_schema: "text",
      });
    } catch (err) {
      process.stderr.write(
        `[qdrant] text index "${field}" may already exist: ${err}\n`
      );
    }
  }

  process.stderr.write(
    `[qdrant] collection "${name}" created with indexes\n`
  );
}

/**
 * 按 style_name 精确匹配查找 point（返回第一个匹配）
 */
export async function findByStyleName(
  styleName: string
): Promise<{ id: string | number; payload: StyleKnowledge } | null> {
  const client = getClient();
  const normalized = normalizeExactToken(styleName);
  const result = await client.scroll(CONFIG.QDRANT_COLLECTION, {
    filter: {
      should: [
        {
          key: "style_name",
          match: { value: styleName },
        },
        {
          key: "style_name_norm",
          match: { value: normalized },
        },
      ],
    },
    limit: 1,
    with_payload: true,
  });

  if (result.points.length === 0) return null;
  const pt = result.points[0];
  return {
    id: pt.id,
    payload: pt.payload as unknown as StyleKnowledge,
  };
}

/**
 * 按 style_name 或 aliases 精确匹配（MatchAny）
 */
export async function findByNameOrAlias(
  query: string,
  limit: number
): Promise<Array<{ id: string | number; payload: StyleKnowledge }>> {
  const client = getClient();
  const normalized = normalizeExactToken(query);
  const result = await client.scroll(CONFIG.QDRANT_COLLECTION, {
    filter: {
      should: [
        { key: "style_name", match: { value: query } },
        { key: "aliases", match: { value: query } },
        { key: "style_name_norm", match: { value: normalized } },
        { key: "aliases_norm", match: { value: normalized } },
      ],
    },
    limit,
    with_payload: true,
  });

  return result.points.map((pt) => ({
    id: pt.id,
    payload: pt.payload as unknown as StyleKnowledge,
  }));
}

/**
 * 模糊匹配：按 style_name_text 或 aliases_text 做子串匹配
 * 用于 "老钱" 匹配 "老钱风"、"quiet lux" 匹配 "quiet luxury" 等场景
 */
export async function fuzzyMatchByNameOrAlias(
  query: string,
  limit: number
): Promise<Array<{ id: string | number; payload: StyleKnowledge }>> {
  const client = getClient();
  const normalized = normalizeExactToken(query);
  const result = await client.scroll(CONFIG.QDRANT_COLLECTION, {
    filter: {
      should: [
        { key: "style_name_text", match: { text: normalized } },
        { key: "aliases_text", match: { text: normalized } },
        { key: "rich_text_text", match: { text: normalized } },
      ],
    },
    limit,
    with_payload: true,
  });

  return result.points.map((pt) => ({
    id: pt.id,
    payload: pt.payload as unknown as StyleKnowledge,
  }));
}

/**
 * 语义向量搜索
 */
export async function semanticSearch(
  vector: number[],
  limit: number,
  scoreThreshold?: number
): Promise<
  Array<{ id: string | number; score: number; payload: StyleKnowledge }>
> {
  const client = getClient();
  const result = await client.query(CONFIG.QDRANT_COLLECTION, {
    query: vector,
    using: "description",
    limit,
    with_payload: true,
    score_threshold: scoreThreshold,
  });

  return result.points.map((pt) => ({
    id: pt.id,
    score: pt.score,
    payload: pt.payload as unknown as StyleKnowledge,
  }));
}

/**
 * Upsert 一个 point
 */
export async function upsertPoint(
  id: string | number,
  payload: Record<string, unknown>,
  vector: number[]
): Promise<void> {
  const client = getClient();
  await client.upsert(CONFIG.QDRANT_COLLECTION, {
    wait: true,
    points: [
      {
        id,
        payload,
        vector: { description: vector },
      },
    ],
  });
}

/**
 * 删除 points（按 filter）
 */
export async function deleteByStyleName(styleName: string): Promise<boolean> {
  const client = getClient();
  const existing = await findByStyleName(styleName);
  if (!existing) return false;

  await client.delete(CONFIG.QDRANT_COLLECTION, {
    wait: true,
    points: [existing.id],
  });
  return true;
}

/**
 * 滚动查询 points（支持筛选 + 分页）
 */
export async function scrollPoints(
  limit: number,
  filter?: {
    category?: string;
    source?: string;
  },
  offset?: string | number | null
): Promise<{
  points: Array<{ id: string | number; payload: StyleKnowledge }>;
  nextOffset: string | number | null;
}> {
  const client = getClient();
  const mustConditions: Array<Record<string, unknown>> = [];

  if (filter?.category) {
    mustConditions.push({
      key: "category",
      match: { value: filter.category },
    });
  }
  if (filter?.source) {
    mustConditions.push({
      key: "source",
      match: { value: filter.source },
    });
  }

  const result = await client.scroll(CONFIG.QDRANT_COLLECTION, {
    filter: mustConditions.length > 0 ? { must: mustConditions } : undefined,
    limit,
    with_payload: true,
    offset: offset ?? undefined,
  });

  return {
    points: result.points.map((pt) => ({
      id: pt.id,
      payload: pt.payload as unknown as StyleKnowledge,
    })),
    nextOffset: (result.next_page_offset as string | number | null) ?? null,
  };
}

/**
 * 获取 collection 中的 point 总数（可选筛选）
 */
export async function countPoints(
  filter?: {
    category?: string;
    source?: string;
  }
): Promise<number> {
  const client = getClient();
  const mustConditions: Array<Record<string, unknown>> = [];

  if (filter?.category) {
    mustConditions.push({
      key: "category",
      match: { value: filter.category },
    });
  }
  if (filter?.source) {
    mustConditions.push({
      key: "source",
      match: { value: filter.source },
    });
  }

  const result = await client.count(CONFIG.QDRANT_COLLECTION, {
    filter: mustConditions.length > 0 ? { must: mustConditions } : undefined,
    exact: true,
  });

  return result.count;
}
