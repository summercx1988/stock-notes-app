import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const DATA_DIR_ENV = 'STOCK_NOTES_DATA_DIR'
let cachedDataDir: string | null = null
let loggedDataDir = false
let cachedProjectRoot: string | null | undefined

const exists = (targetPath: string): boolean => {
  try {
    return fs.existsSync(targetPath)
  } catch {
    return false
  }
}

const isDirectory = (targetPath: string): boolean => {
  try {
    return fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

export const resolveProjectRoot = (): string | null => {
  if (cachedProjectRoot !== undefined) {
    return cachedProjectRoot
  }
  
  cachedProjectRoot = app.getPath('userData')
  return cachedProjectRoot
}

export const resolveDataDir = (): string => {
  if (cachedDataDir) {
    return cachedDataDir
  }

  const fromEnv = process.env[DATA_DIR_ENV]?.trim()
  if (fromEnv) {
    cachedDataDir = path.resolve(fromEnv)
  } else {
    const userDataPath = app.getPath('userData')
    cachedDataDir = path.join(userDataPath, 'data')
  }

  if (!loggedDataDir) {
    loggedDataDir = true
    console.log(`[DataPaths] Using data dir: ${cachedDataDir}`)
    
    if (!isDirectory(cachedDataDir)) {
      try {
        fs.mkdirSync(cachedDataDir, { recursive: true })
        console.log(`[DataPaths] Created data directory: ${cachedDataDir}`)
      } catch (error) {
        console.error(`[DataPaths] Failed to create data directory:`, error)
      }
    }
  }
  
  return cachedDataDir
}

export const getDataPath = (...segments: string[]): string => {
  return path.join(resolveDataDir(), ...segments)
}
