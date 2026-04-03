import pg from "pg";
import { CONFIG } from "./config.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: CONFIG.POSTGRES_DSN, max: 5 });
  }
  return pool;
}

export interface StyleGapItem {
  id: string;
  query_normalized: string;
  query_raw: string;
  source: string;
  trigger_tool: string;
  search_stage: string;
  status: string;
  total_hits: number;
  unique_sessions: number;
  first_seen_at: string;
  last_seen_at: string;
  latest_context: Record<string, unknown>;
}

export async function listStyleGaps(opts: {
  status?: string;
  limit?: number;
  offset?: number;
  min_hits?: number;
}): Promise<{ gaps: StyleGapItem[]; total: number }> {
  const db = getPool();
  const status = opts.status ?? "open";
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const minHits = Math.max(1, opts.min_hits ?? 1);

  const [rowsResult, countResult] = await Promise.all([
    db.query(
      `
        SELECT
          id,
          query_normalized,
          latest_query_raw,
          source,
          trigger_tool,
          search_stage,
          status,
          total_hits,
          unique_sessions,
          first_seen_at,
          last_seen_at,
          latest_context
        FROM style_gap_signals
        WHERE status = $1
          AND total_hits >= $2
        ORDER BY total_hits DESC, last_seen_at DESC
        LIMIT $3 OFFSET $4
      `,
      [status, minHits, limit, offset],
    ),
    db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM style_gap_signals
        WHERE status = $1
          AND total_hits >= $2
      `,
      [status, minHits],
    ),
  ]);

  return {
    gaps: rowsResult.rows.map((row) => ({
      id: row.id,
      query_normalized: row.query_normalized,
      query_raw: row.latest_query_raw,
      source: row.source,
      trigger_tool: row.trigger_tool,
      search_stage: row.search_stage,
      status: row.status,
      total_hits: row.total_hits,
      unique_sessions: row.unique_sessions,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      latest_context: row.latest_context ?? {},
    })),
    total: countResult.rows[0]?.total ?? 0,
  };
}
