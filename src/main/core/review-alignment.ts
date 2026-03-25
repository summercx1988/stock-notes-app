import type {
  MarketCandle,
  NoteCategory,
  ReviewMarker,
  ReviewMarkerCluster,
  ReviewMarkerDirection,
  ReviewVisualStats
} from '../../shared/types'

export interface ReviewVisualEventInput {
  entryId: string
  stockCode: string
  eventTime: string
  direction: ReviewMarkerDirection
  category: NoteCategory
}

export interface ReviewVisualAlignmentResult {
  markers: ReviewMarker[]
  clusters: ReviewMarkerCluster[]
  stats: ReviewVisualStats
}

export function alignReviewMarkers(
  candles: MarketCandle[],
  events: ReviewVisualEventInput[]
): ReviewVisualAlignmentResult {
  const sortedCandles = [...candles]
    .filter((item) => Number.isFinite(toMs(item.timestamp)))
    .sort((left, right) => toMs(left.timestamp) - toMs(right.timestamp))
  const candleTimes = sortedCandles.map((item) => toMs(item.timestamp))

  const markers: ReviewMarker[] = []
  const clusterMap = new Map<string, ReviewMarkerCluster>()

  for (const event of events) {
    const eventMs = toMs(event.eventTime)
    const marker: ReviewMarker = {
      entryId: event.entryId,
      stockCode: event.stockCode,
      eventTime: event.eventTime,
      direction: event.direction,
      category: event.category,
      outOfRange: true
    }

    if (Number.isFinite(eventMs) && sortedCandles.length > 0) {
      const alignedIndex = lowerBound(candleTimes, eventMs)
      if (alignedIndex >= 0) {
        const alignedCandle = sortedCandles[alignedIndex]
        marker.alignedCandleTime = alignedCandle.timestamp
        marker.outOfRange = false

        const existing = clusterMap.get(alignedCandle.timestamp) || {
          candleTime: alignedCandle.timestamp,
          count: 0,
          bullish: 0,
          bearish: 0,
          neutral: 0,
          unknown: 0,
          markerEntryIds: []
        }
        existing.count += 1
        bumpDirection(existing, marker.direction)
        existing.markerEntryIds.push(marker.entryId)
        clusterMap.set(alignedCandle.timestamp, existing)
      }
    }

    markers.push(marker)
  }

  const clusters = Array.from(clusterMap.values()).sort((left, right) => toMs(left.candleTime) - toMs(right.candleTime))
  const outOfRangeMarkers = markers.filter((item) => item.outOfRange).length
  const stats: ReviewVisualStats = {
    totalMarkers: markers.length,
    clusteredCandles: clusters.filter((item) => item.count > 1).length,
    maxClusterSize: clusters.reduce((max, item) => Math.max(max, item.count), 0),
    outOfRangeMarkers
  }

  markers.sort((left, right) => {
    if (left.outOfRange !== right.outOfRange) {
      return left.outOfRange ? 1 : -1
    }
    const leftAlignedMs = left.alignedCandleTime ? toMs(left.alignedCandleTime) : Number.POSITIVE_INFINITY
    const rightAlignedMs = right.alignedCandleTime ? toMs(right.alignedCandleTime) : Number.POSITIVE_INFINITY
    if (leftAlignedMs !== rightAlignedMs) return leftAlignedMs - rightAlignedMs
    return toMs(left.eventTime) - toMs(right.eventTime)
  })

  return {
    markers,
    clusters,
    stats
  }
}

function bumpDirection(cluster: ReviewMarkerCluster, direction: ReviewMarkerDirection): void {
  if (direction === '看多') {
    cluster.bullish += 1
    return
  }
  if (direction === '看空') {
    cluster.bearish += 1
    return
  }
  if (direction === '中性') {
    cluster.neutral += 1
    return
  }
  cluster.unknown += 1
}

function lowerBound(sortedValues: number[], target: number): number {
  let low = 0
  let high = sortedValues.length - 1
  let answer = -1
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2)
    if (sortedValues[middle] >= target) {
      answer = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  return answer
}

function toMs(input: string): number {
  return new Date(input).getTime()
}

