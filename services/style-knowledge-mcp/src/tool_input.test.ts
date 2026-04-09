import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { addStyleSchema } from "./tools/add_style.js";
import { updateStyleSchema } from "./tools/update_style.js";
import { batchImportSchema } from "./tools/batch_import.js";
import { normalizeStructuredInput, parseStructuredArgs } from "./tool_input.js";

test("add_style schema accepts stringified arrays from Hermes-like clients", () => {
  const schema = z.object(addStyleSchema);
  const result = schema.safeParse({
    style_name: "animecore",
    aliases: "[\"二次元风格\", \"Animecore\", \"ACG风格\"]",
    visual_description: "layered kawaii anime styling",
    palette: "[\"pink\", \"black\"]",
  });

  assert.equal(result.success, true);
});

test("update_style schema accepts stringified object payloads", () => {
  const schema = z.object(updateStyleSchema);
  const result = schema.safeParse({
    style_name: "animecore",
    updates:
      "{\"aliases\":[\"二次元风格\"],\"palette\":[\"pink\",\"black\"],\"category\":\"youth\"}",
    replace_aliases: false,
  });

  assert.equal(result.success, true);
});

test("batch_import_styles schema accepts stringified styles arrays", () => {
  const schema = z.object(batchImportSchema);
  const result = schema.safeParse({
    styles:
      "[{\"style_name\":\"animecore\",\"aliases\":[\"二次元风格\"],\"visual_description\":\"anime-inspired editorial layering\"}]",
  });

  assert.equal(result.success, true);
});

test("normalizeStructuredInput recursively decodes nested JSON strings", () => {
  const normalized = normalizeStructuredInput({
    aliases: "[\"二次元风格\", \"Animecore\"]",
    updates:
      "{\"palette\":\"[\\\"pink\\\",\\\"black\\\"]\",\"meta\":{\"details\":\"[\\\"ribbon\\\"]\"}}",
  });

  assert.deepEqual(normalized, {
    aliases: ["二次元风格", "Animecore"],
    updates: {
      palette: ["pink", "black"],
      meta: {
        details: ["ribbon"],
      },
    },
  });
});

test("parseStructuredArgs rejects non-JSON strings for structured fields", () => {
  const schema = z.object({
    aliases: z.array(z.string()),
  });

  assert.throws(
    () =>
      parseStructuredArgs(
        schema,
        { aliases: "not-json-array" },
        "aliases payload",
      ),
    /Invalid aliases payload/,
  );
});
