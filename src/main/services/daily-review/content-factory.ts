import type {
  CollectedNotes,
  DailySummaryData,
  DecisionItem,
  PreMarketData,
  ReviewGenerationMeta
} from './types'

export const buildReviewMeta = (
  generationMode: ReviewGenerationMeta['generationMode'],
  aiStatus: ReviewGenerationMeta['aiStatus'],
  lookbackDays: number,
  note?: unknown
): ReviewGenerationMeta => ({
  generationMode,
  aiStatus,
  lookbackDays,
  note: note ? String(note instanceof Error ? note.message : note) : undefined
})

export const buildLocalDailySummary = (
  collected: CollectedNotes,
  lookbackDays: number
): DailySummaryData => {
  const targetDate = new Date(`${collected.date}T00:00:00`)
  const primaryEntries = collected.entries.filter((entry) => diffCalendarDays(targetDate, new Date(entry.eventTime)) <= 1)
  const trailingEntries = collected.entries.filter((entry) => diffCalendarDays(targetDate, new Date(entry.eventTime)) >= 2)

  const stockAggregates = new Map<string, {
    stockCode: string
    stockName: string
    primaryCount: number
    trailingCount: number
    buyCount: number
    sellCount: number
    bullishCount: number
    bearishCount: number
    latestEntry: CollectedNotes['entries'][number]
  }>()

  for (const entry of collected.entries) {
    const aggregate = stockAggregates.get(entry.stockCode) || {
      stockCode: entry.stockCode,
      stockName: entry.stockName,
      primaryCount: 0,
      trailingCount: 0,
      buyCount: 0,
      sellCount: 0,
      bullishCount: 0,
      bearishCount: 0,
      latestEntry: entry
    }
    const diffDays = diffCalendarDays(targetDate, new Date(entry.eventTime))
    if (diffDays <= 1) aggregate.primaryCount += 1
    else aggregate.trailingCount += 1
    if (entry.operationTag === '买入') aggregate.buyCount += 1
    if (entry.operationTag === '卖出') aggregate.sellCount += 1
    if (entry.viewpoint.direction === '看多') aggregate.bullishCount += 1
    if (entry.viewpoint.direction === '看空') aggregate.bearishCount += 1
    if (new Date(entry.eventTime).getTime() > new Date(aggregate.latestEntry.eventTime).getTime()) {
      aggregate.latestEntry = entry
    }
    stockAggregates.set(entry.stockCode, aggregate)
  }

  const rankedStocks = [...stockAggregates.values()].sort((left, right) => {
    const leftScore = left.primaryCount * 10 + left.buyCount + left.sellCount
    const rightScore = right.primaryCount * 10 + right.buyCount + right.sellCount
    if (rightScore !== leftScore) return rightScore - leftScore
    return new Date(right.latestEntry.eventTime).getTime() - new Date(left.latestEntry.eventTime).getTime()
  })

  const marketSentiment = inferMarketSentiment(collected)
  const focusStocks = rankedStocks.filter((item) => item.primaryCount > 0)
  const trailingStocks = rankedStocks.filter((item) => item.trailingCount > 0 && item.primaryCount === 0)

  const overviewParts = [
    `${collected.date} 共整理 ${collected.totalNotes} 条笔记，主体采用 T0/T-1 的 ${primaryEntries.length} 条近期记录，覆盖 ${collected.stocksCount} 只股票。`
  ]
  if (focusStocks.length > 0) {
    overviewParts.push(`近期关注集中在 ${focusStocks.slice(0, 3).map((item) => `${item.stockName}(${item.stockCode})`).join('、')}。`)
  }
  overviewParts.push(`近期操作记录中，买入 ${collected.stats.buyActions} 次、卖出 ${collected.stats.sellActions} 次，整体情绪偏${marketSentiment}。`)
  if (trailingEntries.length > 0) {
    const trailingText = trailingStocks.slice(0, 2).map((item) => `${item.stockName}(${item.stockCode})`).join('、')
    overviewParts.push(`T-2/T-3 的 ${trailingEntries.length} 条较早记录仅作为延续提醒${trailingText ? `，主要涉及 ${trailingText}` : ''}。`)
  }

  const keyDecisions = focusStocks.slice(0, 3).map((item) => {
    const action = item.buyCount > item.sellCount ? '买入' : item.sellCount > item.buyCount ? '卖出' : '观望'
    const confidence = Math.min(0.92, Math.max(0.55, 0.5 + item.primaryCount * 0.08 + item.latestEntry.viewpoint.confidence * 0.2))
    return {
      stockCode: item.stockCode,
      stockName: item.stockName,
      action,
      reason: makeReadableSentence(
        compactText(item.latestEntry.contentPreview, 52) || `T0/T-1 内有 ${item.primaryCount} 条新的跟踪记录`
      ),
      confidence,
      entryId: item.latestEntry.entryId
    } as DecisionItem
  })

  const riskAlerts = rankedStocks
    .filter((item) => item.bearishCount > 0 || item.sellCount > 0)
    .slice(0, 2)
    .map((item) => ({
      level: (item.bearishCount > 0 || item.sellCount > 1 ? 'high' : 'medium') as 'high' | 'medium',
      description: `${item.stockName}(${item.stockCode}) 近期出现${item.bearishCount > 0 ? '看空' : '减仓/卖出'}信号，需要复核。`,
      relatedStocks: [item.stockCode],
      suggestion: makeReadableSentence(
        compactText(item.latestEntry.contentPreview, 42) || '优先确认触发条件，再决定是否执行'
      )
    }))

  const tomorrowFocus = focusStocks.slice(0, 3).map((item) => ({
    stockCode: item.stockCode,
    stockName: item.stockName,
    reason: makeReadableSentence(
      compactText(item.latestEntry.contentPreview, 42) || `近期有 ${item.primaryCount} 条记录需要继续跟踪`
    ),
    actionType: (item.buyCount > 0 || item.sellCount > 0 ? 'execute' : 'monitor') as 'execute' | 'monitor',
    sourceEntryId: item.latestEntry.entryId
  }))

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    meta: buildReviewMeta('local', 'pending', lookbackDays),
    stats: collected.stats,
    content: {
      overview: overviewParts.join(' '),
      keyDecisions,
      riskAlerts,
      tomorrowFocus,
      marketSentiment
    },
    relatedEntries: collected.entries.map((entry) => ({
      entryId: entry.entryId,
      stockCode: entry.stockCode,
      stockName: entry.stockName,
      eventTime: entry.eventTime,
      category: entry.category,
      viewpoint: `${entry.viewpoint.direction} (${entry.viewpoint.confidence})`,
      preview: entry.contentPreview
    }))
  }
}

export const buildLocalPreMarket = (
  summaryData: DailySummaryData | null,
  sourceSummaryDate: string,
  lookbackDays: number
): PreMarketData => {
  if (!summaryData) {
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      sourceSummaryDate,
      meta: buildReviewMeta('local', 'fallback', lookbackDays, '未找到可用的昨日日志，保留本地提示'),
      quickReview: {
        yesterdaySummary: '昨日没有可用的每日复盘日志，今天以观察市场新变化为主。',
        pendingItems: [],
        keyLevels: []
      },
      todayStrategy: {
        focusAreas: ['先确认新增笔记与盘中触发条件'],
        watchlist: [],
        riskReminders: ['今日若无新信号，避免仅凭旧结论重复操作']
      }
    }
  }

  const pendingItems = summaryData.content.keyDecisions.slice(0, 3).map((decision) => ({
    stockCode: decision.stockCode,
    stockName: decision.stockName,
    description: makeReadableSentence(decision.reason || `${decision.action} 计划待验证`),
    priority: (
      decision.confidence >= 0.75
        ? 'high'
        : decision.confidence >= 0.6
          ? 'medium'
          : 'low'
    ) as 'high' | 'medium' | 'low',
    dueDate: sourceSummaryDate,
    sourceEntryId: decision.entryId
  }))

  const watchlist = summaryData.content.tomorrowFocus.slice(0, 3).map((item) => ({
    stockCode: item.stockCode,
    stockName: item.stockName,
    reason: makeReadableSentence(item.reason),
    expectedAction: item.actionType === 'execute' ? '关注触发条件，必要时执行' : '持续观察'
  }))

  const riskReminders = summaryData.content.riskAlerts.length > 0
    ? summaryData.content.riskAlerts.slice(0, 3).map((item) => makeReadableSentence(item.description))
    : ['若盘前没有新增确认信号，优先观察而非立即交易']

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    sourceSummaryDate,
    meta: buildReviewMeta('local', 'pending', lookbackDays),
    quickReview: {
      yesterdaySummary: makeReadableSentence(summaryData.content.overview),
      pendingItems,
      keyLevels: []
    },
    todayStrategy: {
      focusAreas: watchlist.length > 0
        ? [`优先围绕 ${watchlist.slice(0, 2).map((item) => item.stockName).join('、')} 观察触发条件`]
        : ['先等待更清晰的确认信号'],
      watchlist,
      riskReminders
    }
  }
}

export const mergeDailySummary = (
  localSummary: DailySummaryData,
  aiSummary: DailySummaryData,
  lookbackDays: number
): DailySummaryData => ({
  ...localSummary,
  ...aiSummary,
  generatedAt: new Date().toISOString(),
  meta: buildReviewMeta('hybrid', 'completed', lookbackDays),
  stats: localSummary.stats,
  relatedEntries: localSummary.relatedEntries,
  content: {
    overview: aiSummary.content.overview || localSummary.content.overview,
    keyDecisions: aiSummary.content.keyDecisions.length > 0 ? aiSummary.content.keyDecisions : localSummary.content.keyDecisions,
    riskAlerts: aiSummary.content.riskAlerts.length > 0 ? aiSummary.content.riskAlerts : localSummary.content.riskAlerts,
    tomorrowFocus: aiSummary.content.tomorrowFocus.length > 0 ? aiSummary.content.tomorrowFocus : localSummary.content.tomorrowFocus,
    marketSentiment: aiSummary.content.marketSentiment || localSummary.content.marketSentiment
  }
})

export const mergePreMarketReview = (
  localPreMarket: PreMarketData,
  aiPreMarket: PreMarketData,
  lookbackDays: number
): PreMarketData => ({
  ...localPreMarket,
  ...aiPreMarket,
  generatedAt: new Date().toISOString(),
  sourceSummaryDate: localPreMarket.sourceSummaryDate,
  meta: buildReviewMeta('hybrid', 'completed', lookbackDays),
  quickReview: {
    yesterdaySummary: aiPreMarket.quickReview.yesterdaySummary || localPreMarket.quickReview.yesterdaySummary,
    pendingItems: aiPreMarket.quickReview.pendingItems.length > 0 ? aiPreMarket.quickReview.pendingItems : localPreMarket.quickReview.pendingItems,
    keyLevels: aiPreMarket.quickReview.keyLevels.length > 0 ? aiPreMarket.quickReview.keyLevels : localPreMarket.quickReview.keyLevels
  },
  todayStrategy: {
    focusAreas: aiPreMarket.todayStrategy.focusAreas.length > 0 ? aiPreMarket.todayStrategy.focusAreas : localPreMarket.todayStrategy.focusAreas,
    watchlist: aiPreMarket.todayStrategy.watchlist.length > 0 ? aiPreMarket.todayStrategy.watchlist : localPreMarket.todayStrategy.watchlist,
    riskReminders: aiPreMarket.todayStrategy.riskReminders.length > 0 ? aiPreMarket.todayStrategy.riskReminders : localPreMarket.todayStrategy.riskReminders
  }
})

const inferMarketSentiment = (collected: CollectedNotes): string => {
  if (collected.stats.bullishNotes >= collected.stats.bearishNotes + 2 && collected.stats.buyActions >= collected.stats.sellActions) {
    return '乐观'
  }
  if (collected.stats.bearishNotes >= collected.stats.bullishNotes + 2 && collected.stats.sellActions >= collected.stats.buyActions) {
    return '悲观'
  }
  if (collected.stats.bearishNotes > collected.stats.bullishNotes || collected.stats.sellActions > collected.stats.buyActions) {
    return '谨慎'
  }
  return '中性'
}

const diffCalendarDays = (anchorDate: Date, value: Date): number => {
  const anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()).getTime()
  const target = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  return Math.max(0, Math.floor((anchor - target) / (24 * 60 * 60 * 1000)))
}

const compactText = (value: string, maxLength: number): string => {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact
}

const makeReadableSentence = (value: string): string => {
  const text = String(value || '').trim()
  if (!text) return ''
  return /[。！？.!?]$/.test(text) ? text : `${text}。`
}
