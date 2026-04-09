/**
 * add_images — 向图集添加图片
 *
 * 支持两种模式:
 *   1. base64: 传入 base64 编码图片数据
 *   2. url: 传入已上传的图片 URL（自动下载并转存到 OSS）
 */

import { z } from "zod";
import { addGalleryImages, getGallery } from "../db.js";
import { uploadToOSS } from "../oss.js";
import { extractColorsFromBuffer } from "../utils/colors.js";

/** Browser-like headers to bypass CDN anti-bot checks */
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.vogue.com/",
};

const MAX_RETRIES = 3;

/** Download an image with retry + exponential backoff */
async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<{ buffer: Buffer; contentType?: string }> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { headers: FETCH_HEADERS });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      const arrayBuf = await resp.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuf),
        contentType: resp.headers.get("content-type") || undefined,
      };
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        console.warn(
          `[add_images] Retry ${attempt}/${retries} for ${url}: ${lastError.message} (wait ${delay}ms)`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error(`Failed to fetch ${url} after ${retries} attempts`);
}

export const addImagesSchema = {
  gallery_id: z.string().describe("图集 ID（从 create_gallery 返回）"),
  images: z
    .array(
      z.object({
        filename: z.string().describe("文件名，如 01-cover.jpg"),
        data: z
          .string()
          .optional()
          .describe("base64 编码的图片数据（与 url 二选一）"),
        url: z
          .string()
          .optional()
          .describe("已上传的图片 URL（与 data 二选一）"),
        caption: z.string().optional().describe("图片说明文字"),
        sort_order: z.number().optional().describe("排序序号（默认按传入顺序）"),
      }),
    )
    .describe("图片列表（每张需提供 data 或 url 之一）"),
};

export async function addImagesTool(args: {
  gallery_id: string;
  images: Array<{
    filename: string;
    data?: string;
    url?: string;
    caption?: string;
    sort_order?: number;
  }>;
}) {
  try {
    // Verify gallery exists
    const gallery = await getGallery(args.gallery_id);
    if (!gallery) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: `图集 ${args.gallery_id} 不存在`,
            }),
          },
        ],
        isError: true,
      };
    }

    const uploaded: Array<{
      image_url: string;
      thumbnail_url?: string;
      caption?: string;
      sort_order?: number;
      colors?: any[];
    }> = [];
    const fallbackUrls: string[] = [];
    const imageStatuses: Array<{
      filename: string;
      status: "uploaded" | "fallback_url" | "skipped";
      source: "base64" | "url" | "invalid";
      final_url?: string;
      warning?: string;
    }> = [];

    for (let i = 0; i < args.images.length; i++) {
      const img = args.images[i];
      let imageUrl: string;
      let colors: any[] = [];

      if (img.data) {
        // Upload base64 data to OSS
        const buffer = Buffer.from(img.data, "base64");
        imageUrl = await uploadToOSS(
          args.gallery_id,
          img.filename,
          buffer,
        );
        colors = await extractColorsFromBuffer(buffer);
        imageStatuses.push({
          filename: img.filename,
          status: "uploaded",
          source: "base64",
          final_url: imageUrl,
        });
      } else if (img.url) {
        // Download external image and re-upload to OSS
        try {
          const { buffer, contentType } = await fetchWithRetry(img.url);
          imageUrl = await uploadToOSS(
            args.gallery_id,
            img.filename,
            buffer,
            contentType,
          );
          colors = await extractColorsFromBuffer(buffer);
          imageStatuses.push({
            filename: img.filename,
            status: "uploaded",
            source: "url",
            final_url: imageUrl,
          });
        } catch (fetchErr) {
          console.warn(
            `[add_images] ⚠️ All retries failed for ${img.url}: ${(fetchErr as Error).message}. Using original URL as fallback.`,
          );
          imageUrl = img.url; // fallback to original URL
          fallbackUrls.push(img.url);
          imageStatuses.push({
            filename: img.filename,
            status: "fallback_url",
            source: "url",
            final_url: imageUrl,
            warning: (fetchErr as Error).message,
          });
        }
      } else {
        imageStatuses.push({
          filename: img.filename,
          status: "skipped",
          source: "invalid",
          warning: "missing both data and url",
        });
        continue; // Skip invalid entries
      }

      uploaded.push({
        image_url: imageUrl,
        caption: img.caption ?? "",
        sort_order: img.sort_order ?? i,
        colors,
      });
    }

    const dbImages = await addGalleryImages(args.gallery_id, uploaded);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              gallery_id: args.gallery_id,
              added: dbImages.length,
              total_images: (gallery.image_count || 0) + dbImages.length,
              oss_uploaded: dbImages.length - fallbackUrls.length,
              fallback_count: fallbackUrls.length,
              ...(fallbackUrls.length > 0 && {
                warning: `${fallbackUrls.length} image(s) used original URL (OSS upload failed after retries)`,
                fallback_urls: fallbackUrls,
              }),
              image_statuses: imageStatuses,
              images: dbImages.map((img) => ({
                id: img.id,
                url: img.image_url,
                caption: img.caption,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            error: (err as Error).message,
          }),
        },
      ],
      isError: true,
    };
  }
}
