import test from "node:test";
import assert from "node:assert/strict";

import { buildGalleryListQuery } from "./gallery_queries.js";

test("buildGalleryListQuery applies default published status", () => {
  const query = buildGalleryListQuery({ limit: 10, offset: 5 });
  assert.match(query.whereClause, /status = \$1/);
  assert.deepEqual(query.params, ["published"]);
  assert.equal(query.limit, 10);
  assert.equal(query.offset, 5);
});

test("buildGalleryListQuery adds optional filters in stable order", () => {
  const query = buildGalleryListQuery({
    ids: ["1", "2"],
    status: "draft",
    category: "trend",
    tag: "vogue",
    description_empty: true,
    image_count_gt: 50,
    created_before: "2026-03-25T00:00:00.000Z",
  });

  assert.match(query.whereClause, /id = ANY\(\$1::uuid\[\]\)/);
  assert.match(query.whereClause, /status = \$2/);
  assert.match(query.whereClause, /category = \$3/);
  assert.match(query.whereClause, /\$4 = ANY\(tags\)/);
  assert.match(query.whereClause, /image_count > \$5/);
  assert.match(query.whereClause, /created_at < \$6::timestamptz/);
  assert.deepEqual(query.params, [
    ["1", "2"],
    "draft",
    "trend",
    "vogue",
    50,
    "2026-03-25T00:00:00.000Z",
  ]);
});
