/**
 * PostgreSQL 数据库操作
 */

import pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { CONFIG } from "./config.js";
import { buildGalleryListQuery, type GalleryListOptions } from "./gallery_queries.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: CONFIG.POSTGRES_DSN, max: 5 });
  }
  return pool;
}

async function refreshGalleryStats(db: pg.Pool | pg.PoolClient, galleryIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(galleryIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  await db.query(
    `
      UPDATE galleries AS g
      SET
        image_count = stats.image_count,
        cover_url = stats.cover_url,
        updated_at = NOW()
      FROM (
        SELECT
          gallery.id,
          COUNT(img.id)::int AS image_count,
          COALESCE(
            MAX(CASE WHEN img.sort_order = first_sort.min_sort_order THEN img.image_url END),
            gallery.cover_url,
            ''
          ) AS cover_url
        FROM galleries AS gallery
        LEFT JOIN gallery_images AS img ON img.gallery_id = gallery.id
        LEFT JOIN (
          SELECT gallery_id, MIN(sort_order) AS min_sort_order
          FROM gallery_images
          WHERE gallery_id = ANY($1::uuid[])
          GROUP BY gallery_id
        ) AS first_sort ON first_sort.gallery_id = gallery.id
        WHERE gallery.id = ANY($1::uuid[])
        GROUP BY gallery.id, gallery.cover_url
      ) AS stats
      WHERE g.id = stats.id
    `,
    [uniqueIds],
  );
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

    ALTER TABLE gallery_images
      ADD COLUMN IF NOT EXISTS colors JSONB DEFAULT '[]'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_galleries_category ON galleries(category);
    CREATE INDEX IF NOT EXISTS idx_galleries_status ON galleries(status);
    CREATE INDEX IF NOT EXISTS idx_galleries_created ON galleries(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_galleries_image_count ON galleries(image_count DESC);
    CREATE INDEX IF NOT EXISTS idx_gallery_images_gallery ON gallery_images(gallery_id);
    CREATE INDEX IF NOT EXISTS idx_gallery_images_order ON gallery_images(gallery_id, sort_order, created_at);
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

export interface GalleryListItem extends Gallery {
  images?: GalleryImage[];
}

export interface GalleryImageListResult {
  images: GalleryImage[];
  total: number;
  returned: number;
  has_more: boolean;
  limit: number;
  offset: number;
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

export async function listGalleries(
  opts: GalleryListOptions & {
    includeDescription?: boolean;
    includeImages?: boolean;
    imageLimit?: number;
  },
): Promise<{ galleries: GalleryListItem[]; total: number }> {
  const db = getPool();
  const query = buildGalleryListQuery(opts);

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM galleries ${query.whereClause}`,
    query.params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const result = await db.query(
    `SELECT * FROM galleries ${query.whereClause} ORDER BY created_at DESC LIMIT $${query.params.length + 1} OFFSET $${query.params.length + 2}`,
    [...query.params, query.limit, query.offset],
  );

  const galleries = result.rows as GalleryListItem[];
  const includeImages = opts.includeImages ?? false;
  const includeDescription = opts.includeDescription ?? false;

  const hydrated = await Promise.all(
    galleries.map(async (gallery) => {
      const nextGallery: GalleryListItem = { ...gallery };
      if (!includeDescription) {
        nextGallery.description = "";
      }
      if (includeImages) {
        const imageResult = await getGalleryImages(gallery.id, {
          limit: opts.imageLimit ?? 12,
          offset: 0,
        });
        nextGallery.images = imageResult.images;
      }
      return nextGallery;
    }),
  );

  return { galleries: hydrated, total };
}

export async function batchGetGalleries(
  ids: string[],
  opts?: { includeImages?: boolean; includeDescription?: boolean; imageLimit?: number },
): Promise<GalleryListItem[]> {
  if (ids.length === 0) return [];
  const { galleries } = await listGalleries({
    ids,
    status: undefined,
    includeImages: opts?.includeImages,
    includeDescription: opts?.includeDescription,
    imageLimit: opts?.imageLimit,
    limit: Math.max(ids.length, 1),
    offset: 0,
  });

  const byId = new Map(galleries.map((gallery) => [gallery.id, gallery]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as GalleryListItem[];
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

  sets.push(`updated_at = NOW()`);
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

export async function batchDeleteGalleries(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = getPool();
  const result = await db.query(
    `DELETE FROM galleries WHERE id = ANY($1::uuid[]) RETURNING id`,
    [ids],
  );
  return result.rows.map((row) => row.id);
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

  await refreshGalleryStats(db, [galleryId]);
  return inserted;
}

export async function getGalleryImages(
  galleryId: string,
  opts?: { limit?: number; offset?: number },
): Promise<GalleryImageListResult> {
  const db = getPool();
  const limit = Math.max(1, Math.min(opts?.limit ?? 200, 500));
  const offset = Math.max(0, opts?.offset ?? 0);

  const [countResult, result] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM gallery_images WHERE gallery_id = $1`, [galleryId]),
    db.query(
      `SELECT * FROM gallery_images WHERE gallery_id = $1 ORDER BY sort_order, created_at LIMIT $2 OFFSET $3`,
      [galleryId, limit, offset],
    ),
  ]);

  const total = countResult.rows[0]?.total ?? 0;
  const images = result.rows as GalleryImage[];

  return {
    images,
    total,
    returned: images.length,
    has_more: offset + images.length < total,
    limit,
    offset,
  };
}

export async function updateGalleryImages(
  images: Array<{ id: string; caption?: string; sort_order?: number }>,
): Promise<GalleryImage[]> {
  if (images.length === 0) return [];
  const db = getPool();
  const updated: GalleryImage[] = [];
  const touchedGalleryIds: string[] = [];

  for (const image of images) {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (image.caption !== undefined) {
      sets.push(`caption = $${idx++}`);
      params.push(image.caption);
    }
    if (image.sort_order !== undefined) {
      sets.push(`sort_order = $${idx++}`);
      params.push(image.sort_order);
    }
    if (sets.length === 0) continue;

    params.push(image.id);
    const result = await db.query(
      `UPDATE gallery_images SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      params,
    );

    if (result.rows[0]) {
      updated.push(result.rows[0]);
      touchedGalleryIds.push(result.rows[0].gallery_id);
    }
  }

  await refreshGalleryStats(db, touchedGalleryIds);
  return updated;
}

export async function deleteGalleryImagesByIds(
  imageIds: string[],
  galleryId?: string,
): Promise<GalleryImage[]> {
  if (imageIds.length === 0) return [];
  const db = getPool();
  const params: any[] = [imageIds];
  const galleryClause = galleryId ? ` AND gallery_id = $2::uuid` : "";
  if (galleryId) params.push(galleryId);

  const result = await db.query(
    `DELETE FROM gallery_images WHERE id = ANY($1::uuid[])${galleryClause} RETURNING *`,
    params,
  );

  const deleted = result.rows as GalleryImage[];
  await refreshGalleryStats(db, deleted.map((item) => item.gallery_id));
  return deleted;
}
