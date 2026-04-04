import fs from 'fs/promises'
import path from 'path'
import util from 'util'
import { app } from 'electron'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

interface LogEntry {
  ts: string
  level: LogLevel
  module: string
  message: string
  pid: number
  context?: unknown
}

const DATA_DIR_ENV = 'STOCK_NOTES_DATA_DIR'
const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_ROTATED_FILES = 3
const MAX_BUFFERED_LINES = 500
const MAX_MESSAGE_CHARS = 4000
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|appsecret)/i

let writeQueue: Promise<void> = Promise.resolve()
let bufferedLines: string[] = []
let droppedBufferedLines = 0
let stableLogFilePath: string | null = null
let isRotating = false
let consoleTransportInstalled = false

const truncate = (text: string): string => {
  if (text.length <= MAX_MESSAGE_CHARS) return text
  return `${text.slice(0, MAX_MESSAGE_CHARS)} ...<truncated>`
}

const redactText = (text: string): string => {
  let output = text
  output = output.replace(/Bearer\s+[A-Za-z0-9\-._=:+/]+/gi, 'Bearer [REDACTED]')
  output = output.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
  output = output.replace(
    /(["']?(?:api[_-]?key|authorization|token|secret|password|appSecret)["']?\s*[:=]\s*["'])[^"']+(["'])/gi,
    '$1[REDACTED]$2'
  )
  output = output.replace(
    /((?:api[_-]?key|authorization|token|secret|password|appSecret)\s*[:=]\s*)([^\s,}]+)/gi,
    '$1[REDACTED]'
  )
  return output
}

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message || ''),
      stack: redactText(value.stack || '')
    }
  }

  if (depth >= 4) return '[MaxDepth]'

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = '[REDACTED]'
      } else {
        sanitized[key] = sanitizeValue(child, depth + 1)
      }
    }
    return sanitized
  }

  return String(value)
}

const renderConsoleArgs = (args: unknown[]): string => {
  const rendered = args.map((arg) => {
    if (typeof arg === 'string') return arg
    return util.inspect(sanitizeValue(arg), {
      depth: 4,
      breakLength: 140,
      maxArrayLength: 30,
      compact: true
    })
  }).join(' ')

  return truncate(redactText(rendered))
}

const resolveLogFilePath = (): string | null => {
  const fromEnv = process.env[DATA_DIR_ENV]?.trim()
  if (fromEnv) {
    return path.join(path.resolve(fromEnv), 'logs', 'app.log')
  }

  if (stableLogFilePath) {
    return stableLogFilePath
  }

  if (!app.isReady()) {
    return null
  }

  stableLogFilePath = path.join(app.getPath('userData'), 'data', 'logs', 'app.log')
  return stableLogFilePath
}

const ensureLogFileReady = async (): Promise<string | null> => {
  const logFilePath = resolveLogFilePath()
  if (!logFilePath) return null
  await fs.mkdir(path.dirname(logFilePath), { recursive: true })
  return logFilePath
}

const rotateIfNeeded = async (logFilePath: string): Promise<void> => {
  if (isRotating) return

  try {
    const stat = await fs.stat(logFilePath)
    if (stat.size < MAX_LOG_FILE_SIZE_BYTES) return
  } catch {
    return
  }

  isRotating = true
  try {
    await fs.unlink(`${logFilePath}.${MAX_ROTATED_FILES}`).catch(() => undefined)
    for (let index = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
      const source = `${logFilePath}.${index}`
      const target = `${logFilePath}.${index + 1}`
      await fs.rename(source, target).catch(() => undefined)
    }
    await fs.rename(logFilePath, `${logFilePath}.1`).catch(() => undefined)
  } finally {
    isRotating = false
  }
}

const bufferLine = (line: string): void => {
  if (bufferedLines.length < MAX_BUFFERED_LINES) {
    bufferedLines.push(line)
    return
  }
  droppedBufferedLines += 1
}

const buildEntryLine = (entry: LogEntry): string => `${JSON.stringify(entry)}\n`

const flushBufferedLines = async (logFilePath: string): Promise<void> => {
  if (droppedBufferedLines > 0) {
    const droppedEntry: LogEntry = {
      ts: new Date().toISOString(),
      level: 'WARN',
      module: 'Logger',
      message: `Dropped ${droppedBufferedLines} buffered logs before file transport was ready`,
      pid: process.pid
    }
    bufferedLines.unshift(buildEntryLine(droppedEntry))
    droppedBufferedLines = 0
  }

  if (bufferedLines.length === 0) return

  const snapshot = bufferedLines
  bufferedLines = []
  await fs.appendFile(logFilePath, snapshot.join(''), 'utf-8')
}

const enqueueLine = (line: string): void => {
  writeQueue = writeQueue
    .then(async () => {
      const logFilePath = await ensureLogFileReady()
      if (!logFilePath) {
        bufferLine(line)
        return
      }

      await rotateIfNeeded(logFilePath)
      await flushBufferedLines(logFilePath)
      await fs.appendFile(logFilePath, line, 'utf-8')
    })
    .catch(() => undefined)
}

const emit = (level: LogLevel, module: string, message: string, context?: unknown): void => {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    module,
    message: truncate(redactText(message)),
    pid: process.pid
  }

  if (context !== undefined) {
    entry.context = sanitizeValue(context)
  }

  enqueueLine(buildEntryLine(entry))
}

export const appLogger = {
  debug: (module: string, message: string, context?: unknown): void => emit('DEBUG', module, message, context),
  info: (module: string, message: string, context?: unknown): void => emit('INFO', module, message, context),
  warn: (module: string, message: string, context?: unknown): void => emit('WARN', module, message, context),
  error: (module: string, message: string, context?: unknown): void => emit('ERROR', module, message, context),
  getLogFilePath: (): string | null => resolveLogFilePath()
}

export const installConsoleFileTransport = (): void => {
  if (consoleTransportInstalled) return
  consoleTransportInstalled = true

  const levelByMethod: Record<'log' | 'info' | 'warn' | 'error' | 'debug', LogLevel> = {
    log: 'INFO',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG'
  }

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = ['log', 'info', 'warn', 'error', 'debug']
  for (const method of methods) {
    const original = console[method].bind(console)
    console[method] = ((...args: unknown[]) => {
      original(...args)
      emit(levelByMethod[method], 'console', renderConsoleArgs(args))
    }) as typeof console[typeof method]
  }

  emit('INFO', 'Logger', 'Console file transport installed')
}
