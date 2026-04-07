import type {
  ReviewActionResult,
  ReviewActionSummary,
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

export interface ReviewActionInput {
  entryId: string
  stockCode: string
  eventTime: string
  operationTag: '买入' | '卖出'
  viewpointDirection: '看多' | '看空' | '未知'
}

export interface ReviewActionEvaluationResult {
  summary: ReviewActionSummary
  results: ReviewActionResult[]
}

interface PreparedCandleSeries {
  candles: CandleInput[]
  timestamps: number[]
}

export function evaluateReviewEvents(
  events: ReviewEventInput[],
  candlesByStock: Record<string, CandleInput[]>,
  rule: ReviewRuleConfig
): ReviewEvaluationResult {
  const preparedByStock = prepareCandlesByStock(candlesByStock)
  const actionable = events.filter(
    (event): event is ReviewEventInput & { direction: '看多' | '看空' } =>
      event.direction === '看多' || event.direction === '看空'
  )
  const unknownNotes = events.length - actionable.length
  const results: ReviewEventResult[] = []

  for (const event of actionable) {
    const series = preparedByStock[event.stockCode]
    if (!series || series.candles.length === 0) continue

    const eventMs = toMs(event.eventTime)
    if (!Number.isFinite(eventMs)) continue

    const entryIndex = lowerBound(series.timestamps, eventMs)
    if (entryIndex >= series.candles.length) continue

    const entryCandle = series.candles[entryIndex]
    if (entryCandle.close <= 0) continue

    const targetMs = eventMs + (rule.windowDays * 24 * 60 * 60 * 1000)
    const targetIndex = upperBound(series.timestamps, targetMs) - 1
    if (targetIndex <= entryIndex) continue

    const targetCandle = series.candles[targetIndex]
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

export function evaluateActionEvents(
  events: ReviewActionInput[],
  candlesByStock: Record<string, CandleInput[]>,
  rule: ReviewRuleConfig
): ReviewActionEvaluationResult {
  const preparedByStock = prepareCandlesByStock(candlesByStock)
  const results: ReviewActionResult[] = []

  for (const event of events) {
    const series = preparedByStock[event.stockCode]
    if (!series || series.candles.length === 0) continue

    const eventMs = toMs(event.eventTime)
    if (!Number.isFinite(eventMs)) continue

    const entryIndex = lowerBound(series.timestamps, eventMs)
    if (entryIndex >= series.candles.length) continue

    const entryCandle = series.candles[entryIndex]
    if (entryCandle.close <= 0) continue

    const targetMs = eventMs + (rule.windowDays * 24 * 60 * 60 * 1000)
    const targetIndex = upperBound(series.timestamps, targetMs) - 1
    if (targetIndex <= entryIndex) continue

    const targetCandle = series.candles[targetIndex]
    const change = (targetCandle.close - entryCandle.close) / entryCandle.close
    const hit = event.operationTag === '买入'
      ? change >= (rule.thresholdPct / 100)
      : change <= -(rule.thresholdPct / 100)

    results.push({
      entryId: event.entryId,
      stockCode: event.stockCode,
      eventTime: event.eventTime,
      operationTag: event.operationTag,
      viewpointDirection: event.viewpointDirection,
      entryPrice: round(entryCandle.close, 4),
      targetPrice: round(targetCandle.close, 4),
      changePct: round(change * 100, 4),
      hit,
      reason: hit
        ? `${event.operationTag}后在${rule.windowDays}天窗口内达到${rule.thresholdPct}%阈值`
        : `${event.operationTag}后在${rule.windowDays}天窗口内未达到${rule.thresholdPct}%阈值`
    })
  }

  const hits = results.filter((item) => item.hit).length
  const buyResults = results.filter((item) => item.operationTag === '买入')
  const sellResults = results.filter((item) => item.operationTag === '卖出')
  const alignedWithViewpoint = events.filter((event) => {
    if (event.viewpointDirection === '未知') return false
    return (
      (event.operationTag === '买入' && event.viewpointDirection === '看多') ||
      (event.operationTag === '卖出' && event.viewpointDirection === '看空')
    )
  }).length
  const viewpointLinkedActions = events.filter((event) => event.viewpointDirection !== '未知').length

  return {
    summary: {
      totalActions: events.length,
      buyActions: events.filter((event) => event.operationTag === '买入').length,
      sellActions: events.filter((event) => event.operationTag === '卖出').length,
      evaluatedSamples: results.length,
      insufficientData: Math.max(0, events.length - results.length),
      hits,
      accuracy: computeAccuracy(hits, results.length),
      buyAccuracy: computeAccuracy(buyResults.filter((item) => item.hit).length, buyResults.length),
      sellAccuracy: computeAccuracy(sellResults.filter((item) => item.hit).length, sellResults.length),
      alignedWithViewpoint,
      viewpointLinkedActions,
      alignmentRate: computeAccuracy(alignedWithViewpoint, viewpointLinkedActions)
    },
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

function prepareCandlesByStock(candlesByStock: Record<string, CandleInput[]>): Record<string, PreparedCandleSeries> {
  const prepared: Record<string, PreparedCandleSeries> = {}
  for (const [stockCode, sourceCandles] of Object.entries(candlesByStock)) {
    const candles = [...sourceCandles]
      .filter((candle) => Number.isFinite(candle.close))
      .sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp))
    prepared[stockCode] = {
      candles,
      timestamps: candles.map((item) => toMs(item.timestamp))
    }
  }
  return prepared
}

function lowerBound(values: number[], target: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const mid = left + Math.floor((right - left) / 2)
    if (values[mid] < target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function upperBound(values: number[], target: number): number {
  let left = 0
  let right = values.length
  while (left < right) {
    const mid = left + Math.floor((right - left) / 2)
    if (values[mid] <= target) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  return left
}

function toMs(value: string): number {
  const parsed = new Date(value)
  return parsed.getTime()
}
