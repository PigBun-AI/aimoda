import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import unzipper from 'unzipper'

import { config } from '../../config/index.js'
import { REPORT_SPEC } from '../../constants/report-spec.js'
import type { ReportRecord } from '../../types/models.js'
import { createReport, findReportBySlug, findReportById, listReports } from './report.repository.js'
import { uploadContextSchema } from './report.schema.js'
import { extractReportMetadata } from './report-scanner.js'

interface UploadPayload {
  archivePath: string
  uploadedBy: number
}

const ensureReportsDirectory = () => {
  fs.mkdirSync(config.REPORTS_DIR, { recursive: true })
  fs.mkdirSync(config.UPLOAD_TMP_DIR, { recursive: true })
}

const createExtractionDirectory = () => {
  const extractionDirectory = fs.mkdtempSync(path.join(config.UPLOAD_TMP_DIR, 'report-'))
  return extractionDirectory
}

const safeJoin = (basePath: string, targetPath: string) => {
  const normalizedBasePath = path.resolve(basePath)
  const resolvedPath = path.resolve(normalizedBasePath, targetPath)
  const relativePath = path.relative(normalizedBasePath, resolvedPath)

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return resolvedPath
  }

  throw new Error('压缩包包含非法路径')
}

const extractArchive = async (archivePath: string, destinationPath: string) => {
  const directory = await unzipper.Open.file(archivePath)

  for (const entry of directory.files) {
    const outputPath = safeJoin(destinationPath, entry.path)

    if (entry.type === 'Directory') {
      fs.mkdirSync(outputPath, { recursive: true })
      continue
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    await pipeline(entry.stream(), fs.createWriteStream(outputPath))
  }
}

const resolveReportRoot = (extractionDirectory: string) => {
  const childEntries = fs.readdirSync(extractionDirectory, { withFileTypes: true })
  const topLevelDirectories = childEntries.filter((entry) => entry.isDirectory())

  if (topLevelDirectories.length === 1) {
    return path.join(extractionDirectory, topLevelDirectories[0].name)
  }

  return extractionDirectory
}

export const getReportSpec = () => REPORT_SPEC

export const getReport = (id: number) => findReportById(id)

export const getReports = (): ReportRecord[] => listReports()

export const uploadReportArchive = async ({ archivePath, uploadedBy }: UploadPayload) => {
  const parsedContext = uploadContextSchema.parse({ uploadedBy })
  ensureReportsDirectory()

  const extractionDirectory = createExtractionDirectory()

  try {
    await extractArchive(archivePath, extractionDirectory)
    const reportRoot = resolveReportRoot(extractionDirectory)
    const metadata = extractReportMetadata(reportRoot)

    if (findReportBySlug(metadata.slug)) {
      throw new Error(`报告 slug 已存在: ${metadata.slug}`)
    }

    const destinationPath = path.join(config.REPORTS_DIR, metadata.slug)

    if (fs.existsSync(destinationPath)) {
      throw new Error(`报告目录已存在: ${metadata.slug}`)
    }

    fs.cpSync(reportRoot, destinationPath, { recursive: true, force: false })

    return createReport({
      ...metadata,
      path: destinationPath,
      uploadedBy: parsedContext.uploadedBy,
      metadataJson: JSON.stringify(metadata)
    })
  } finally {
    fs.rmSync(extractionDirectory, { recursive: true, force: true })
    fs.rmSync(archivePath, { force: true })
  }
}
