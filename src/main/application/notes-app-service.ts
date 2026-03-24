import { NotesService } from '../services/notes'
import { buildReviewSnapshot, filterByRange, normalizeDirection } from '../core/review-snapshot'
import type {
  Action,
  KlineInterval,
  NoteInputType,
  ReviewSnapshotRequest,
  ReviewSnapshotResponse,
  StockNote,
  TimeEntry,
  TimelineItem,
  Viewpoint
} from '../../shared/types'

interface AddEntryPayload {
  content: string
  eventTime?: Date | string
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
}

export class NotesAppService {
  constructor(private readonly notesService: NotesService) {}

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
}
