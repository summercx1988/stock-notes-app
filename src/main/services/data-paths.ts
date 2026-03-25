import fs from 'fs'
import path from 'path'

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

const listDir = (targetPath: string): string[] => {
  try {
    return fs.readdirSync(targetPath)
  } catch {
    return []
  }
}

const scoreDataDir = (dataDir: string): number => {
  if (!isDirectory(dataDir)) {
    return 0
  }

  let score = 1
  if (exists(path.join(dataDir, 'stocks-database.json'))) score += 30
  if (exists(path.join(dataDir, 'watchlist.json'))) score += 4
  if (exists(path.join(dataDir, 'config', 'settings.json'))) score += 6
  if (isDirectory(path.join(dataDir, 'audio'))) score += 3

  const stocksDir = path.join(dataDir, 'stocks')
  if (isDirectory(stocksDir)) {
    score += 12
    const mdFiles = listDir(stocksDir).filter((fileName) => fileName.endsWith('.md')).length
    score += Math.min(mdFiles, 50)
  }

  return score
}

const findProjectRoot = (startDir: string): string | null => {
  let current = path.resolve(startDir)
  for (let depth = 0; depth < 16; depth += 1) {
    const hasPackageJson = exists(path.join(current, 'package.json'))
    const hasSrcOrDist = isDirectory(path.join(current, 'src')) || isDirectory(path.join(current, 'dist'))
    if (hasPackageJson && hasSrcOrDist) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

const unique = (items: string[]): string[] => {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items) {
    const normalized = path.resolve(item)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      output.push(normalized)
    }
  }
  return output
}

const resolveCandidates = (): string[] => {
  const fromEnv = process.env[DATA_DIR_ENV]?.trim()
  if (fromEnv) {
    return [path.resolve(fromEnv)]
  }

  const candidates: string[] = []
  const projectRootFromModule = findProjectRoot(__dirname)
  const projectRootFromCwd = findProjectRoot(process.cwd())

  if (projectRootFromModule) {
    candidates.push(path.join(projectRootFromModule, 'data'))
  }
  if (projectRootFromCwd) {
    candidates.push(path.join(projectRootFromCwd, 'data'))
  }

  candidates.push(path.join(process.cwd(), 'data'))
  return unique(candidates)
}

export const resolveProjectRoot = (): string | null => {
  if (cachedProjectRoot !== undefined) {
    return cachedProjectRoot
  }
  cachedProjectRoot = findProjectRoot(__dirname) || findProjectRoot(process.cwd()) || null
  return cachedProjectRoot
}

export const resolveDataDir = (): string => {
  if (cachedDataDir) {
    return cachedDataDir
  }

  const candidates = resolveCandidates()
  if (candidates.length === 0) {
    cachedDataDir = path.resolve(process.cwd(), 'data')
    return cachedDataDir
  }

  let bestPath = candidates[0]
  let bestScore = -1
  for (const candidate of candidates) {
    const score = scoreDataDir(candidate)
    if (score > bestScore) {
      bestScore = score
      bestPath = candidate
    }
  }

  cachedDataDir = bestPath
  if (!loggedDataDir) {
    loggedDataDir = true
    console.log(`[DataPaths] Using data dir: ${cachedDataDir}`)
  }
  return cachedDataDir
}

export const getDataPath = (...segments: string[]): string => {
  return path.join(resolveDataDir(), ...segments)
}
