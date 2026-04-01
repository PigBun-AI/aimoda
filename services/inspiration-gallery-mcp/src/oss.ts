/**
 * Aliyun OSS 上传服务
 */

import OSS from "ali-oss";
import crypto from "crypto";
import { CONFIG } from "./config.js";

let client: OSS | null = null;

function getClient(): OSS {
  if (!client) {
    client = new OSS({
      region: CONFIG.OSS_REGION,
      accessKeyId: CONFIG.OSS_ACCESS_KEY_ID,
      accessKeySecret: CONFIG.OSS_ACCESS_KEY_SECRET,
      bucket: CONFIG.OSS_BUCKET_NAME,
    });
  }
  return client;
}

/**
 * Generate a unique OSS path for a gallery image.
 * Format: gallery/{gallery_id}/{hash}_{original_name}
 */
function buildPath(
  galleryId: string,
  filename: string,
): string {
  const hash = crypto.randomBytes(4).toString("hex");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${CONFIG.OSS_GALLERY_PREFIX}/${galleryId}/${hash}_${safeName}`;
}

/**
 * Upload a buffer to OSS and return the public URL.
 */
export async function uploadToOSS(
  galleryId: string,
  filename: string,
  buffer: Buffer,
  contentType?: string,
): Promise<string> {
  const oss = getClient();
  const ossPath = buildPath(galleryId, filename);

  const options: OSS.PutObjectOptions = {};
  if (contentType) {
    options.headers = { "Content-Type": contentType };
  }

  const result = await oss.put(ossPath, buffer, options);
  // Return the URL - use the bucket's public endpoint
  return result.url || `https://${CONFIG.OSS_BUCKET_NAME}.${CONFIG.OSS_ENDPOINT}/${ossPath}`;
}

/**
 * Delete all images for a gallery from OSS.
 */
export async function deleteGalleryFromOSS(galleryId: string): Promise<void> {
  const oss = getClient();
  const prefix = `${CONFIG.OSS_GALLERY_PREFIX}/${galleryId}/`;

  let marker: string | undefined;
  do {
    const list = await oss.listV2({ prefix, "max-keys": 100, "continuation-token": marker } as any);
    const keys = (list.objects || []).map((o: any) => o.name).filter(Boolean);
    if (keys.length > 0) {
      await oss.deleteMulti(keys, { quiet: true });
    }
    marker = list.nextContinuationToken || undefined;
  } while (marker);
}
