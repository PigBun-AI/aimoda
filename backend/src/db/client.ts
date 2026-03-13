import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { config } from '../config/index.js'

const ensureParentDirectory = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

ensureParentDirectory(config.DATABASE_PATH)

export const db = new Database(config.DATABASE_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
