import { NotesService } from '../services/notes'
import { MarketDataService } from '../services/market-data'
import { evaluateReviewEvents } from '../core/review-evaluator'
import { buildReviewSnapshot, filterByRange, normalizeDirection } from '../core/review-snapshot'
import { createTraceId, logPipelineEvent } from '../services/pipeline-logger'
import type {
  Action,
  NoteCategory,
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
  Viewpoint
} from '../../shared/types'

interface AddEntryPayload {
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

  async getReviewSnapshot(request: ReviewSnapshotRequest): Promise<ReviewSnapshotResponse> {
    const startDate = this.parseDate(request.startDate)
    const endDate = this.parseDate(request.endDate)
    const interval = this.normalizeInterval(request.interval)

    if (request.scope === 'single') {
      if (!request.stockCode) {
        throw new Error('single scope requires stockCode')
      }
      const entries = await this.notesService.getEntries(request.stockCode)
      const rangedEntries = filterByRange(entries, startDate, endDate)
        .filter((entry) => entry.category === '看盘预测')
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
      endDate,
      category: '看盘预测'
    })
    const snapshot = buildReviewSnapshot(
      timelineItems.map((item) => ({ direction: normalizeDirection(item.viewpoint?.direction) }))
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

      const actionableEvents = events.filter((event) => event.direction === '看多' || event.direction === '看空')
      const candlesByStock: Record<string, { timestamp: string; close: number }[]> = {}
      const eventsByStock = new Map<string, typeof actionableEvents>()

      for (const event of actionableEvents) {
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
      logPipelineEvent({
        traceId,
        stage: 'review',
        status: 'success',
        stockCode: request.stockCode,
        durationMs: Date.now() - startedAt,
        extra: {
          total_notes: evaluation.summary.totalNotes,
          evaluated_samples: evaluation.summary.evaluatedSamples
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
    if (params.scope === 'single') {
      if (!params.stockCode) {
        throw new Error('single scope requires stockCode')
      }
      const entries = await this.notesService.getEntries(params.stockCode)
      const rangedEntries = filterByRange(entries, params.startDate, params.endDate)
        .filter((entry) => entry.category === '看盘预测')
      return rangedEntries.map((entry) => ({
        entryId: entry.id,
        stockCode: params.stockCode!,
        eventTime: this.toIsoString(entry.eventTime || entry.timestamp),
        direction: normalizeDirection(entry.viewpoint?.direction)
      }))
    }

    const timelineItems = await this.notesService.getTimeline({
      startDate: params.startDate,
      endDate: params.endDate,
      category: '看盘预测'
    })
    return timelineItems.map((item) => ({
      entryId: item.id,
      stockCode: item.stockCode,
      eventTime: this.toIsoString(item.timestamp),
      direction: normalizeDirection(item.viewpoint?.direction)
    }))
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
