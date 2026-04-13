import { z } from "zod";

function looksLikeJsonContainer(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  );
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== "string" || !looksLikeJsonContainer(value)) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function normalizeStructuredInput<T>(value: T): T {
  const parsed = tryParseJsonString(value);

  if (Array.isArray(parsed)) {
    return parsed.map((item) => normalizeStructuredInput(item)) as T;
  }

  if (parsed && typeof parsed === "object") {
    return Object.fromEntries(
      Object.entries(parsed).map(([key, nestedValue]) => [
        key,
        normalizeStructuredInput(nestedValue),
      ]),
    ) as T;
  }

  return parsed as T;
}

export function jsonStringCompatibleArray<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.union([z.array(itemSchema), z.string()]);
}

export function parseStructuredArgs<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const normalized = normalizeStructuredInput(value);
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}: ${parsed.error.message}`);
  }
  return parsed.data;
}
