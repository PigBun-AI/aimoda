import { db } from '../../db/client.js'
import type { ReportMetadata, ReportRecord } from '../../types/models.js'

interface CreateReportInput extends ReportMetadata {
  path: string
  uploadedBy: number
  metadataJson: string | null
}

const mapReport = (row: Record<string, unknown>): ReportRecord => ({
  id: Number(row.id),
  slug: String(row.slug),
  title: String(row.title),
  brand: String(row.brand),
  season: String(row.season),
  year: Number(row.year),
  lookCount: Number(row.look_count),
  path: String(row.path),
  uploadedBy: Number(row.uploaded_by),
  metadataJson: row.metadata_json ? String(row.metadata_json) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
})

export const findReportBySlug = (slug: string): ReportRecord | null => {
  const row = db.prepare('SELECT * FROM reports WHERE slug = ?').get(slug) as Record<string, unknown> | undefined
  return row ? mapReport(row) : null
}

export const findReportById = (id: number): ReportRecord | null => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? mapReport(row) : null
}

export const listReports = (): ReportRecord[] => {
  const rows = db.prepare('SELECT * FROM reports ORDER BY id DESC').all() as Record<string, unknown>[]
  return rows.map(mapReport)
}

export const createReport = (input: CreateReportInput): ReportRecord => {
  const statement = db.prepare(
    `INSERT INTO reports (slug, title, brand, season, year, look_count, path, uploaded_by, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`
  )

  const row = statement.get(
    input.slug,
    input.title,
    input.brand,
    input.season,
    input.year,
    input.lookCount,
    input.path,
    input.uploadedBy,
    input.metadataJson
  ) as Record<string, unknown>

  return mapReport(row)
}
