import type { ReviewSnapshot, ViewpointDirection } from '../../shared/types'

export interface DirectionCarrier {
  direction?: ViewpointDirection
}

export interface TimeCarrier {
  eventTime?: Date | string
  timestamp?: Date | string
}

export function normalizeDirection(direction?: ViewpointDirection): '看多' | '看空' | '未知' {
  if (direction === '看多') return '看多'
  if (direction === '看空') return '看空'
  return '未知'
}

export function buildReviewSnapshot(items: DirectionCarrier[]): ReviewSnapshot {
  const total = items.length
  let bullish = 0
  let bearish = 0
  let unknown = 0

  for (const item of items) {
    const normalized = normalizeDirection(item.direction)
    if (normalized === '看多') bullish += 1
    else if (normalized === '看空') bearish += 1
    else unknown += 1
  }

  return {
    total,
    bullish,
    bearish,
    unknown,
    actionable: bullish + bearish
  }
}

export function filterByRange<T extends TimeCarrier>(items: T[], startDate?: Date, endDate?: Date): T[] {
  if (!startDate && !endDate) return items

  return items.filter((item) => {
    const reference = item.eventTime ?? item.timestamp
    if (!reference) return false

    const date = reference instanceof Date ? reference : new Date(reference)
    if (Number.isNaN(date.getTime())) return false
    if (startDate && date < startDate) return false
    if (endDate && date > endDate) return false
    return true
  })
}
