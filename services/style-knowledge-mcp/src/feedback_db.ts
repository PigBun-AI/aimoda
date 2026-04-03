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
  linked_style_name?: string;
  resolution_note?: string;
  resolved_by?: string;
  covered_at?: string;
  first_seen_at: string;
  last_seen_at: string;
  latest_context: Record<string, unknown>;
}

export interface MarkStyleGapCoveredInput {
  signal_id?: string;
  query_normalized?: string;
  linked_style_name?: string;
  resolution_note?: string;
  resolved_by?: string;
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
          linked_style_name,
          resolution_note,
          resolved_by,
          covered_at,
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
      linked_style_name: row.linked_style_name ?? "",
      resolution_note: row.resolution_note ?? "",
      resolved_by: row.resolved_by ?? "",
      covered_at: row.covered_at ?? "",
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      latest_context: row.latest_context ?? {},
    })),
    total: countResult.rows[0]?.total ?? 0,
  };
}

export async function markStyleGapCovered(
  input: MarkStyleGapCoveredInput,
): Promise<StyleGapItem | null> {
  if (!input.signal_id && !input.query_normalized) {
    throw new Error("signal_id or query_normalized is required");
  }

  const db = getPool();
  const whereField = input.signal_id ? "id" : "query_normalized";
  const whereValue = input.signal_id ?? input.query_normalized ?? "";
  const resolvedBy = (input.resolved_by ?? "openclaw").trim() || "openclaw";
  const linkedStyleName = (input.linked_style_name ?? "").trim() || null;
  const resolutionNote = (input.resolution_note ?? "").trim();

  const result = await db.query(
    `
      UPDATE style_gap_signals
      SET
        status = 'covered',
        covered_at = NOW(),
        resolved_by = $1,
        linked_style_name = COALESCE($2, linked_style_name),
        resolution_note = CASE WHEN $3 = '' THEN resolution_note ELSE $3 END
      WHERE ${whereField} = $4
      RETURNING
        id,
        query_normalized,
        latest_query_raw,
        source,
        trigger_tool,
        search_stage,
        status,
        total_hits,
        unique_sessions,
        linked_style_name,
        resolution_note,
        resolved_by,
        covered_at,
        first_seen_at,
        last_seen_at,
        latest_context
    `,
    [resolvedBy, linkedStyleName, resolutionNote, whereValue],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    query_normalized: row.query_normalized,
    query_raw: row.latest_query_raw,
    source: row.source,
    trigger_tool: row.trigger_tool,
    search_stage: row.search_stage,
    status: row.status,
    total_hits: row.total_hits,
    unique_sessions: row.unique_sessions,
    linked_style_name: row.linked_style_name ?? "",
    resolution_note: row.resolution_note ?? "",
    resolved_by: row.resolved_by ?? "",
    covered_at: row.covered_at ?? "",
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    latest_context: row.latest_context ?? {},
  } as StyleGapItem & Record<string, unknown>;
}
