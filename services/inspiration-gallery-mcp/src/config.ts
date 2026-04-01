/**
 * 环境变量与默认配置
 */
export const CONFIG = {
  PORT: parseInt(process.env.PORT ?? "18760", 10),

  // PostgreSQL
  POSTGRES_DSN:
    process.env.POSTGRES_DSN ??
    "postgresql://fashion:fashion@localhost:5432/fashion_chat",

  // Aliyun OSS
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID ?? "",
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET ?? "",
  OSS_BUCKET_NAME: process.env.OSS_BUCKET_NAME ?? "",
  OSS_ENDPOINT: process.env.OSS_ENDPOINT ?? "oss-cn-hangzhou.aliyuncs.com",
  OSS_REGION: process.env.OSS_REGION ?? "oss-cn-hangzhou",

  // Gallery image path prefix in OSS
  OSS_GALLERY_PREFIX: process.env.OSS_GALLERY_PREFIX ?? "gallery",
} as const;
