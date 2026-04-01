/**
 * migrate_images_to_oss.ts — 批量迁移 Vogue CDN 图片到阿里云 OSS
 *
 * 运行方式: npx tsx src/scripts/migrate_images_to_oss.ts
 * 或在 Docker 内: node dist/scripts/migrate_images_to_oss.js
 */

import OSS from "ali-oss";
import crypto from "crypto";
import pg from "pg";

// ─── Config ────────────────────────────────────────
const CONFIG = {
  POSTGRES_DSN:
    process.env.POSTGRES_DSN ??
    "postgresql://fashion:fashion@postgres:5432/fashion_chat",
  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID ?? "",
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET ?? "",
  OSS_BUCKET_NAME: process.env.OSS_BUCKET_NAME ?? "",
  OSS_ENDPOINT: process.env.OSS_ENDPOINT ?? "oss-cn-shenzhen.aliyuncs.com",
  OSS_REGION: process.env.OSS_REGION ?? "oss-cn-shenzhen",
  OSS_GALLERY_PREFIX: process.env.OSS_GALLERY_PREFIX ?? "gallery",
  CONCURRENCY: parseInt(process.env.CONCURRENCY ?? "5", 10),
  DRY_RUN: process.env.DRY_RUN === "true",
};

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.vogue.com/",
};

// ─── OSS Client ────────────────────────────────────
let ossClient: OSS | null = null;
function getOSS(): OSS {
  if (!ossClient) {
    ossClient = new OSS({
      region: CONFIG.OSS_REGION,
      accessKeyId: CONFIG.OSS_ACCESS_KEY_ID,
      accessKeySecret: CONFIG.OSS_ACCESS_KEY_SECRET,
      bucket: CONFIG.OSS_BUCKET_NAME,
    });
  }
  return ossClient;
}

function buildOSSPath(galleryId: string, filename: string): string {
  const hash = crypto.randomBytes(4).toString("hex");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${CONFIG.OSS_GALLERY_PREFIX}/${galleryId}/${hash}_${safeName}`;
}

// ─── Download with retry ───────────────────────────
async function downloadWithRetry(
  url: string,
  maxRetries = 3,
): Promise<{ buffer: Buffer; contentType?: string }> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, { headers: FETCH_HEADERS });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const buf = await resp.arrayBuffer();
      return {
        buffer: Buffer.from(buf),
        contentType: resp.headers.get("content-type") || undefined,
      };
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}

// ─── Upload to OSS ─────────────────────────────────
async function uploadBuffer(
  galleryId: string,
  filename: string,
  buffer: Buffer,
  contentType?: string,
): Promise<string> {
  const oss = getOSS();
  const ossPath = buildOSSPath(galleryId, filename);
  const options: OSS.PutObjectOptions = {};
  if (contentType) {
    options.headers = { "Content-Type": contentType };
  }
  const result = await oss.put(ossPath, buffer, options);
  return (
    result.url ||
    `https://${CONFIG.OSS_BUCKET_NAME}.${CONFIG.OSS_ENDPOINT}/${ossPath}`
  );
}

// ─── Concurrency helper ───────────────────────────
async function processInBatches<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await handler(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
}

// ─── Extract filename from URL ─────────────────────
function extractFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || "image.jpg";
  } catch {
    return "image.jpg";
  }
}

// ─── Main ──────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Gallery Images → OSS Migration");
  console.log("═══════════════════════════════════════════");
  console.log(`  PostgreSQL: ${CONFIG.POSTGRES_DSN.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`  OSS Bucket: ${CONFIG.OSS_BUCKET_NAME} (${CONFIG.OSS_REGION})`);
  console.log(`  Concurrency: ${CONFIG.CONCURRENCY}`);
  console.log(`  Dry Run: ${CONFIG.DRY_RUN}`);
  console.log("");

  if (!CONFIG.OSS_ACCESS_KEY_ID || !CONFIG.OSS_BUCKET_NAME) {
    console.error("❌ OSS credentials not configured. Set OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET_NAME.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: CONFIG.POSTGRES_DSN });

  // ── Phase 1: Migrate gallery_images ──
  console.log("── Phase 1: gallery_images ──");
  const { rows: images } = await pool.query<{
    id: string;
    gallery_id: string;
    image_url: string;
  }>(
    `SELECT id, gallery_id, image_url FROM gallery_images
     WHERE image_url LIKE '%vogue.com%'
     ORDER BY gallery_id, sort_order`,
  );
  console.log(`  Found ${images.length} images with Vogue CDN URLs\n`);

  let imgSuccess = 0;
  let imgFailed = 0;
  let imgSkipped = 0;

  await processInBatches(images, CONFIG.CONCURRENCY, async (img, i) => {
    const progress = `[${i + 1}/${images.length}]`;
    const filename = extractFilename(img.image_url);

    try {
      if (CONFIG.DRY_RUN) {
        console.log(`  ${progress} DRY RUN: ${filename} (gallery ${img.gallery_id.slice(0, 8)})`);
        imgSkipped++;
        return;
      }

      const { buffer, contentType } = await downloadWithRetry(img.image_url);
      const ossUrl = await uploadBuffer(img.gallery_id, filename, buffer, contentType);

      await pool.query(
        `UPDATE gallery_images SET image_url = $1 WHERE id = $2`,
        [ossUrl, img.id],
      );

      console.log(`  ${progress} ✅ ${filename} → ${ossUrl.slice(0, 80)}...`);
      imgSuccess++;
    } catch (err) {
      console.error(`  ${progress} ❌ ${filename}: ${(err as Error).message}`);
      imgFailed++;
    }
  });

  console.log("");
  console.log(`  Images: ${imgSuccess} migrated, ${imgFailed} failed, ${imgSkipped} skipped`);
  console.log("");

  // ── Phase 2: Migrate gallery cover_url ──
  console.log("── Phase 2: galleries.cover_url ──");
  const { rows: covers } = await pool.query<{
    id: string;
    cover_url: string;
  }>(
    `SELECT id, cover_url FROM galleries
     WHERE cover_url LIKE '%vogue.com%'`,
  );
  console.log(`  Found ${covers.length} galleries with Vogue CDN cover URLs\n`);

  let coverSuccess = 0;
  let coverFailed = 0;

  await processInBatches(covers, CONFIG.CONCURRENCY, async (gal, i) => {
    const progress = `[${i + 1}/${covers.length}]`;
    const filename = extractFilename(gal.cover_url);

    try {
      if (CONFIG.DRY_RUN) {
        console.log(`  ${progress} DRY RUN: cover for gallery ${gal.id.slice(0, 8)}`);
        return;
      }

      const { buffer, contentType } = await downloadWithRetry(gal.cover_url);
      const ossUrl = await uploadBuffer(gal.id, `cover_${filename}`, buffer, contentType);

      await pool.query(
        `UPDATE galleries SET cover_url = $1 WHERE id = $2`,
        [ossUrl, gal.id],
      );

      console.log(`  ${progress} ✅ cover → ${ossUrl.slice(0, 80)}...`);
      coverSuccess++;
    } catch (err) {
      console.error(`  ${progress} ❌ cover: ${(err as Error).message}`);
      coverFailed++;
    }
  });

  console.log("");
  console.log(`  Covers: ${coverSuccess} migrated, ${coverFailed} failed`);
  console.log("");

  // ── Summary ──
  console.log("═══════════════════════════════════════════");
  console.log("  Migration Summary");
  console.log("═══════════════════════════════════════════");
  console.log(`  Images:  ${imgSuccess}/${images.length} migrated`);
  console.log(`  Covers:  ${coverSuccess}/${covers.length} migrated`);
  if (imgFailed + coverFailed > 0) {
    console.log(`  ⚠️  Failed: ${imgFailed + coverFailed}`);
  }
  console.log("═══════════════════════════════════════════");

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
