/**
 * PostgreSQL 数据库操作
 */

import pg from "pg";
import { CONFIG } from "./config.js";
import { v4 as uuidv4 } from "uuid";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: CONFIG.POSTGRES_DSN, max: 5 });
  }
  return pool;
}

// ── Schema initialization ────────────────────────────────────────

export async function ensureSchema(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS galleries (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title         TEXT NOT NULL,
      description   TEXT DEFAULT '',
      category      TEXT DEFAULT 'inspiration',
      tags          TEXT[] DEFAULT '{}',
      cover_url     TEXT DEFAULT '',
      source        TEXT DEFAULT 'manual',
      status        TEXT DEFAULT 'published',
      image_count   INT DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS gallery_images (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      gallery_id    UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
      image_url     TEXT NOT NULL,
      thumbnail_url TEXT DEFAULT '',
      caption       TEXT DEFAULT '',
      sort_order    INT DEFAULT 0,
      width         INT DEFAULT 0,
      height        INT DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT now()
    );

    -- Backfill newer gallery schema on existing deployments.
    ALTER TABLE gallery_images
      ADD COLUMN IF NOT EXISTS colors JSONB DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_galleries_category ON galleries(category);
    CREATE INDEX IF NOT EXISTS idx_galleries_status ON galleries(status);
    CREATE INDEX IF NOT EXISTS idx_galleries_created ON galleries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_images_gallery ON gallery_images(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_gallery_images_order ON gallery_images(gallery_id, sort_order);
  `);
}

// ── Gallery CRUD ─────────────────────────────────────────────────

export interface GalleryInput {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  source?: string;
  status?: string;
  cover_url?: string;
}

export interface Gallery {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  cover_url: string;
  source: string;
  status: string;
  image_count: number;
  created_at: string;
  updated_at: string;
}

export interface GalleryImage {
  id: string;
  gallery_id: string;
  image_url: string;
  thumbnail_url: string;
  caption: string;
  sort_order: number;
  width: number;
  height: number;
  created_at: string;
  colors?: any[];
}

export async function createGallery(input: GalleryInput): Promise<Gallery> {
  const db = getPool();
  const id = uuidv4();
  const result = await db.query(
    `INSERT INTO galleries (id, title, description, category, tags, source, status, cover_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      input.title,
      input.description ?? "",
      input.category ?? "inspiration",
      input.tags ?? [],
      input.source ?? "manual",
      input.status ?? "published",
      input.cover_url ?? "",
    ],
  );
  return result.rows[0];
}

export async function getGallery(id: string): Promise<Gallery | null> {
  const db = getPool();
  const result = await db.query("SELECT * FROM galleries WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function listGalleries(opts: {
  category?: string;
  tag?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ galleries: Gallery[]; total: number }> {
  const db = getPool();
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (opts.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  } else {
    // Default: only show published
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

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const countResult = await db.query(
    `SELECT count(*)::int as total FROM galleries ${where}`,
    params,
  );
  const total = countResult.rows[0].total;

  const result = await db.query(
    `SELECT * FROM galleries ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );

  return { galleries: result.rows, total };
}

export async function updateGallery(
  id: string,
  updates: Partial<GalleryInput>,
): Promise<Gallery | null> {
  const db = getPool();
  const sets: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(updates.description);
  }
  if (updates.category !== undefined) {
    sets.push(`category = $${idx++}`);
    params.push(updates.category);
  }
  if (updates.tags !== undefined) {
    sets.push(`tags = $${idx++}`);
    params.push(updates.tags);
  }
  if (updates.source !== undefined) {
    sets.push(`source = $${idx++}`);
    params.push(updates.source);
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
  }
  if (updates.cover_url !== undefined) {
    sets.push(`cover_url = $${idx++}`);
    params.push(updates.cover_url);
  }

  if (sets.length === 0) return getGallery(id);

  sets.push(`updated_at = now()`);
  params.push(id);

  const result = await db.query(
    `UPDATE galleries SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function deleteGallery(id: string): Promise<boolean> {
  const db = getPool();
  const result = await db.query("DELETE FROM galleries WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// ── Gallery Images ─────────────────────────────────────────────

export async function addGalleryImages(
  galleryId: string,
  images: Array<{
    image_url: string;
    thumbnail_url?: string;
    caption?: string;
    sort_order?: number;
    width?: number;
    height?: number;
    colors?: any[];
  }>,
): Promise<GalleryImage[]> {
  const db = getPool();
  const inserted: GalleryImage[] = [];

  for (const img of images) {
    const result = await db.query(
      `INSERT INTO gallery_images (gallery_id, image_url, thumbnail_url, caption, sort_order, width, height, colors)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        galleryId,
        img.image_url,
        img.thumbnail_url ?? "",
        img.caption ?? "",
        img.sort_order ?? 0,
        img.width ?? 0,
        img.height ?? 0,
        JSON.stringify(img.colors ?? []),
      ],
    );
    inserted.push(result.rows[0]);
  }

  // Update image count and cover
  await db.query(
    `UPDATE galleries SET
       image_count = (SELECT count(*) FROM gallery_images WHERE gallery_id = $1),
       cover_url = COALESCE(NULLIF(cover_url, ''),
         (SELECT image_url FROM gallery_images WHERE gallery_id = $1 ORDER BY sort_order LIMIT 1)),
       updated_at = now()
     WHERE id = $1`,
    [galleryId],
  );

  return inserted;
}

export async function getGalleryImages(
  galleryId: string,
): Promise<GalleryImage[]> {
  const db = getPool();
  const result = await db.query(
    "SELECT * FROM gallery_images WHERE gallery_id = $1 ORDER BY sort_order, created_at",
    [galleryId],
  );
  return result.rows;
}
