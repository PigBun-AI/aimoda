/**
 * FashionCLIP 文本编码器
 *
 * 调用远程 /v1/embeddings 端点（OpenAI 兼容格式）将文本编码为 768 维向量。
 * 包含指数退避重试逻辑。
 */

import { CONFIG } from "./config.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

/**
 * 将文本编码为 FashionCLIP 向量
 */
export async function encodeText(text: string): Promise<number[]> {
  const url = `${CONFIG.FASHION_CLIP_ENDPOINT.replace(/\/+$/, "")}/v1/embeddings`;
  const payload = {
    input: text,
    input_type: "text",
    model: CONFIG.FASHION_CLIP_MODEL,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }

      const data = (await resp.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data[0].embedding;
    } catch (err) {
      lastError = err as Error;
      process.stderr.write(
        `[encoder] attempt ${attempt + 1}/${MAX_RETRIES} failed: ${lastError.message}\n`
      );
      if (attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw new Error(
    `FashionCLIP encode failed after ${MAX_RETRIES} retries: ${lastError?.message}`
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
