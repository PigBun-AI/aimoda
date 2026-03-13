import fs from 'node:fs'
import path from 'node:path'

import { REPORT_SPEC } from '../../constants/report-spec.js'
import type { ReportMetadata } from '../../types/models.js'
import { AppError } from '../../types/app-error.js'

const titleExpression = /<title>(.*?)<\/title>/is
const headingExpression = /<h1[^>]*>(.*?)<\/h1>/is

const stripTags = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const normalizeSlug = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const inferTitle = (html: string) => {
  const titleMatch = html.match(titleExpression)?.[1]
  const headingMatch = html.match(headingExpression)?.[1]
  const candidate = titleMatch ?? headingMatch

  return candidate ? stripTags(candidate) : null
}

const inferLookCount = (imagesDirectory: string) => {
  const files = fs.readdirSync(imagesDirectory, { withFileTypes: true })
  return files.filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)).length
}

const inferMetadataFromSlug = (slug: string) => {
  const parts = slug.split('-')

  if (parts.length < 3) {
    throw new AppError('目录名称不符合命名规范', 400)
  }

  const year = Number(parts.at(-1))
  const season = parts.at(-2)
  const brandParts = parts.slice(0, -2)

  if (!Number.isInteger(year) || !season || brandParts.length === 0) {
    throw new AppError('目录名称不符合命名规范', 400)
  }

  return {
    brand: brandParts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    season: season.charAt(0).toUpperCase() + season.slice(1),
    year
  }
}

export const validateReportDirectory = (directoryPath: string) => {
  const requiredPaths = REPORT_SPEC.folderStructure.required.map((entry) => path.join(directoryPath, entry))

  requiredPaths.forEach((entryPath, index) => {
    if (!fs.existsSync(entryPath)) {
      throw new AppError(`缺少必需文件 ${REPORT_SPEC.folderStructure.required[index]}`, 400)
    }
  })
}

export const extractReportMetadata = (directoryPath: string): ReportMetadata => {
  validateReportDirectory(directoryPath)

  const slug = normalizeSlug(path.basename(directoryPath))

  if (!slug) {
    throw new AppError('无法生成合法 slug', 400)
  }

  const html = fs.readFileSync(path.join(directoryPath, 'index.html'), 'utf8')
  const title = inferTitle(html)

  if (!title) {
    throw new AppError('无法从 index.html 提取标题', 400)
  }

  const { brand, season, year } = inferMetadataFromSlug(slug)
  const imagesDirectory = path.join(directoryPath, 'images')
  const lookCount = inferLookCount(imagesDirectory)

  return {
    slug,
    title,
    brand,
    season,
    year,
    lookCount
  }
}
