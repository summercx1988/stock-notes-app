import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type {
  Action,
  NoteCategory,
  NoteInputType,
  OperationTag,
  TimeEntry,
  TrackingStatus,
  Viewpoint
} from '../../shared/types'
import { normalizeNoteContent } from '../../shared/text-normalizer'

interface EntryMeta {
  id?: string
  eventTime?: string
  createdAt?: string
  inputType?: string
  category?: string
  operationTag?: string
  trackingStatus?: string
}

export interface NotesEntryFormatDeps {
  buildEventTitle: (eventTime: Date) => string
  getEntryCreatedAt: (entry: TimeEntry) => Date
  getEntryEventTime: (entry: TimeEntry) => Date
  detectInputType: (audioFile?: string) => NoteInputType
  normalizeOperationTag: (value?: string, action?: Action) => OperationTag
  normalizeTrackingStatus: (value?: string) => TrackingStatus
  normalizeViewpoint: (viewpoint?: Viewpoint) => Viewpoint
  createDefaultViewpoint: () => Viewpoint
  toLocalMinuteText: (value: Date) => string
}

export const formatEntryToMarkdown = (
  entry: TimeEntry,
  deps: NotesEntryFormatDeps,
  stockCode?: string
): string => {
  const eventTime = deps.getEntryEventTime(entry)
  const createdAt = deps.getEntryCreatedAt(entry)
  const inputType = entry.inputType ?? deps.detectInputType(entry.audioFile)
  const title = deps.buildEventTitle(eventTime)
  const operationTag = deps.normalizeOperationTag(entry.operationTag, entry.action)

  let md = `\n<!-- entry-id: ${entry.id} -->\n`
  md += `<!-- event-time: ${eventTime.toISOString()} -->\n`
  md += `<!-- created-at: ${createdAt.toISOString()} -->\n`
  md += `<!-- input-type: ${inputType} -->\n`
  md += `<!-- category: ${entry.category} -->\n`
  md += `<!-- operation-tag: ${operationTag} -->\n`
  md += `<!-- tracking-status: ${deps.normalizeTrackingStatus(entry.trackingStatus)} -->\n`
  md += `### 🕐 ${title}\n\n`
  md += `> **事件时间**: ${deps.toLocalMinuteText(eventTime)}\n`
  md += `> **记录时间**: ${deps.toLocalMinuteText(createdAt)}\n`
  md += `> **记录来源**: ${inputType}\n`
  md += `> **笔记类别**: ${entry.category}\n`
  md += `> **操作打标**: ${operationTag}\n`
  md += `> **跟踪状态**: ${deps.normalizeTrackingStatus(entry.trackingStatus)}\n`

  const viewpoint = deps.normalizeViewpoint(entry.viewpoint ?? deps.createDefaultViewpoint())
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

export interface NotesEntryParseDeps {
  normalizeDate: (input: Date | string | undefined, fallback: Date) => Date
  normalizeInputType: (value?: string) => NoteInputType | undefined
  detectInputType: (audioFile?: string) => NoteInputType
  normalizeCategory: (value?: string) => NoteCategory
  normalizeOperationTag: (value?: string, action?: Action) => OperationTag
  normalizeTrackingStatus: (value?: string) => TrackingStatus
  normalizeViewpoint: (viewpoint?: Viewpoint) => Viewpoint
  createDefaultViewpoint: () => Viewpoint
}

export const parseEntriesFromMarkdown = (
  body: string,
  fallbackDate: Date,
  deps: NotesEntryParseDeps
): TimeEntry[] => {
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

    const metaMatch = line.match(/^<!--\s*(entry-id|event-time|created-at|input-type|category|operation-tag|tracking-status):\s*(.+?)\s*-->$/)
    if (metaMatch) {
      const key = metaMatch[1]
      const value = metaMatch[2].trim()
      if (key === 'entry-id') pendingMeta.id = value
      if (key === 'event-time') pendingMeta.eventTime = value
      if (key === 'created-at') pendingMeta.createdAt = value
      if (key === 'input-type') pendingMeta.inputType = value
      if (key === 'category') pendingMeta.category = value
      if (key === 'operation-tag') pendingMeta.operationTag = value
      if (key === 'tracking-status') pendingMeta.trackingStatus = value
      continue
    }

    let headingTime = ''
    let title = ''

    const datetimeHeaderMatch = line.match(/^### 🕐\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/)
    if (datetimeHeaderMatch) {
      const fullDateTime = datetimeHeaderMatch[1]
      headingTime = fullDateTime.slice(11, 16)
      title = fullDateTime
      if (!pendingMeta.eventTime) {
        pendingMeta.eventTime = fullDateTime
      }
    } else {
      const legacyHeaderMatch = line.match(/^### 🕐\s+(\d{2}:\d{2})\s+(.+)$/)
      if (!legacyHeaderMatch) continue
      headingTime = legacyHeaderMatch[1]
      title = legacyHeaderMatch[2].trim()
    }

    const blockLines: string[] = []
    let cursor = i + 1
    while (cursor < lines.length) {
      const nextLine = lines[cursor]
      if (
        nextLine.startsWith('### 🕐 ') ||
        nextLine.startsWith('## 📅 ') ||
        nextLine.startsWith('<!-- entry-id:') ||
        nextLine.trim() === '---'
      ) {
        break
      }
      blockLines.push(nextLine)
      cursor += 1
    }

    const entry = parseEntryBlock({
      title,
      headingTime,
      currentDate,
      fallbackDate,
      lines: blockLines,
      meta: pendingMeta,
      deps
    })

    entries.push(entry)
    pendingMeta = {}
    i = cursor - 1
  }

  return entries
}

const parseEntryBlock = (params: {
  title: string
  headingTime: string
  currentDate: string
  fallbackDate: Date
  lines: string[]
  meta: EntryMeta
  deps: NotesEntryParseDeps
}): TimeEntry => {
  const { title, headingTime, currentDate, fallbackDate, lines, meta, deps } = params

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
  let operationTagLabel: string | undefined
  let trackingStatusLabel: string | undefined

  let inActionSection = false

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed === '---') {
      continue
    }

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

    const operationTagMatch = trimmed.match(/^>\s*\*\*操作打标\*\*:\s*(.+)$/)
    if (operationTagMatch) {
      operationTagLabel = operationTagMatch[1].trim()
      continue
    }

    const trackingStatusMatch = trimmed.match(/^>\s*\*\*跟踪状态\*\*:\s*(.+)$/)
    if (trackingStatusMatch) {
      trackingStatusLabel = trackingStatusMatch[1].trim()
      continue
    }

    const viewpointMatch = trimmed.match(
      /^>\s*\*\*观点\*\*:\s*([^()|]+?)(?:\s*\(信心:\s*([0-9.]+)\))?(?:\s*\|\s*\*\*周期\*\*:\s*(.+))?$/
    )
    if (viewpointMatch) {
      viewpoint = {
        direction: viewpointMatch[1].trim(),
        confidence: Number(viewpointMatch[2] || 0),
        timeHorizon: viewpointMatch[3]?.trim() || '短线'
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

  const normalizedContent = normalizeNoteContent(stripTrailingSeparators(contentLines).join('\n').trim())
  const eventTime = resolveEventTime({
    metaEventTime: meta.eventTime,
    lineEventTime: eventTimeLabel,
    currentDate,
    headingTime,
    fallbackDate,
    deps
  })
  const createdAt = deps.normalizeDate(meta.createdAt ?? createdAtLabel, eventTime)
  const inputType = deps.normalizeInputType(meta.inputType ?? inputTypeLabel) ?? deps.detectInputType(audioFile)

  return {
    id: meta.id || uuidv4(),
    timestamp: eventTime,
    eventTime,
    createdAt,
    inputType,
    category: deps.normalizeCategory(meta.category ?? categoryLabel),
    operationTag: deps.normalizeOperationTag(meta.operationTag ?? operationTagLabel, action),
    trackingStatus: deps.normalizeTrackingStatus(meta.trackingStatus ?? trackingStatusLabel),
    title,
    content: normalizedContent || title,
    viewpoint: deps.normalizeViewpoint(viewpoint ?? deps.createDefaultViewpoint()),
    action,
    keywords,
    audioFile,
    audioDuration,
    aiProcessed: false
  }
}

const resolveEventTime = (params: {
  metaEventTime?: string
  lineEventTime?: string
  currentDate: string
  headingTime: string
  fallbackDate: Date
  deps: NotesEntryParseDeps
}): Date => {
  const { metaEventTime, lineEventTime, currentDate, headingTime, fallbackDate, deps } = params

  if (metaEventTime) {
    return deps.normalizeDate(metaEventTime, fallbackDate)
  }
  if (lineEventTime) {
    return deps.normalizeDate(lineEventTime, fallbackDate)
  }
  if (currentDate) {
    return deps.normalizeDate(`${currentDate} ${headingTime}`, fallbackDate)
  }

  const fallbackDateText = fallbackDate.toISOString().split('T')[0]
  return deps.normalizeDate(`${fallbackDateText} ${headingTime}`, fallbackDate)
}

const stripTrailingSeparators = (lines: string[]): string[] => {
  const normalized = [...lines]
  while (normalized.length > 0) {
    const last = normalized[normalized.length - 1].trim()
    if (!last || last === '---') {
      normalized.pop()
      continue
    }
    break
  }
  return normalized
}
