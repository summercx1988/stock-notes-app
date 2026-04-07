import type {
  ReviewActionResult,
  ReviewDailyActionDetailItem,
  ReviewDailyQualityItem,
  ReviewEventResult
} from '../../shared/types'

export interface ReviewDailyQualityActionEvent {
  stockCode: string
  eventTime: string
  operationTag: '买入' | '卖出'
  viewpointDirection: '看多' | '看空' | '未知'
}

interface DailyBucket {
  date: string
  stocks: Set<string>
  predictionSamples: number
  predictionHits: number
  buySamples: number
  buyHits: number
  sellSamples: number
  sellHits: number
  actionSamples: number
  actionHits: number
  actionEventsTotal: number
  viewpointLinkedActions: number
  alignedActions: number
  buyActions: number
  sellActions: number
  actionDetails: ReviewDailyActionDetailItem[]
}

const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

export function buildReviewDailyQuality(
  predictionResults: ReviewEventResult[],
  actionResults: ReviewActionResult[],
  actionEvents: ReviewDailyQualityActionEvent[]
): ReviewDailyQualityItem[] {
  const buckets = new Map<string, DailyBucket>()

  const ensureBucket = (eventTime: string): DailyBucket => {
    const date = toShanghaiDate(eventTime)
    const existing = buckets.get(date)
    if (existing) return existing
    const created: DailyBucket = {
      date,
      stocks: new Set<string>(),
      predictionSamples: 0,
      predictionHits: 0,
      buySamples: 0,
      buyHits: 0,
      sellSamples: 0,
      sellHits: 0,
      actionSamples: 0,
      actionHits: 0,
      actionEventsTotal: 0,
      viewpointLinkedActions: 0,
      alignedActions: 0,
      buyActions: 0,
      sellActions: 0,
      actionDetails: []
    }
    buckets.set(date, created)
    return created
  }

  for (const item of predictionResults) {
    const bucket = ensureBucket(item.eventTime)
    bucket.stocks.add(item.stockCode)
    bucket.predictionSamples += 1
    if (item.hit) {
      bucket.predictionHits += 1
    }
  }

  for (const item of actionResults) {
    const bucket = ensureBucket(item.eventTime)
    bucket.stocks.add(item.stockCode)
    bucket.actionSamples += 1
    if (item.hit) {
      bucket.actionHits += 1
    }
    if (item.operationTag === '买入') {
      bucket.buyActions += 1
      bucket.buySamples += 1
      if (item.hit) {
        bucket.buyHits += 1
      }
    } else {
      bucket.sellActions += 1
      bucket.sellSamples += 1
      if (item.hit) {
        bucket.sellHits += 1
      }
    }
    bucket.actionDetails.push({
      entryId: item.entryId,
      stockCode: item.stockCode,
      eventTime: item.eventTime,
      operationTag: item.operationTag,
      viewpointDirection: item.viewpointDirection,
      alignedWithViewpoint: resolveAligned(item.operationTag, item.viewpointDirection),
      hit: item.hit,
      changePct: item.changePct,
      reason: item.reason
    })
  }

  for (const event of actionEvents) {
    const bucket = ensureBucket(event.eventTime)
    bucket.stocks.add(event.stockCode)
    bucket.actionEventsTotal += 1
    if (event.viewpointDirection === '未知') {
      continue
    }
    bucket.viewpointLinkedActions += 1
    if (resolveAligned(event.operationTag, event.viewpointDirection) === true) {
      bucket.alignedActions += 1
    }
  }

  return Array.from(buckets.values())
    .filter((bucket) => bucket.predictionSamples > 0)
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      stocksCount: bucket.stocks.size,
      predictionSamples: bucket.predictionSamples,
      predictionHits: bucket.predictionHits,
      predictionAccuracy: computeAccuracy(bucket.predictionHits, bucket.predictionSamples),
      buySamples: bucket.buySamples,
      buyHits: bucket.buyHits,
      buyAccuracy: computeAccuracy(bucket.buyHits, bucket.buySamples),
      sellSamples: bucket.sellSamples,
      sellHits: bucket.sellHits,
      sellAccuracy: computeAccuracy(bucket.sellHits, bucket.sellSamples),
      actionSamples: bucket.actionSamples,
      actionHits: bucket.actionHits,
      actionAccuracy: computeAccuracy(bucket.actionHits, bucket.actionSamples),
      actionInsufficientData: Math.max(0, bucket.actionEventsTotal - bucket.actionSamples),
      viewpointLinkedActions: bucket.viewpointLinkedActions,
      alignedActions: bucket.alignedActions,
      alignmentRate: computeAccuracy(bucket.alignedActions, bucket.viewpointLinkedActions),
      buyActions: bucket.buyActions,
      sellActions: bucket.sellActions,
      actionDetails: bucket.actionDetails.sort((left, right) => (
        new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime()
      ))
    }))
}

function toShanghaiDate(input: string): string {
  const parsed = new Date(input)
  const date = Number.isFinite(parsed.getTime()) ? parsed : new Date()
  const parts = DAY_FORMATTER.formatToParts(date)
  let year = '1970'
  let month = '01'
  let day = '01'
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    if (part.type === 'month') month = part.value
    if (part.type === 'day') day = part.value
  }
  return `${year}-${month}-${day}`
}

function resolveAligned(
  operationTag: '买入' | '卖出',
  viewpointDirection: '看多' | '看空' | '未知'
): boolean | null {
  if (viewpointDirection === '未知') {
    return null
  }
  return (
    (operationTag === '买入' && viewpointDirection === '看多') ||
    (operationTag === '卖出' && viewpointDirection === '看空')
  )
}

function computeAccuracy(hits: number, samples: number): number {
  if (samples <= 0) return 0
  return round((hits / samples) * 100, 4)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
