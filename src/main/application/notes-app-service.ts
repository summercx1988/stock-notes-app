import { NotesService } from '../services/notes'
import { MarketDataService } from '../services/market-data'
import { evaluateActionEvents, evaluateReviewEvents } from '../core/review-evaluator'
import { buildReviewSnapshot, filterByRange, normalizeDirection } from '../core/review-snapshot'
import { createTraceId, logPipelineEvent } from '../services/pipeline-logger'
import { appConfigService } from '../services/app-config'
import type {
  Action,
  NoteCategory,
  OperationTag,
  KlineInterval,
  NoteInputType,
  ReviewEvaluateRequest,
  ReviewEvaluateResponse,
  ReviewRuleConfig,
  ReviewSnapshotRequest,
  ReviewSnapshotResponse,
  StockNote,
  TimeEntry,
  TimelineItem,
  Viewpoint,
  NotesExportResult,
  NotesImportResult
} from '../../shared/types'

interface AddEntryPayload {
  content: string
  title?: string
  eventTime?: Date | string
  category?: NoteCategory
  operationTag?: OperationTag
  viewpoint?: Viewpoint
  action?: Action
  inputType?: NoteInputType
  audioFile?: string
  audioDuration?: number
  transcriptionConfidence?: number
}

interface TimelineFilters {
  stockCode?: string
  startDate?: Date
  endDate?: Date
  viewpoint?: string
  category?: NoteCategory
}

const DEFAULT_REVIEW_RULE: ReviewRuleConfig = {
  windowDays: 3,
  thresholdPct: 3,
  excludeUnknown: true
}

export class NotesAppService {
  constructor(
    private readonly notesService: NotesService,
    private readonly marketDataService: MarketDataService
  ) {}

  addEntry(stockCode: string, data: AddEntryPayload): Promise<TimeEntry> {
    return this.notesService.addEntry(stockCode, data)
  }

  getStockNote(stockCode: string): Promise<StockNote | null> {
    return this.notesService.getStockNote(stockCode)
  }

  getEntries(stockCode: string): Promise<TimeEntry[]> {
    return this.notesService.getEntries(stockCode)
  }

  getEntriesByTimeRange(stockCode: string, start: Date, end: Date): Promise<TimeEntry[]> {
    return this.notesService.getEntriesByTimeRange(stockCode, start, end)
  }

  updateEntry(stockCode: string, entryId: string, data: Partial<TimeEntry>): Promise<TimeEntry> {
    return this.notesService.updateEntry(stockCode, entryId, data)
  }

  deleteEntry(stockCode: string, entryId: string): Promise<void> {
    return this.notesService.deleteEntry(stockCode, entryId)
  }

  getTimeline(filters?: TimelineFilters): Promise<TimelineItem[]> {
    return this.notesService.getTimeline(filters)
  }

  exportStockNote(stockCode: string, outputDir: string): Promise<NotesExportResult> {
    return this.notesService.exportStockNote(stockCode, outputDir)
  }

  exportAllNotes(outputDir: string): Promise<NotesExportResult> {
    return this.notesService.exportAllNotes(outputDir)
  }

  importNotesFromDirectory(sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> {
    return this.notesService.importNotesFromDirectory(sourceDir, mode)
  }

  async getReviewSnapshot(request: ReviewSnapshotRequest): Promise<ReviewSnapshotResponse> {
    const startDate = this.parseDate(request.startDate)
    const endDate = this.parseDate(request.endDate)
    const interval = this.normalizeInterval(request.interval)
    const reviewCategories = await this.getReviewEligibleCategories()

    if (request.scope === 'single') {
      if (!request.stockCode) {
        throw new Error('single scope requires stockCode')
      }
      const entries = await this.notesService.getEntries(request.stockCode)
      const rangedEntries = filterByRange(entries, startDate, endDate)
        .filter((entry) => reviewCategories.has(entry.category))
      const snapshot = buildReviewSnapshot(
        rangedEntries.map((entry) => ({ direction: entry.viewpoint?.direction }))
      )

      return {
        scope: 'single',
        stockCode: request.stockCode,
        startDate: request.startDate,
        endDate: request.endDate,
        interval,
        snapshot,
        generatedAt: new Date().toISOString()
      }
    }

    const timelineItems = await this.notesService.getTimeline({
      startDate,
      endDate
    })
    const snapshot = buildReviewSnapshot(
      timelineItems
        .filter((item) => reviewCategories.has(item.category))
        .map((item) => ({ direction: normalizeDirection(item.viewpoint?.direction) }))
    )

    return {
      scope: 'overall',
      startDate: request.startDate,
      endDate: request.endDate,
      interval,
      snapshot,
      generatedAt: new Date().toISOString()
    }
  }

  async getReviewEvaluation(request: ReviewEvaluateRequest): Promise<ReviewEvaluateResponse> {
    const traceId = createTraceId('review')
    const startedAt = Date.now()
    logPipelineEvent({
      traceId,
      stage: 'review',
      status: 'start',
      stockCode: request.stockCode
    })

    const startDate = this.parseDate(request.startDate)
    const endDate = this.parseDate(request.endDate)
    const interval = this.normalizeInterval(request.interval)
    const rule = this.normalizeRule(request.rule)
    try {
      const events = await this.collectReviewEvents({
        scope: request.scope,
        stockCode: request.stockCode,
        startDate,
        endDate
      })
      const actionEvents = await this.collectActionEvents({
        scope: request.scope,
        stockCode: request.stockCode,
        startDate,
        endDate
      })

      const actionableEvents = events.filter((event) => event.direction === '看多' || event.direction === '看空')
      const marketLinkedEvents = [
        ...actionableEvents.map((event) => ({
          stockCode: event.stockCode,
          eventTime: event.eventTime
        })),
        ...actionEvents.map((event) => ({
          stockCode: event.stockCode,
          eventTime: event.eventTime
        }))
      ]
      const candlesByStock: Record<string, { timestamp: string; close: number }[]> = {}
      const eventsByStock = new Map<string, Array<{ stockCode: string; eventTime: string }>>()

      for (const event of marketLinkedEvents) {
        const current = eventsByStock.get(event.stockCode) || []
        current.push(event)
        eventsByStock.set(event.stockCode, current)
      }

      for (const [stockCode, stockEvents] of eventsByStock.entries()) {
        const minEventTime = Math.min(...stockEvents.map((event) => new Date(event.eventTime).getTime()))
        const maxEventTime = Math.max(...stockEvents.map((event) => new Date(event.eventTime).getTime()))

        const fetchStart = new Date(minEventTime - (24 * 60 * 60 * 1000))
        const fetchEnd = new Date(maxEventTime + (rule.windowDays * 24 * 60 * 60 * 1000))
        const candles = await this.marketDataService.getCandles(stockCode, interval, fetchStart, fetchEnd)
        candlesByStock[stockCode] = candles.map((candle) => ({
          timestamp: candle.timestamp,
          close: candle.close
        }))
      }

      const evaluation = evaluateReviewEvents(events, candlesByStock, rule)
      const actionEvaluation = evaluateActionEvents(actionEvents, candlesByStock, rule)
      logPipelineEvent({
        traceId,
        stage: 'review',
        status: 'success',
        stockCode: request.stockCode,
        durationMs: Date.now() - startedAt,
        extra: {
          total_notes: evaluation.summary.totalNotes,
          evaluated_samples: evaluation.summary.evaluatedSamples,
          action_samples: actionEvaluation.summary.evaluatedSamples
        }
      })
      return {
        scope: request.scope,
        stockCode: request.scope === 'single' ? request.stockCode : undefined,
        startDate: request.startDate,
        endDate: request.endDate,
        interval,
        rule,
        summary: evaluation.summary,
        results: evaluation.results,
        actionSummary: actionEvaluation.summary,
        actionResults: actionEvaluation.results,
        generatedAt: new Date().toISOString()
      }
    } catch (error: any) {
      logPipelineEvent({
        traceId,
        stage: 'review',
        status: 'error',
        stockCode: request.stockCode,
        durationMs: Date.now() - startedAt,
        errorCode: 'REVIEW_FAILED',
        message: error?.message || String(error)
      })
      throw error
    }
  }

  private async collectReviewEvents(params: {
    scope: 'single' | 'overall'
    stockCode?: string
    startDate?: Date
    endDate?: Date
  }): Promise<Array<{
    entryId: string
    stockCode: string
    eventTime: string
    direction: '看多' | '看空' | '未知'
  }>> {
    const reviewCategories = await this.getReviewEligibleCategories()
    if (params.scope === 'single') {
      if (!params.stockCode) {
        throw new Error('single scope requires stockCode')
      }
      const entries = await this.notesService.getEntries(params.stockCode)
      const rangedEntries = filterByRange(entries, params.startDate, params.endDate)
        .filter((entry) => reviewCategories.has(entry.category))
      return rangedEntries.map((entry) => ({
        entryId: entry.id,
        stockCode: params.stockCode!,
        eventTime: this.toIsoString(entry.eventTime || entry.timestamp),
        direction: normalizeDirection(entry.viewpoint?.direction)
      }))
    }

    const timelineItems = await this.notesService.getTimeline({
      startDate: params.startDate,
      endDate: params.endDate
    })
    return timelineItems
      .filter((item) => reviewCategories.has(item.category))
      .map((item) => ({
      entryId: item.id,
      stockCode: item.stockCode,
      eventTime: this.toIsoString(item.timestamp),
      direction: normalizeDirection(item.viewpoint?.direction)
    }))
  }

  private async collectActionEvents(params: {
    scope: 'single' | 'overall'
    stockCode?: string
    startDate?: Date
    endDate?: Date
  }): Promise<Array<{
    entryId: string
    stockCode: string
    eventTime: string
    operationTag: '买入' | '卖出'
    viewpointDirection: '看多' | '看空' | '未知'
  }>> {
    const reviewCategories = await this.getReviewEligibleCategories()
    if (params.scope === 'single') {
      if (!params.stockCode) {
        throw new Error('single scope requires stockCode')
      }
      const entries = await this.notesService.getEntries(params.stockCode)
      const rangedEntries = filterByRange(entries, params.startDate, params.endDate)
        .filter((entry) => reviewCategories.has(entry.category))
        .filter((entry) => entry.operationTag === '买入' || entry.operationTag === '卖出')
      return rangedEntries.map((entry) => ({
        entryId: entry.id,
        stockCode: params.stockCode!,
        eventTime: this.toIsoString(entry.eventTime || entry.timestamp),
        operationTag: entry.operationTag as '买入' | '卖出',
        viewpointDirection: normalizeDirection(entry.viewpoint?.direction)
      }))
    }

    const timelineItems = await this.notesService.getTimeline({
      startDate: params.startDate,
      endDate: params.endDate
    })
    return timelineItems
      .filter((item) => reviewCategories.has(item.category))
      .filter((item) => item.operationTag === '买入' || item.operationTag === '卖出')
      .map((item) => ({
        entryId: item.id,
        stockCode: item.stockCode,
        eventTime: this.toIsoString(item.timestamp),
        operationTag: item.operationTag as '买入' | '卖出',
        viewpointDirection: normalizeDirection(item.viewpoint?.direction)
      }))
  }

  private async getReviewEligibleCategories(): Promise<Set<string>> {
    const settings = await appConfigService.getAll()
    const configs = settings.notes.categoryConfigs || []
    const candidates = configs
      .filter((item) => item.enabled !== false && item.reviewEligible)
      .map((item) => item.code)
      .filter(Boolean)
    if (candidates.length > 0) {
      return new Set(candidates)
    }
    return new Set(['看盘预测'])
  }

  private toIsoString(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString()
    }
    return date.toISOString()
  }

  private parseDate(input?: string): Date | undefined {
    if (!input) return undefined
    const parsed = new Date(input)
    if (Number.isNaN(parsed.getTime())) return undefined
    return parsed
  }

  private normalizeInterval(input?: KlineInterval): KlineInterval {
    if (!input) return '5m'
    if (input === '5m' || input === '15m' || input === '30m' || input === '1d') {
      return input
    }
    return '5m'
  }

  private normalizeRule(rule?: Partial<ReviewRuleConfig>): ReviewRuleConfig {
    return {
      windowDays: rule?.windowDays ?? DEFAULT_REVIEW_RULE.windowDays,
      thresholdPct: rule?.thresholdPct ?? DEFAULT_REVIEW_RULE.thresholdPct,
      excludeUnknown: rule?.excludeUnknown ?? DEFAULT_REVIEW_RULE.excludeUnknown
    }
  }
}
