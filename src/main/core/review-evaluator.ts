import type {
  ReviewDirectionStats,
  ReviewEvaluateSummary,
  ReviewEventResult,
  ReviewRuleConfig
} from '../../shared/types'

export interface ReviewEventInput {
  entryId: string
  stockCode: string
  eventTime: string
  direction: '看多' | '看空' | '未知'
}

export interface CandleInput {
  timestamp: string
  close: number
}

export interface ReviewEvaluationResult {
  summary: ReviewEvaluateSummary
  results: ReviewEventResult[]
}

export function evaluateReviewEvents(
  events: ReviewEventInput[],
  candlesByStock: Record<string, CandleInput[]>,
  rule: ReviewRuleConfig
): ReviewEvaluationResult {
  const actionable = events.filter(
    (event): event is ReviewEventInput & { direction: '看多' | '看空' } =>
      event.direction === '看多' || event.direction === '看空'
  )
  const unknownNotes = events.length - actionable.length
  const results: ReviewEventResult[] = []

  for (const event of actionable) {
    const stockCandles = [...(candlesByStock[event.stockCode] || [])]
      .filter((candle) => Number.isFinite(candle.close))
      .sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp))
    if (stockCandles.length === 0) continue

    const eventMs = toMs(event.eventTime)
    if (!Number.isFinite(eventMs)) continue

    const entryIndex = stockCandles.findIndex((candle) => toMs(candle.timestamp) >= eventMs)
    if (entryIndex < 0) continue

    const entryCandle = stockCandles[entryIndex]
    if (entryCandle.close <= 0) continue

    const targetMs = eventMs + (rule.windowDays * 24 * 60 * 60 * 1000)
    let targetIndex = -1
    for (let i = entryIndex; i < stockCandles.length; i += 1) {
      const candleMs = toMs(stockCandles[i].timestamp)
      if (candleMs <= targetMs) {
        targetIndex = i
      } else {
        break
      }
    }
    if (targetIndex <= entryIndex) continue

    const targetCandle = stockCandles[targetIndex]
    const change = (targetCandle.close - entryCandle.close) / entryCandle.close
    const hit = event.direction === '看多'
      ? change >= (rule.thresholdPct / 100)
      : change <= -(rule.thresholdPct / 100)

    results.push({
      entryId: event.entryId,
      stockCode: event.stockCode,
      eventTime: event.eventTime,
      direction: event.direction,
      entryPrice: round(entryCandle.close, 4),
      targetPrice: round(targetCandle.close, 4),
      changePct: round(change * 100, 4),
      hit,
      reason: hit
        ? `在${rule.windowDays}天窗口内达到${rule.thresholdPct}%阈值`
        : `在${rule.windowDays}天窗口内未达到${rule.thresholdPct}%阈值`
    })
  }

  const bullishResults = results.filter((item) => item.direction === '看多')
  const bearishResults = results.filter((item) => item.direction === '看空')
  const hits = results.filter((item) => item.hit).length

  const summary: ReviewEvaluateSummary = {
    totalNotes: events.length,
    unknownNotes,
    actionableNotes: actionable.length,
    evaluatedSamples: results.length,
    insufficientData: Math.max(0, actionable.length - results.length),
    hits,
    accuracy: computeAccuracy(hits, results.length),
    bullish: buildDirectionStats(bullishResults),
    bearish: buildDirectionStats(bearishResults)
  }

  return {
    summary,
    results: results.sort((left, right) => toMs(right.eventTime) - toMs(left.eventTime))
  }
}

function buildDirectionStats(results: ReviewEventResult[]): ReviewDirectionStats {
  const hits = results.filter((item) => item.hit).length
  return {
    samples: results.length,
    hits,
    accuracy: computeAccuracy(hits, results.length)
  }
}

function computeAccuracy(hits: number, samples: number): number {
  if (samples <= 0) return 0
  return round((hits / samples) * 100, 4)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toMs(value: string): number {
  const parsed = new Date(value)
  return parsed.getTime()
}
