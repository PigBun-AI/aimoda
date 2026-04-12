import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  normalizeStructuredInput,
  parseStructuredArgs,
} from "./tool_input.js";
import { addImagesSchema } from "./tools/add_images.js";
import { updateGallerySchema } from "./tools/update_gallery.js";
import { createGallerySchema } from "./tools/create_gallery.js";
import { updateGalleryImagesSchema } from "./tools/update_gallery_images.js";
import { batchGetGalleriesSchema } from "./tools/batch_get_galleries.js";
import { deleteGalleryImagesSchema } from "./tools/delete_gallery_images.js";
import { batchDeleteGalleriesSchema } from "./tools/batch_delete_galleries.js";

test("normalizeStructuredInput recursively parses JSON strings", () => {
  const normalized = normalizeStructuredInput({
    tags: '["editorial","ss25"]',
    images: '[{"filename":"01.jpg","url":"https://example.com/01.jpg"}]',
  });

  assert.deepEqual(normalized, {
    tags: ["editorial", "ss25"],
    images: [{ filename: "01.jpg", url: "https://example.com/01.jpg" }],
  });
});

test("public inspiration MCP schemas accept JSON-string arrays", () => {
  assert.equal(
    z.object(addImagesSchema).safeParse({
      gallery_id: "gallery-1",
      images: '[{"filename":"01.jpg","url":"https://example.com/01.jpg"}]',
    }).success,
    true,
  );

  assert.equal(
    z.object(updateGallerySchema).safeParse({
      gallery_id: "gallery-1",
      tags: '["runway","minimal"]',
    }).success,
    true,
  );

  assert.equal(
    z.object(createGallerySchema).safeParse({
      title: "New Gallery",
      tags: '["runway"]',
    }).success,
    true,
  );

  assert.equal(
    z.object(updateGalleryImagesSchema).safeParse({
      images: '[{"id":"img-1","caption":"look 1"}]',
    }).success,
    true,
  );

  assert.equal(
    z.object(batchGetGalleriesSchema).safeParse({
      gallery_ids: '["gallery-1","gallery-2"]',
    }).success,
    true,
  );

  assert.equal(
    z.object(deleteGalleryImagesSchema).safeParse({
      image_ids: '["img-1","img-2"]',
    }).success,
    true,
  );

  assert.equal(
    z.object(batchDeleteGalleriesSchema).safeParse({
      gallery_ids: '["gallery-1","gallery-2"]',
    }).success,
    true,
  );
});

test("parseStructuredArgs turns JSON-string arrays into typed arrays", () => {
  const parsed = parseStructuredArgs(
    z.object({
      gallery_id: z.string(),
      tags: z.array(z.string()).optional(),
      images: z.array(z.object({
        filename: z.string(),
        url: z.string().optional(),
      })).optional(),
    }),
    {
      gallery_id: "gallery-1",
      tags: '["editorial","street_style"]',
      images: '[{"filename":"01.jpg","url":"https://example.com/01.jpg"}]',
    },
    "test args",
  );

  assert.deepEqual(parsed.tags, ["editorial", "street_style"]);
  assert.deepEqual(parsed.images, [
    { filename: "01.jpg", url: "https://example.com/01.jpg" },
  ]);
});
