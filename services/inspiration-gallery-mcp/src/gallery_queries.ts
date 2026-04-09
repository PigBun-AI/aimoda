export interface GalleryListOptions {
  category?: string;
  tag?: string;
  status?: string;
  description_empty?: boolean;
  image_count_gt?: number;
  created_before?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
}

export interface GalleryListQuery {
  whereClause: string;
  params: unknown[];
  limit: number;
  offset: number;
}

export function buildGalleryListQuery(opts: GalleryListOptions): GalleryListQuery {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.ids && opts.ids.length > 0) {
    conditions.push(`id = ANY($${idx++}::uuid[])`);
    params.push(opts.ids);
  }

  if (opts.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  } else if (!opts.ids || opts.ids.length === 0) {
    conditions.push(`status = $${idx++}`);
    params.push("published");
  }

  if (opts.category) {
    conditions.push(`category = $${idx++}`);
    params.push(opts.category);
  }

  if (opts.tag) {
    conditions.push(`$${idx++} = ANY(tags)`);
    params.push(opts.tag);
  }

  if (opts.description_empty) {
    conditions.push(`COALESCE(NULLIF(BTRIM(description), ''), '') = ''`);
  }

  if (typeof opts.image_count_gt === "number") {
    conditions.push(`image_count > $${idx++}`);
    params.push(opts.image_count_gt);
  }

  if (opts.created_before) {
    conditions.push(`created_at < $${idx++}::timestamptz`);
    params.push(opts.created_before);
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    limit: Math.max(1, Math.min(opts.limit ?? 20, 100)),
    offset: Math.max(0, opts.offset ?? 0),
  };
}
