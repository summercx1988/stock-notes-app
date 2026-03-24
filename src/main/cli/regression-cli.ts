import fs from 'fs/promises'
import path from 'path'
import { AIProcessor } from '../services/ai-processor'
import { NotesService } from '../services/notes'
import { NotesAppService } from '../application/notes-app-service'
import type { KlineInterval, MarketCandle, NoteCategory, Viewpoint } from '../../shared/types'

interface RegressionCase {
  id: string
  text: string
  expectedStockCode?: string
  expectedViewpoint?: '看多' | '看空' | '震荡' | '未知'
  category?: NoteCategory
  eventTime?: string
}

interface RegressionResult {
  id: string
  passed: boolean
  reason?: string
}

interface SavedEntryMeta {
  id: string
  stockCode: string
  category: NoteCategory
  eventTime: string
}

class MockMarketDataService {
  async getCandles(stockCode: string, interval: KlineInterval, start: Date, end: Date): Promise<MarketCandle[]> {
    const stepMs = intervalToMs(interval)
    const trend = Number(stockCode.slice(-1)) % 2 === 0 ? 1 : -1
    const basePrice = 80 + Number(stockCode.slice(-2))
    const startMs = start.getTime()
    const endMs = end.getTime()
    const candles: MarketCandle[] = []

    for (let cursor = startMs; cursor <= endMs; cursor += stepMs) {
      const elapsedDays = (cursor - startMs) / (24 * 60 * 60 * 1000)
      const close = Math.max(1, basePrice * (1 + trend * elapsedDays * 0.012))
      candles.push({
        stockCode,
        timestamp: new Date(cursor).toISOString(),
        open: round(close * 0.997, 4),
        high: round(close * 1.003, 4),
        low: round(close * 0.994, 4),
        close: round(close, 4),
        volume: 10000
      })
    }

    return candles
  }
}

function intervalToMs(interval: KlineInterval): number {
  if (interval === '5m') return 5 * 60 * 1000
  if (interval === '15m') return 15 * 60 * 1000
  if (interval === '30m') return 30 * 60 * 1000
  return 24 * 60 * 60 * 1000
}

function normalizeSentiment(value?: string): '看多' | '看空' | '震荡' | '未知' {
  if (!value) return '未知'
  if (value.includes('看多') || value.includes('多')) return '看多'
  if (value.includes('看空') || value.includes('空')) return '看空'
  if (value.includes('震荡') || value.includes('中性') || value.includes('横盘')) return '震荡'
  return '未知'
}

function toViewpointDirection(sentiment: '看多' | '看空' | '震荡' | '未知'): Viewpoint['direction'] {
  if (sentiment === '震荡') return '中性'
  return sentiment
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function loadCases(): Promise<RegressionCase[]> {
  const filePath = path.join(process.cwd(), 'docs', 'regression-cases.json')
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content) as RegressionCase[]
}

async function run(): Promise<void> {
  const useRealAI = process.argv.includes('--use-real-ai')
  const keepData = process.argv.includes('--keep-data')
  const cases = await loadCases()

  if (cases.length < 20) {
    throw new Error(`regression cases must be >= 20, current: ${cases.length}`)
  }

  const tmpRoot = await fs.mkdtemp(path.join(process.cwd(), 'data', 'regression-run-'))
  const notesDir = path.join(tmpRoot, 'stocks')
  await fs.mkdir(notesDir, { recursive: true })

  const processor = new AIProcessor()
  const notesService = new NotesService(notesDir)
  const notesAppService = new NotesAppService(notesService, new MockMarketDataService() as any)
  const originalFetch = global.fetch

  if (!useRealAI) {
    ;(global as any).fetch = async () => {
      throw new Error('REGRESSION_FETCH_BLOCKED')
    }
  }

  const results: RegressionResult[] = []
  const savedEntries: SavedEntryMeta[] = []
  const baseEventTime = Date.now() - (cases.length * 2 * 60 * 60 * 1000)

  try {
    for (let i = 0; i < cases.length; i += 1) {
      const testCase = cases[i]
      const extraction = await processor.extract(testCase.text)
      const predictedStockCode = extraction.stock?.code
      const predictedViewpoint = normalizeSentiment(extraction.note.sentiment)

      if (testCase.expectedStockCode && predictedStockCode !== testCase.expectedStockCode) {
        results.push({
          id: testCase.id,
          passed: false,
          reason: `stock mismatch, expected ${testCase.expectedStockCode}, got ${predictedStockCode || 'none'}`
        })
        continue
      }

      if (testCase.expectedViewpoint && predictedViewpoint !== testCase.expectedViewpoint) {
        results.push({
          id: testCase.id,
          passed: false,
          reason: `viewpoint mismatch, expected ${testCase.expectedViewpoint}, got ${predictedViewpoint}`
        })
        continue
      }

      const stockCode = predictedStockCode || testCase.expectedStockCode
      if (!stockCode) {
        results.push({
          id: testCase.id,
          passed: false,
          reason: 'stock not resolved'
        })
        continue
      }

      const sentiment = testCase.expectedViewpoint || predictedViewpoint
      const direction = toViewpointDirection(sentiment)
      const eventTime = testCase.eventTime || new Date(baseEventTime + i * 60 * 60 * 1000).toISOString()
      const entry = await notesService.addEntry(stockCode, {
        content: extraction.optimizedText || testCase.text,
        eventTime,
        category: testCase.category || '看盘预测',
        viewpoint: {
          direction,
          confidence: direction === '未知' ? 0 : 0.7,
          timeHorizon: '短线'
        },
        inputType: 'manual'
      })

      savedEntries.push({
        id: entry.id,
        stockCode,
        category: testCase.category || '看盘预测',
        eventTime
      })
      results.push({ id: testCase.id, passed: true })
    }

    const timeline = await notesService.getTimeline()
    const timelineCheck = timeline.length === savedEntries.length
    if (!timelineCheck) {
      results.push({
        id: 'TIMELINE',
        passed: false,
        reason: `timeline count mismatch, expected ${savedEntries.length}, got ${timeline.length}`
      })
    } else {
      results.push({ id: 'TIMELINE', passed: true })
    }

    const predictionEntries = savedEntries.filter((entry) => entry.category === '看盘预测')
    const minEventTime = savedEntries.reduce(
      (min, entry) => Math.min(min, new Date(entry.eventTime).getTime()),
      Number.MAX_SAFE_INTEGER
    )
    const maxEventTime = savedEntries.reduce(
      (max, entry) => Math.max(max, new Date(entry.eventTime).getTime()),
      0
    )
    const startDate = new Date(minEventTime - (24 * 60 * 60 * 1000)).toISOString()
    const endDate = new Date(maxEventTime + (4 * 24 * 60 * 60 * 1000)).toISOString()

    const overallEvaluation = await notesAppService.getReviewEvaluation({
      scope: 'overall',
      startDate,
      endDate,
      interval: '5m',
      rule: {
        windowDays: 3,
        thresholdPct: 3,
        excludeUnknown: true
      }
    })

    if (overallEvaluation.summary.totalNotes !== predictionEntries.length) {
      results.push({
        id: 'REVIEW_OVERALL',
        passed: false,
        reason: `review totalNotes mismatch, expected ${predictionEntries.length}, got ${overallEvaluation.summary.totalNotes}`
      })
    } else {
      results.push({ id: 'REVIEW_OVERALL', passed: true })
    }

    const firstPrediction = predictionEntries[0]
    if (firstPrediction) {
      const singleEvaluation = await notesAppService.getReviewEvaluation({
        scope: 'single',
        stockCode: firstPrediction.stockCode,
        startDate,
        endDate,
        interval: '5m',
        rule: {
          windowDays: 3,
          thresholdPct: 3,
          excludeUnknown: true
        }
      })

      if (singleEvaluation.scope !== 'single' || singleEvaluation.stockCode !== firstPrediction.stockCode) {
        results.push({
          id: 'REVIEW_SINGLE',
          passed: false,
          reason: 'single review scope validation failed'
        })
      } else {
        results.push({ id: 'REVIEW_SINGLE', passed: true })
      }
    }

    const failed = results.filter((item) => !item.passed)
    const summary = {
      total_cases: cases.length,
      checks: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      notes_dir: notesDir,
      use_real_ai: useRealAI,
      failed_items: failed
    }

    console.log(JSON.stringify(summary, null, 2))
    if (failed.length > 0) {
      process.exitCode = 1
    }
  } finally {
    if (!useRealAI && originalFetch) {
      ;(global as any).fetch = originalFetch
    }

    if (!keepData) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  }
}

run().catch((error) => {
  console.error('[regression-cli] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
