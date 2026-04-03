/**
 * 环境变量与默认配置
 */
export const CONFIG = {
  QDRANT_URL: process.env.QDRANT_URL ?? "http://220.168.84.134:16333",
  QDRANT_API_KEY: process.env.QDRANT_API_KEY ?? "aimoda2025",
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION ?? "style_knowledge",

  /** Style text embedding endpoint（OpenAI 兼容 /v1/embeddings） */
  STYLE_TEXT_ENDPOINT:
    process.env.STYLE_TEXT_ENDPOINT ??
    process.env.FASHION_CLIP_ENDPOINT ??
    "http://183.62.232.22:18730",
  STYLE_TEXT_MODEL:
    process.env.STYLE_TEXT_MODEL ??
    process.env.FASHION_CLIP_MODEL ??
    "infgrad/stella-mrl-large-zh-v3.5-1792d",

  /** 向量维度 */
  VECTOR_DIM: Number(process.env.STYLE_VECTOR_DIM ?? 1792),

  /** 语义搜索 score 阈值，低于此值视为无结果 */
  SEMANTIC_SCORE_THRESHOLD: 0.5,
} as const;
