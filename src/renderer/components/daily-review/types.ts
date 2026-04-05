import type { TimeEntry } from '../../../shared/types'

export interface ReviewGenerationMeta {
  generationMode?: 'local' | 'hybrid'
  aiStatus?: 'pending' | 'completed' | 'fallback'
  lookbackDays?: number
  note?: string
}

export interface DailySummaryData {
  version: string
  generatedAt: string
  meta?: ReviewGenerationMeta
  stats: {
    totalNotes: number
    stocksCount: number
    buyActions: number
    sellActions: number
    bullishNotes: number
    bearishNotes: number
  }
  content: {
    overview: string
    keyDecisions: Array<{
      stockCode: string
      stockName: string
      action: string
      reason: string
      confidence: number
      entryId: string
    }>
    riskAlerts: Array<{
      level: string
      description: string
      relatedStocks: string[]
      suggestion: string
    }>
    tomorrowFocus: Array<{
      stockCode: string
      stockName: string
      reason: string
      actionType: string
      sourceEntryId?: string
    }>
    marketSentiment: string
  }
  relatedEntries?: Array<{
    entryId: string
    stockCode: string
    stockName: string
    eventTime: string
    category: string
    viewpoint: string
    preview: string
  }>
}

export interface PreMarketData {
  version: string
  generatedAt: string
  sourceSummaryDate: string
  meta?: ReviewGenerationMeta
  quickReview: {
    yesterdaySummary: string
    pendingItems: Array<{
      stockCode: string
      stockName: string
      description: string
      priority: string
      dueDate: string
      sourceEntryId: string
    }>
    keyLevels: Array<{
      stockCode: string
      stockName: string
      level: string
      price: number
      note: string
    }>
  }
  todayStrategy: {
    focusAreas: string[]
    watchlist: Array<{
      stockCode: string
      stockName: string
      reason: string
      expectedAction: string
    }>
    riskReminders: string[]
  }
}

type JsonObject = Record<string, unknown>

export interface ParsedCache {
  raw: JsonObject | null
  meta: ReviewGenerationMeta | null
  summaryData: DailySummaryData | null
  preMarketData: PreMarketData | null
  resolvedCategory: '每日总结' | '盘前复习' | '周回顾' | '其他'
}

const parseJSONContent = <T,>(entry: TimeEntry): T | null => {
  try {
    return JSON.parse(entry.content) as T
  } catch {
    return null
  }
}

export const isDailySummaryData = (value: unknown): value is DailySummaryData => {
  const data = value as DailySummaryData
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.stats &&
    data.content &&
    typeof data.content.overview === 'string' &&
    Array.isArray(data.content.keyDecisions) &&
    Array.isArray(data.content.riskAlerts) &&
    Array.isArray(data.content.tomorrowFocus)
  )
}

export const isPreMarketData = (value: unknown): value is PreMarketData => {
  const data = value as PreMarketData
  return Boolean(
    data &&
    typeof data === 'object' &&
    data.quickReview &&
    data.todayStrategy &&
    Array.isArray(data.quickReview.pendingItems) &&
    Array.isArray(data.todayStrategy.focusAreas) &&
    Array.isArray(data.todayStrategy.watchlist) &&
    Array.isArray(data.todayStrategy.riskReminders)
  )
}

export const parseReviewEntry = (entry: TimeEntry): ParsedCache => {
  const raw = parseJSONContent<JsonObject>(entry)
  const meta = raw && typeof raw.meta === 'object' && raw.meta !== null ? raw.meta as ReviewGenerationMeta : null
  const summaryData = isDailySummaryData(raw) ? raw : null
  const preMarketData = isPreMarketData(raw) ? raw : null
  const resolvedCategory: ParsedCache['resolvedCategory'] = entry.category === '每日总结' || entry.category === '盘前复习' || entry.category === '周回顾'
    ? entry.category
    : summaryData
      ? '每日总结'
      : preMarketData
        ? '盘前复习'
        : '其他'

  return { raw, meta, summaryData, preMarketData, resolvedCategory }
}
