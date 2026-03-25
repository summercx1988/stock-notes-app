import { v4 as uuidv4 } from 'uuid'
import yaml from 'js-yaml'
import fs from 'fs/promises'
import path from 'path'
import type {
  StockNote,
  TimeEntry,
  TimelineItem,
  Viewpoint,
  Action,
  NoteInputType,
  NoteCategory,
  NotesExportResult,
  NotesImportResult
} from '../../shared/types'
import { stockDatabase } from './stock-db'
import { createTraceId, logPipelineEvent } from './pipeline-logger'
import { normalizeNoteContent, normalizeStockNameText } from '../../shared/text-normalizer'

interface EntryMeta {
  id?: string
  eventTime?: string
  createdAt?: string
  inputType?: string
  category?: string
}

export class NotesService {
  private notesDir: string
  private audioDir: string
  private cache: Map<string, StockNote> = new Map()
  private filePathIndex: Map<string, string> = new Map()
  private fileIndexLoaded: boolean = false
  private fileIndexPromise: Promise<void> | null = null

  constructor(notesDir?: string) {
    this.notesDir = notesDir || path.join(process.cwd(), 'data', 'stocks')
    this.audioDir = path.join(process.cwd(), 'data', 'audio')
  }

  async addEntry(
    stockCode: string,
    data: {
      content: string
      title?: string
      eventTime?: Date | string
      category?: NoteCategory
      viewpoint?: Viewpoint
      action?: Action
      inputType?: NoteInputType
      audioFile?: string
      audioDuration?: number
      transcriptionConfidence?: number
    }
  ): Promise<TimeEntry> {
    const traceId = createTraceId('save')
    const startedAt = Date.now()
    logPipelineEvent({
      traceId,
      stage: 'save',
      status: 'start',
      stockCode,
      category: data.category
    })

    const id = uuidv4()
    const now = new Date()
    const eventTime = this.normalizeDate(data.eventTime, now)
    const normalizedContent = normalizeNoteContent(data.content)
    const title = data.title?.trim() || this.generateDefaultTitle(normalizedContent)

    const entry: TimeEntry = {
      id,
      timestamp: eventTime,
      eventTime,
      createdAt: now,
      inputType: this.normalizeInputType(data.inputType) ?? this.detectInputType(data.audioFile),
      category: data.category ?? this.createDefaultCategory(),
      title,
      content: normalizedContent,
      viewpoint: data.viewpoint ?? this.createDefaultViewpoint(),
      action: data.action,
      keywords: [],
      audioFile: data.audioFile,
      audioDuration: data.audioDuration,
      aiProcessed: false,
      transcriptionConfidence: data.transcriptionConfidence
    }

    try {
      await this.appendEntryToStockFile(stockCode, entry)
      logPipelineEvent({
        traceId,
        stage: 'save',
        status: 'success',
        stockCode,
        category: entry.category,
        durationMs: Date.now() - startedAt
      })
      return entry
    } catch (error: any) {
      logPipelineEvent({
        traceId,
        stage: 'save',
        status: 'error',
        stockCode,
        category: entry.category,
        durationMs: Date.now() - startedAt,
        errorCode: 'SAVE_FAILED',
        message: error?.message || String(error)
      })
      throw error
    }
  }

  async getStockNote(stockCode: string): Promise<StockNote | null> {
    const cached = this.cache.get(stockCode)
    if (cached) return cached

    try {
      const filePath = await this.resolveStockFilePath(stockCode)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = await this.parseStockNote(content)
      if (parsed.needsBackfill) {
        await this.rewriteStockFile(parsed.note.stockCode, parsed.note)
      }
      const note = parsed.note
      this.cache.set(stockCode, note)
      return note
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        await this.ensureFilePathIndex(true)
        try {
          const fallbackPath = await this.resolveStockFilePath(stockCode)
          const content = await fs.readFile(fallbackPath, 'utf-8')
          const parsed = await this.parseStockNote(content)
          const note = parsed.note
          this.cache.set(stockCode, note)
          return note
        } catch {
          return null
        }
      }
      return null
    }
  }

  async getEntries(stockCode: string): Promise<TimeEntry[]> {
    const note = await this.getStockNote(stockCode)
    return note?.entries || []
  }

  async getEntriesByTimeRange(
    stockCode: string,
    startDate: Date,
    endDate: Date
  ): Promise<TimeEntry[]> {
    const entries = await this.getEntries(stockCode)
    return entries.filter((entry) => {
      const eventTime = this.getEntryEventTime(entry)
      return eventTime >= startDate && eventTime <= endDate
    })
  }

  async updateEntry(
    stockCode: string,
    entryId: string,
    data: Partial<TimeEntry>
  ): Promise<TimeEntry> {
    const stockNote = await this.getStockNote(stockCode)
    if (!stockNote) {
      throw new Error(`Stock note not found: ${stockCode}`)
    }

    const index = stockNote.entries.findIndex((entry) => entry.id === entryId)
    if (index === -1) {
      throw new Error(`Entry not found: ${entryId}`)
    }

    const current = stockNote.entries[index]
    const normalizedContent = typeof data.content === 'string'
      ? normalizeNoteContent(data.content)
      : current.content
    const updatedEventTime = this.normalizeDate(
      data.eventTime ?? data.timestamp,
      this.getEntryEventTime(current)
    )
    const updatedTitle = data.title ?? (data.content ? this.generateTitle(normalizedContent) : current.title)
    const normalizedPatch = {
      ...data,
      content: normalizedContent
    }

    const updated: TimeEntry = {
      ...current,
      ...normalizedPatch,
      id: current.id,
      title: updatedTitle,
      eventTime: updatedEventTime,
      timestamp: updatedEventTime,
      createdAt: this.getEntryCreatedAt(current),
      inputType: this.normalizeInputType(data.inputType) ?? current.inputType
    }

    stockNote.entries[index] = updated
    await this.rewriteStockFile(stockCode, stockNote)
    return updated
  }

  async deleteEntry(stockCode: string, entryId: string): Promise<void> {
    const stockNote = await this.getStockNote(stockCode)
    if (!stockNote) return

    const originalLength = stockNote.entries.length
    stockNote.entries = stockNote.entries.filter((entry) => entry.id !== entryId)
    if (stockNote.entries.length === originalLength) {
      throw new Error(`Entry not found: ${entryId}`)
    }

    await this.rewriteStockFile(stockCode, stockNote)
  }

  async getTimeline(filters?: {
    stockCode?: string
    startDate?: Date
    endDate?: Date
    viewpoint?: string
    category?: NoteCategory
  }): Promise<TimelineItem[]> {
    const traceId = createTraceId('timeline')
    const startedAt = Date.now()
    logPipelineEvent({
      traceId,
      stage: 'timeline',
      status: 'start',
      stockCode: filters?.stockCode,
      category: filters?.category
    })

    const stockCodes = await this.getAllStockCodes()
    const items: TimelineItem[] = []

    for (const code of stockCodes) {
      if (filters?.stockCode && code !== filters.stockCode) continue

      const note = await this.getStockNote(code)
      if (!note) continue

      for (const entry of note.entries) {
        const eventTime = this.getEntryEventTime(entry)
        if (filters?.viewpoint && entry.viewpoint?.direction !== filters.viewpoint) continue
        if (filters?.category && entry.category !== filters.category) continue
        if (filters?.startDate && eventTime < filters.startDate) continue
        if (filters?.endDate && eventTime > filters.endDate) continue

        items.push({
          id: entry.id,
          stockCode: code,
          stockName: note.stockName,
          timestamp: eventTime,
          category: entry.category,
          title: entry.title,
          viewpoint: entry.viewpoint,
          hasAudio: !!entry.audioFile
        })
      }
    }

    const sorted = items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    logPipelineEvent({
      traceId,
      stage: 'timeline',
      status: 'success',
      stockCode: filters?.stockCode,
      category: filters?.category,
      durationMs: Date.now() - startedAt,
      extra: { total_items: sorted.length }
    })
    return sorted
  }

  async exportStockNote(stockCode: string, outputDir: string): Promise<NotesExportResult> {
    const note = await this.getStockNote(stockCode)
    if (!note) {
      throw new Error(`Stock note not found: ${stockCode}`)
    }

    await fs.mkdir(outputDir, { recursive: true })
    const exportDir = path.join(outputDir, this.createExportFolderName('single', stockCode))
    const stocksDir = path.join(exportDir, 'stocks')
    const audioDir = path.join(exportDir, 'audio')
    await fs.mkdir(stocksDir, { recursive: true })
    await fs.mkdir(audioDir, { recursive: true })

    const sourceNotePath = await this.resolveStockFilePath(stockCode)
    const targetNotePath = path.join(stocksDir, path.basename(sourceNotePath))
    await fs.copyFile(sourceNotePath, targetNotePath)

    let copiedAudioDirs = 0
    const sourceAudioDir = path.join(this.audioDir, stockCode)
    if (await this.pathExists(sourceAudioDir)) {
      await fs.cp(sourceAudioDir, path.join(audioDir, stockCode), { recursive: true, force: true })
      copiedAudioDirs = 1
    }

    const manifestPath = path.join(exportDir, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify({
      schema_version: '1.0.0',
      exported_at: new Date().toISOString(),
      scope: 'single',
      stock_codes: [stockCode],
      file_naming: '股票名称(股票代码).md'
    }, null, 2), 'utf-8')

    return {
      scope: 'single',
      stockCode,
      outputDir,
      exportDir,
      exportedStocks: [stockCode],
      exportedFiles: 1,
      copiedAudioDirs,
      manifestPath
    }
  }

  async exportAllNotes(outputDir: string): Promise<NotesExportResult> {
    await fs.mkdir(outputDir, { recursive: true })
    const exportDir = path.join(outputDir, this.createExportFolderName('all'))
    const stocksDir = path.join(exportDir, 'stocks')
    const audioDir = path.join(exportDir, 'audio')
    await fs.mkdir(stocksDir, { recursive: true })
    await fs.mkdir(audioDir, { recursive: true })

    const stockCodes = await this.getAllStockCodes()
    let exportedFiles = 0
    let copiedAudioDirs = 0

    for (const stockCode of stockCodes) {
      const sourceNotePath = await this.resolveStockFilePath(stockCode)
      if (!(await this.pathExists(sourceNotePath))) continue

      const targetNotePath = path.join(stocksDir, path.basename(sourceNotePath))
      await fs.copyFile(sourceNotePath, targetNotePath)
      exportedFiles += 1

      const sourceAudioDir = path.join(this.audioDir, stockCode)
      if (await this.pathExists(sourceAudioDir)) {
        await fs.cp(sourceAudioDir, path.join(audioDir, stockCode), { recursive: true, force: true })
        copiedAudioDirs += 1
      }
    }

    const manifestPath = path.join(exportDir, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify({
      schema_version: '1.0.0',
      exported_at: new Date().toISOString(),
      scope: 'all',
      stock_codes: stockCodes,
      file_naming: '股票名称(股票代码).md'
    }, null, 2), 'utf-8')

    return {
      scope: 'all',
      outputDir,
      exportDir,
      exportedStocks: stockCodes,
      exportedFiles,
      copiedAudioDirs,
      manifestPath
    }
  }

  async importNotesFromDirectory(sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> {
    const stocksSourceDir = await this.resolveStocksSourceDir(sourceDir)
    const files = await fs.readdir(stocksSourceDir)
    const mdFiles = files.filter((fileName) => fileName.endsWith('.md'))

    const result: NotesImportResult = {
      sourceDir,
      mode,
      imported: 0,
      skipped: 0,
      failed: 0,
      importedStocks: [],
      skippedStocks: [],
      failedFiles: []
    }

    for (const fileName of mdFiles) {
      const sourceFilePath = path.join(stocksSourceDir, fileName)
      try {
        const rawContent = await fs.readFile(sourceFilePath, 'utf-8')
        const frontMatterInfo = this.extractStockMetaFromFrontMatter(rawContent)
        const stockCode = this.resolveStockCodeForImport(fileName, frontMatterInfo.stockCode)
        if (!stockCode) {
          result.failed += 1
          result.failedFiles.push({ fileName, reason: '无法识别股票代码' })
          continue
        }

        const stockName = frontMatterInfo.stockName || (await this.getStockInfo(stockCode))?.name || stockCode
        const targetPath = this.getPreferredStockFilePath(stockCode, stockName)
        const existingPath = await this.resolveStockFilePath(stockCode)
        const hasExisting = await this.pathExists(existingPath)

        if (hasExisting && mode === 'skip') {
          result.skipped += 1
          result.skippedStocks.push(stockCode)
          continue
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.copyFile(sourceFilePath, targetPath)

        if (hasExisting && existingPath !== targetPath && mode === 'replace' && await this.pathExists(existingPath)) {
          await fs.unlink(existingPath).catch(() => undefined)
        }

        const sourceAudioDir = path.join(sourceDir, 'audio', stockCode)
        if (await this.pathExists(sourceAudioDir)) {
          await fs.mkdir(this.audioDir, { recursive: true })
          await fs.cp(sourceAudioDir, path.join(this.audioDir, stockCode), { recursive: true, force: mode === 'replace' })
        }

        this.filePathIndex.set(stockCode, targetPath)
        this.cache.delete(stockCode)
        result.imported += 1
        result.importedStocks.push(stockCode)
      } catch (error: any) {
        result.failed += 1
        result.failedFiles.push({ fileName, reason: error?.message || String(error) })
      }
    }

    await this.ensureFilePathIndex(true)
    return result
  }

  private generateTitle(content: string): string {
    const firstLine = content.trim().split('\n')[0] || ''
    return firstLine.slice(0, 50) || '无标题'
  }

  private generateDefaultTitle(content?: string): string {
    return this.generateTitle(content || '')
  }

  private async appendEntryToStockFile(stockCode: string, entry: TimeEntry): Promise<void> {
    try {
      const existing = await this.getStockNote(stockCode)
      if (!existing) {
        await this.createStockFile(stockCode, entry)
        return
      }

      existing.entries.push(entry)
      await this.rewriteStockFile(stockCode, existing)
    } catch {
      await this.createStockFile(stockCode, entry)
    }
  }

  private async createStockFile(stockCode: string, entry?: TimeEntry): Promise<void> {
    const stockInfo = await this.getStockInfo(stockCode)
    const resolvedStockName = stockInfo?.name || stockCode
    const filePath = this.getPreferredStockFilePath(stockCode, resolvedStockName)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    const createdAt = new Date()

    const frontMatter = {
      stock_code: stockCode,
      stock_name: resolvedStockName,
      market: stockInfo?.market || 'SH',
      industry: stockInfo?.industry,
      sector: stockInfo?.sector,
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
      total_entries: entry ? 1 : 0,
      total_audio_duration: entry?.audioDuration || 0
    }

    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1 })
    let content = `---\n${yamlStr}---\n`

    if (entry) {
      content += `\n\n${this.entryToMarkdown(entry, stockCode)}`
    }

    await fs.writeFile(filePath, content, 'utf-8')
    this.filePathIndex.set(stockCode, filePath)
    this.fileIndexLoaded = true
    this.cache.delete(stockCode)
  }

  private async rewriteStockFile(stockCode: string, stockNote?: StockNote): Promise<void> {
    const note = stockNote ?? await this.getStockNote(stockCode)
    if (!note) return

    const currentPath = await this.resolveStockFilePath(stockCode)
    const sortedEntries = [...note.entries].sort(
      (a, b) => this.getEntryEventTime(b).getTime() - this.getEntryEventTime(a).getTime()
    )
    const stockInfo = await this.getStockInfo(note.stockCode)
    const resolvedStockName = note.stockName && note.stockName !== note.stockCode
      ? note.stockName
      : (stockInfo?.name || note.stockCode)
    const preferredPath = this.getPreferredStockFilePath(note.stockCode, resolvedStockName)

    const frontMatter = {
      stock_code: note.stockCode,
      stock_name: resolvedStockName,
      market: note.market,
      industry: note.industry,
      sector: note.sector,
      created_at: note.createdAt.toISOString(),
      updated_at: new Date().toISOString(),
      total_entries: sortedEntries.length,
      total_audio_duration: sortedEntries.reduce((sum, entry) => sum + (entry.audioDuration || 0), 0)
    }

    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1 })
    let content = `---\n${yamlStr}---\n`

    let currentDate = ''
    for (const entry of sortedEntries) {
      const eventTime = this.getEntryEventTime(entry)
      const entryDate = eventTime.toISOString().split('T')[0]
      if (entryDate !== currentDate) {
        content += `\n---\n\n## 📅 ${entryDate}\n`
        currentDate = entryDate
      }
      content += this.entryToMarkdown(entry, note.stockCode)
    }

    await fs.mkdir(path.dirname(preferredPath), { recursive: true })
    await fs.writeFile(preferredPath, content, 'utf-8')
    if (preferredPath !== currentPath && await this.pathExists(currentPath)) {
      await fs.unlink(currentPath).catch(() => undefined)
    }
    this.filePathIndex.set(note.stockCode, preferredPath)
    this.fileIndexLoaded = true
    this.cache.delete(note.stockCode)
  }

  private entryToMarkdown(entry: TimeEntry, stockCode?: string): string {
    const eventTime = this.getEntryEventTime(entry)
    const createdAt = this.getEntryCreatedAt(entry)
    const inputType = entry.inputType ?? this.detectInputType(entry.audioFile)
    const title = entry.title || this.generateTitle(entry.content)

    let md = `\n<!-- entry-id: ${entry.id} -->\n`
    md += `<!-- event-time: ${eventTime.toISOString()} -->\n`
    md += `<!-- created-at: ${createdAt.toISOString()} -->\n`
    md += `<!-- input-type: ${inputType} -->\n`
    md += `<!-- category: ${entry.category} -->\n`
    md += `### 🕐 ${eventTime.toTimeString().slice(0, 5)} ${title}\n\n`
    md += `> **事件时间**: ${this.toLocalMinuteText(eventTime)}\n`
    md += `> **记录时间**: ${this.toLocalMinuteText(createdAt)}\n`
    md += `> **记录来源**: ${inputType}\n`
    md += `> **笔记类别**: ${entry.category}\n`

    const viewpoint = entry.viewpoint ?? this.createDefaultViewpoint()
    md += `> **观点**: ${viewpoint.direction} (信心: ${viewpoint.confidence}) | **周期**: ${viewpoint.timeHorizon}\n`

    if (entry.keywords.length > 0) {
      md += `> **关键词**: ${entry.keywords.join(', ')}\n`
    }

    md += `\n${entry.content.trim()}\n`

    if (entry.action) {
      md += '\n**操作记录**:\n'
      const actionParts: string[] = []
      if (entry.action.quantity !== undefined) actionParts.push(`${entry.action.quantity}股`)
      if (entry.action.price !== undefined) actionParts.push(`@ ${entry.action.price}元`)
      md += `- **${entry.action.type}**: ${actionParts.join(' ').trim()}\n`
      if (entry.action.reason) {
        md += `- **理由**: ${entry.action.reason}\n`
      }
    }

    if (entry.audioFile && stockCode) {
      const audioFileName = path.basename(entry.audioFile)
      md += `\n*音频: [${audioFileName}](../audio/${stockCode}/${audioFileName}) (${entry.audioDuration || 0}秒)*\n`
    }

    return md
  }

  private async parseStockNote(content: string): Promise<{ note: StockNote; needsBackfill: boolean }> {
    const normalized = content.replace(/\r\n/g, '\n')
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!match) throw new Error('Invalid note format')

    const frontMatter = yaml.load(match[1]) as Record<string, any>
    const body = match[2].trimStart()
    const fallbackDate = this.normalizeDate(frontMatter.updated_at, new Date())
    const entries = this.parseEntries(body, fallbackDate)
    const stockCode = String(frontMatter.stock_code || '').trim()
    const rawStockName = String(frontMatter.stock_name || '').trim()
    const normalizedRawName = normalizeStockNameText(rawStockName)
    const stockInfo = await this.getStockInfo(stockCode)
    const resolvedStockName = normalizedRawName && normalizedRawName !== stockCode
      ? normalizedRawName
      : (stockInfo?.name || stockCode)
    const needsBackfill = (!normalizedRawName || normalizedRawName === stockCode) && resolvedStockName !== stockCode

    return {
      note: {
        stockCode,
        stockName: resolvedStockName,
        market: (frontMatter.market || 'SH') as StockNote['market'],
        industry: frontMatter.industry,
        sector: frontMatter.sector,
        createdAt: this.normalizeDate(frontMatter.created_at, new Date()),
        updatedAt: this.normalizeDate(frontMatter.updated_at, new Date()),
        totalEntries: Number(frontMatter.total_entries || entries.length),
        totalAudioDuration: Number(frontMatter.total_audio_duration || 0),
        entries
      },
      needsBackfill
    }
  }

  private parseEntries(body: string, fallbackDate: Date): TimeEntry[] {
    const lines = body.split('\n')
    const entries: TimeEntry[] = []
    let currentDate = ''
    let pendingMeta: EntryMeta = {}

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const dateMatch = line.match(/^## 📅\s+(\d{4}-\d{2}-\d{2})\s*$/)
      if (dateMatch) {
        currentDate = dateMatch[1]
        continue
      }

      const metaMatch = line.match(/^<!--\s*(entry-id|event-time|created-at|input-type|category):\s*(.+?)\s*-->$/)
      if (metaMatch) {
        const key = metaMatch[1]
        const value = metaMatch[2].trim()
        if (key === 'entry-id') pendingMeta.id = value
        if (key === 'event-time') pendingMeta.eventTime = value
        if (key === 'created-at') pendingMeta.createdAt = value
        if (key === 'input-type') pendingMeta.inputType = value
        if (key === 'category') pendingMeta.category = value
        continue
      }

      const headerMatch = line.match(/^### 🕐\s+(\d{2}:\d{2})\s+(.+)$/)
      if (!headerMatch) continue

      const headingTime = headerMatch[1]
      const title = headerMatch[2].trim()
      const blockLines: string[] = []
      let cursor = i + 1
      while (cursor < lines.length) {
        const nextLine = lines[cursor]
        if (
          nextLine.startsWith('### 🕐 ') ||
          nextLine.startsWith('## 📅 ') ||
          nextLine.startsWith('<!-- entry-id:')
        ) {
          break
        }
        blockLines.push(nextLine)
        cursor += 1
      }

      const entry = this.parseEntryBlock({
        title,
        headingTime,
        currentDate,
        fallbackDate,
        lines: blockLines,
        meta: pendingMeta
      })

      entries.push(entry)
      pendingMeta = {}
      i = cursor - 1
    }

    return entries
  }

  private parseEntryBlock(params: {
    title: string
    headingTime: string
    currentDate: string
    fallbackDate: Date
    lines: string[]
    meta: EntryMeta
  }): TimeEntry {
    const { title, headingTime, currentDate, fallbackDate, lines, meta } = params

    let viewpoint: Viewpoint | undefined
    let action: Action | undefined
    let audioFile: string | undefined
    let audioDuration: number | undefined
    const keywords: string[] = []
    const contentLines: string[] = []

    let eventTimeLabel: string | undefined
    let createdAtLabel: string | undefined
    let inputTypeLabel: string | undefined
    let categoryLabel: string | undefined

    let inActionSection = false

    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      const trimmed = line.trim()

      const eventTimeMatch = trimmed.match(/^>\s*\*\*事件时间\*\*:\s*(.+)$/)
      if (eventTimeMatch) {
        eventTimeLabel = eventTimeMatch[1].trim()
        continue
      }

      const createdAtMatch = trimmed.match(/^>\s*\*\*记录时间\*\*:\s*(.+)$/)
      if (createdAtMatch) {
        createdAtLabel = createdAtMatch[1].trim()
        continue
      }

      const inputTypeMatch = trimmed.match(/^>\s*\*\*记录来源\*\*:\s*(.+)$/)
      if (inputTypeMatch) {
        inputTypeLabel = inputTypeMatch[1].trim()
        continue
      }

      const categoryMatch = trimmed.match(/^>\s*\*\*笔记类别\*\*:\s*(.+)$/)
      if (categoryMatch) {
        categoryLabel = categoryMatch[1].trim()
        continue
      }

      const viewpointMatch = trimmed.match(
        /^>\s*\*\*观点\*\*:\s*(看多|看空|未知|中性|观望)(?:\s*\(信心:\s*([0-9.]+)\))?(?:\s*\|\s*\*\*周期\*\*:\s*(短线|中线|长线))?/
      )
      if (viewpointMatch) {
        viewpoint = {
          direction: viewpointMatch[1] as Viewpoint['direction'],
          confidence: Number(viewpointMatch[2] || 0),
          timeHorizon: (viewpointMatch[3] as Viewpoint['timeHorizon']) || '短线'
        }
        continue
      }

      const keywordMatch = trimmed.match(/^>\s*\*\*关键词\*\*:\s*(.+)$/)
      if (keywordMatch) {
        keywords.push(...keywordMatch[1].split(',').map((item) => item.trim()).filter(Boolean))
        continue
      }

      if (trimmed === '**操作记录**:') {
        inActionSection = true
        action = action || { type: '观望' }
        continue
      }

      if (inActionSection) {
        const actionLineMatch = trimmed.match(/^- \*\*(买入|卖出|持有|观望)\*\*:\s*(.*)$/)
        if (actionLineMatch) {
          const details = actionLineMatch[2]
          const quantityMatch = details.match(/(\d+)\s*股/)
          const priceMatch = details.match(/@\s*([0-9.]+)/)
          action = {
            ...(action || { type: '观望' }),
            type: actionLineMatch[1] as Action['type'],
            quantity: quantityMatch ? Number(quantityMatch[1]) : undefined,
            price: priceMatch ? Number(priceMatch[1]) : undefined
          }
          continue
        }

        const reasonMatch = trimmed.match(/^- \*\*理由\*\*:\s*(.+)$/)
        if (reasonMatch) {
          action = {
            ...(action || { type: '观望' }),
            reason: reasonMatch[1].trim()
          }
          continue
        }

        if (!trimmed) {
          inActionSection = false
          continue
        }
      }

      const audioMatch = trimmed.match(/^\*音频:\s+\[(.+?)\]\((.+?)\)\s+\((\d+)秒\)\*$/)
      if (audioMatch) {
        audioFile = audioMatch[1]
        audioDuration = Number(audioMatch[3])
        continue
      }

      contentLines.push(rawLine)
    }

    const normalizedContent = normalizeNoteContent(contentLines.join('\n').trim())
    const eventTime = this.resolveEventTime({
      metaEventTime: meta.eventTime,
      lineEventTime: eventTimeLabel,
      currentDate,
      headingTime,
      fallbackDate
    })
    const createdAt = this.normalizeDate(meta.createdAt ?? createdAtLabel, eventTime)
    const inputType = this.normalizeInputType(meta.inputType ?? inputTypeLabel) ?? this.detectInputType(audioFile)

    return {
      id: meta.id || uuidv4(),
      timestamp: eventTime,
      eventTime,
      createdAt,
      inputType,
      category: this.normalizeCategory(meta.category ?? categoryLabel),
      title,
      content: normalizedContent || title,
      viewpoint: viewpoint ?? this.createDefaultViewpoint(),
      action,
      keywords,
      audioFile,
      audioDuration,
      aiProcessed: false
    }
  }

  private resolveEventTime(params: {
    metaEventTime?: string
    lineEventTime?: string
    currentDate: string
    headingTime: string
    fallbackDate: Date
  }): Date {
    const { metaEventTime, lineEventTime, currentDate, headingTime, fallbackDate } = params

    if (metaEventTime) {
      return this.normalizeDate(metaEventTime, fallbackDate)
    }
    if (lineEventTime) {
      return this.normalizeDate(lineEventTime, fallbackDate)
    }
    if (currentDate) {
      return this.normalizeDate(`${currentDate} ${headingTime}`, fallbackDate)
    }

    const fallbackDateText = fallbackDate.toISOString().split('T')[0]
    return this.normalizeDate(`${fallbackDateText} ${headingTime}`, fallbackDate)
  }

  private createDefaultViewpoint(): Viewpoint {
    return {
      direction: '未知',
      confidence: 0,
      timeHorizon: '短线'
    }
  }

  private createDefaultCategory(): NoteCategory {
    return '看盘预测'
  }

  private getEntryEventTime(entry: TimeEntry): Date {
    return this.normalizeDate(entry.eventTime ?? entry.timestamp, new Date())
  }

  private getEntryCreatedAt(entry: TimeEntry): Date {
    return this.normalizeDate(entry.createdAt ?? entry.eventTime ?? entry.timestamp, new Date())
  }

  private normalizeInputType(value?: string): NoteInputType | undefined {
    if (!value) return undefined
    if (value === 'voice' || value === 'manual') return value
    return undefined
  }

  private normalizeCategory(value?: string): NoteCategory {
    if (value === '看盘预测' || value === '交易札记' || value === '备忘' || value === '资讯备忘') {
      return value
    }
    return this.createDefaultCategory()
  }

  private detectInputType(audioFile?: string): NoteInputType {
    return audioFile ? 'voice' : 'manual'
  }

  private normalizeDate(input: Date | string | undefined, fallback: Date): Date {
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      return input
    }
    if (typeof input === 'string') {
      const trimmed = input.trim()
      if (trimmed) {
        const localMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2})(?::\d{2})?$/)
        if (localMatch) {
          const localDate = new Date(`${localMatch[1]}T${localMatch[2]}:00`)
          if (!Number.isNaN(localDate.getTime())) {
            return localDate
          }
        }

        const parsed = new Date(trimmed)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed
        }
      }
    }

    return fallback
  }

  private toLocalMinuteText(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }

  private async getAllStockCodes(): Promise<string[]> {
    await this.ensureFilePathIndex()
    return Array.from(this.filePathIndex.keys())
  }

  private async resolveStockFilePath(stockCode: string): Promise<string> {
    await this.ensureFilePathIndex()
    const indexedPath = this.filePathIndex.get(stockCode)
    if (indexedPath) {
      return indexedPath
    }
    return this.getPreferredStockFilePath(stockCode, stockCode)
  }

  private getPreferredStockFilePath(stockCode: string, stockName: string): string {
    const safeName = this.sanitizeStockFileSegment(stockName || stockCode)
    return path.join(this.notesDir, `${safeName}(${stockCode}).md`)
  }

  private sanitizeStockFileSegment(input: string): string {
    const sanitized = normalizeStockNameText(input)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/[()]/g, '')
      .trim()

    if (!sanitized) {
      return '未命名股票'
    }
    if (sanitized.length > 48) {
      return sanitized.slice(0, 48)
    }
    return sanitized
  }

  private async ensureFilePathIndex(force: boolean = false): Promise<void> {
    if (!force && this.fileIndexLoaded) {
      return
    }
    if (!force && this.fileIndexPromise) {
      return this.fileIndexPromise
    }

    this.fileIndexPromise = this.rebuildFilePathIndex().finally(() => {
      this.fileIndexPromise = null
    })
    await this.fileIndexPromise
  }

  private async rebuildFilePathIndex(): Promise<void> {
    const latestByCode = new Map<string, { filePath: string; mtimeMs: number }>()

    try {
      await fs.mkdir(this.notesDir, { recursive: true })
      const files = await fs.readdir(this.notesDir)
      for (const fileName of files) {
        if (!fileName.endsWith('.md')) continue

        const stockCode = this.parseStockCodeFromFileName(fileName)
        if (!stockCode) continue

        const fullPath = path.join(this.notesDir, fileName)
        const stat = await fs.stat(fullPath)
        const mtimeMs = stat.mtimeMs
        const previous = latestByCode.get(stockCode)
        if (!previous || mtimeMs >= previous.mtimeMs) {
          latestByCode.set(stockCode, { filePath: fullPath, mtimeMs })
        }
      }
    } catch {
      // ignore, leave empty index
    }

    this.filePathIndex.clear()
    for (const [stockCode, info] of latestByCode.entries()) {
      this.filePathIndex.set(stockCode, info.filePath)
    }
    this.fileIndexLoaded = true
  }

  private parseStockCodeFromFileName(fileName: string): string | null {
    const basename = fileName.replace(/\.md$/i, '')
    const directCode = basename.match(/^(\d{6})$/)
    if (directCode) return directCode[1]

    const newStyleCode = basename.match(/\((\d{6})\)$/)
    if (newStyleCode) return newStyleCode[1]

    const legacyCode = basename.match(/^(\d{6})[-_]/)
    if (legacyCode) return legacyCode[1]

    const anyCode = basename.match(/(\d{6})/)
    if (anyCode) return anyCode[1]

    return null
  }

  private createExportFolderName(scope: 'single' | 'all', stockCode?: string): string {
    const now = new Date()
    const text = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('')
    return scope === 'single'
      ? `stock-notes-export-${stockCode || 'unknown'}-${text}`
      : `stock-notes-export-all-${text}`
  }

  private async resolveStocksSourceDir(sourceDir: string): Promise<string> {
    const stocksDir = path.join(sourceDir, 'stocks')
    if (await this.pathExists(stocksDir)) {
      return stocksDir
    }
    return sourceDir
  }

  private extractStockMetaFromFrontMatter(content: string): { stockCode?: string; stockName?: string } {
    const normalized = content.replace(/\r\n/g, '\n')
    const match = normalized.match(/^---\n([\s\S]*?)\n---/)
    if (!match) {
      return {}
    }
    try {
      const meta = yaml.load(match[1]) as Record<string, unknown>
      const stockCode = typeof meta?.stock_code === 'string' ? meta.stock_code.trim() : undefined
      const stockName = typeof meta?.stock_name === 'string' ? meta.stock_name.trim() : undefined
      return { stockCode, stockName }
    } catch {
      return {}
    }
  }

  private resolveStockCodeForImport(fileName: string, stockCodeFromMeta?: string): string | null {
    if (stockCodeFromMeta && /^\d{6}$/.test(stockCodeFromMeta)) {
      return stockCodeFromMeta
    }
    return this.parseStockCodeFromFileName(fileName)
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private async getStockInfo(stockCode: string): Promise<{
    name: string
    market: string
    industry?: string
    sector?: string
  } | null> {
    await stockDatabase.ensureLoaded()
    const stock = stockDatabase.getByCode(stockCode)
    if (!stock) {
      return { name: stockCode, market: 'SH' }
    }
    return {
      name: stock.name,
      market: stock.market,
      industry: stock.industry,
      sector: stock.sector
    }
  }
}
