import { NotesService } from '../services/notes'
import { MarketDataService } from '../services/market-data'
import { evaluateActionEvents, evaluateReviewEvents } from '../core/review-evaluator'
import { buildReviewSnapshot, filterByRange, normalizeDirection } from '../core/review-snapshot'
import { alignReviewMarkers, type ReviewVisualEventInput } from '../core/review-alignment'
import { createTraceId, logPipelineEvent } from '../services/pipeline-logger'
import { appConfigService } from '../services/app-config'
import { notifyNotesChanged } from '../services/notes-events'
import { reviewGenerationStateService } from '../services/review-generation-state'
import type {
  Action,
  NoteCategory,
  OperationTag,
  TrackingStatus,
  KlineInterval,
  NoteInputType,
  ReviewEvaluateRequest,
  ReviewEvaluateResponse,
  ReviewRuleConfig,
  ReviewSnapshotRequest,
  ReviewSnapshotResponse,
  ReviewVisualRequest,
  ReviewVisualResponse,
  StockNote,
  TimeEntry,
  TimelineItem,
  TimelineExplorerFilters,
  TimelineExplorerResponse,
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
  trackingStatus?: TrackingStatus
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
const OVERALL_BENCHMARK_STOCK_CODE = 'SH000001'

export class NotesAppService {
  constructor(
    private readonly notesService: NotesService,
    private readonly marketDataService: MarketDataService
  ) {}

  async addEntry(stockCode: string, data: AddEntryPayload): Promise<TimeEntry> {
    const entry = await this.notesService.addEntry(stockCode, data)
    notifyNotesChanged({
      stockCode,
      entryId: entry.id,
      action: 'created',
      source: 'local'
    })
    return entry
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

  async updateEntry(stockCode: string, entryId: string, data: Partial<TimeEntry>): Promise<TimeEntry> {
    const entry = await this.notesService.updateEntry(stockCode, entryId, data)
    notifyNotesChanged({
      stockCode,
      entryId,
      action: 'updated',
      source: 'local'
    })
    return entry
  }

  async deleteEntry(stockCode: string, entryId: string): Promise<void> {
    await this.notesService.deleteEntry(stockCode, entryId)
    notifyNotesChanged({
      stockCode,
      entryId,
      action: 'deleted',
      source: 'local'
    })
  }

  getTimeline(filters?: TimelineFilters): Promise<TimelineItem[]> {
    return this.notesService.getTimeline(filters)
  }

  getTimelineExplorer(filters?: TimelineExplorerFilters): Promise<TimelineExplorerResponse> {
    return this.notesService.getTimelineExplorer(filters)
  }

  async updateLatestTrackingStatus(stockCode: string, trackingStatus?: TrackingStatus): Promise<TimeEntry> {
    const entry = await this.notesService.updateLatestTrackingStatus(stockCode, trackingStatus)
    notifyNotesChanged({
      stockCode,
      entryId: entry.id,
      action: 'updated',
      source: 'local'
    })
    return entry
  }

  exportStockNote(stockCode: string, outputDir: string): Promise<NotesExportResult> {
    return this.notesService.exportStockNote(stockCode, outputDir)
  }

  exportAllNotes(outputDir: string): Promise<NotesExportResult> {
    return this.notesService.exportAllNotes(outputDir)
  }

  async importNotesFromDirectory(sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> {
    const result = await this.notesService.importNotesFromDirectory(sourceDir, mode)
    if (result.imported > 0) {
      await reviewGenerationStateService.markNotesUpdated()
    }
    return result
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

  async getReviewVisualData(request: ReviewVisualRequest): Promise<ReviewVisualResponse> {
    const startDate = this.parseDate(request.startDate)
    const endDate = this.parseDate(request.endDate)
    const interval = this.normalizeInterval(request.interval)
    const reviewCategories = await this.getReviewEligibleCategories()
    const includeCategories = (request.includeCategories || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    const activeCategories = includeCategories.length > 0
      ? new Set(includeCategories.filter((item) => reviewCategories.has(item)))
      : reviewCategories
    const categories = activeCategories.size > 0 ? activeCategories : reviewCategories

    const scope = request.scope || 'single'
    const visualStockCode = this.resolveVisualStockCode(scope, request.stockCode)
    const events = await this.collectReviewVisualEvents({
      scope,
      stockCode: request.stockCode,
      startDate,
      endDate,
      categories
    })

    const eventTimes = events
      .map((item) => new Date(item.eventTime).getTime())
      .filter((value) => Number.isFinite(value))
    const minEventMs = eventTimes.length > 0 ? Math.min(...eventTimes) : Date.now() - (7 * 24 * 60 * 60 * 1000)
    const maxEventMs = eventTimes.length > 0 ? Math.max(...eventTimes) : Date.now()
    const requestedStart = startDate ? startDate.getTime() : minEventMs
    const requestedEnd = endDate ? endDate.getTime() : maxEventMs

    const fetchStart = new Date(Math.min(requestedStart, minEventMs) - (24 * 60 * 60 * 1000))
    const fetchEnd = new Date(Math.max(requestedEnd, maxEventMs) + (24 * 60 * 60 * 1000))
    const candles = await this.marketDataService.getCandles(visualStockCode, interval, fetchStart, fetchEnd)
    const aligned = alignReviewMarkers(candles, events)

    return {
      scope,
      stockCode: visualStockCode,
      startDate: request.startDate || new Date(requestedStart).toISOString(),
      endDate: request.endDate || new Date(requestedEnd).toISOString(),
      interval,
      candles,
      markers: aligned.markers,
      clusters: aligned.clusters,
      stats: aligned.stats,
      generatedAt: new Date().toISOString()
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

  private async collectReviewVisualEvents(params: {
    scope: 'single' | 'overall'
    stockCode?: string
    startDate?: Date
    endDate?: Date
    categories: Set<string>
  }): Promise<ReviewVisualEventInput[]> {
    if (params.scope === 'single') {
      if (!params.stockCode) {
        throw new Error('single scope requires stockCode')
      }
      const entries = await this.notesService.getEntries(params.stockCode)
      return filterByRange(entries, params.startDate, params.endDate)
        .filter((entry) => params.categories.has(entry.category))
        .map((entry) => ({
          entryId: entry.id,
          stockCode: params.stockCode!,
          eventTime: this.toIsoString(entry.eventTime || entry.timestamp),
          direction: this.normalizeVisualDirection(entry.viewpoint?.direction),
          category: entry.category
        }))
    }

    const timelineItems = await this.notesService.getTimeline({
      startDate: params.startDate,
      endDate: params.endDate
    })
    return timelineItems
      .filter((item) => params.categories.has(item.category))
      .map((item) => ({
        entryId: item.id,
        stockCode: item.stockCode,
        eventTime: this.toIsoString(item.timestamp),
        direction: this.normalizeVisualDirection(item.viewpoint?.direction),
        category: item.category
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
    if (input === '5m' || input === '15m' || input === '30m' || input === '60m' || input === '1d') {
      return input
    }
    return '5m'
  }

  private normalizeVisualDirection(direction?: string): '看多' | '看空' | '震荡' | '未知' {
    if (direction === '看多') return '看多'
    if (direction === '看空') return '看空'
    if (direction === '中性' || direction === '震荡') return '震荡'
    return '未知'
  }

  private resolveVisualStockCode(scope: 'single' | 'overall', stockCode?: string): string {
    if (scope === 'single') {
      if (!stockCode) {
        throw new Error('single scope requires stockCode')
      }
      return stockCode
    }
    return stockCode || OVERALL_BENCHMARK_STOCK_CODE
  }

  private normalizeRule(rule?: Partial<ReviewRuleConfig>): ReviewRuleConfig {
    return {
      windowDays: rule?.windowDays ?? DEFAULT_REVIEW_RULE.windowDays,
      thresholdPct: rule?.thresholdPct ?? DEFAULT_REVIEW_RULE.thresholdPct,
      excludeUnknown: rule?.excludeUnknown ?? DEFAULT_REVIEW_RULE.excludeUnknown
    }
  }
}
