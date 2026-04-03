import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { extractReportMetadata, validateReportDirectory } from '../src/modules/reports/report-scanner.js'

const createReportFixture = (directoryName: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-scanner-'))
  const reportDirectory = path.join(root, directoryName)
  fs.mkdirSync(path.join(reportDirectory, 'images'), { recursive: true })
  fs.writeFileSync(path.join(reportDirectory, 'index.html'), '<html><head><title>Zimmermann Fall 2026 RTW</title></head><body></body></html>')
  fs.writeFileSync(path.join(reportDirectory, 'images', 'look-001.jpg'), 'test-image')
  fs.writeFileSync(path.join(reportDirectory, 'images', 'look-002.png'), 'test-image')

  return { root, reportDirectory }
}

describe('report scanner', () => {
  let fixtureRoot = ''

  beforeEach(() => {
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('extracts report metadata from a valid directory', () => {
    const fixture = createReportFixture('zimmermann-fall-2026')
    fixtureRoot = fixture.root

    expect(extractReportMetadata(fixture.reportDirectory)).toEqual({
      slug: 'zimmermann-fall-2026',
      title: 'Zimmermann Fall 2026 RTW',
      brand: 'Zimmermann',
      season: 'Fall',
      year: 2026,
      lookCount: 2
    })
  })

  it('rejects directories missing required files', () => {
    const fixture = createReportFixture('zimmermann-fall-2026')
    fixtureRoot = fixture.root
    fs.rmSync(path.join(fixture.reportDirectory, 'index.html'))

    expect(() => validateReportDirectory(fixture.reportDirectory)).toThrow('缺少必需文件 index.html')
  })
})
