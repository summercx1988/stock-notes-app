export const DAILY_REVIEW_STOCK_CODE = '__DAILY_REVIEW__' as const
export const DAILY_REVIEW_STOCK_NAME = '📋 每日复盘' as const

export type DailyReviewCategory = '每日总结' | '盘前复习' | '周回顾' | '月回顾'

export interface ReviewGenerationMeta {
  generationMode: 'local' | 'hybrid'
  aiStatus: 'pending' | 'completed' | 'fallback'
  lookbackDays?: number
  note?: string
}

export interface DailySummaryData {
  version: '1.0'
  generatedAt: string
  meta?: ReviewGenerationMeta
  stats: {
    totalNotes: number
    stocksCount: number
    buyActions: number
    sellActions: number
    bullishNotes: number
    bearishNotes: number
  }
  content: {
    overview: string
    keyDecisions: DecisionItem[]
    riskAlerts: RiskItem[]
    tomorrowFocus: FocusItem[]
    marketSentiment: string
  }
  relatedEntries: RelatedEntry[]
}

export interface PreMarketData {
  version: '1.0'
  generatedAt: string
  sourceSummaryDate: string
  meta?: ReviewGenerationMeta
  quickReview: {
    yesterdaySummary: string
    pendingItems: PendingItem[]
    keyLevels: KeyLevel[]
  }
  todayStrategy: {
    focusAreas: string[]
    watchlist: WatchlistItem[]
    riskReminders: string[]
  }
}

export interface WeeklyReviewData {
  version: '1.0'
  weekStart: string
  weekEnd: string
  summaryDates: string[]
  content: {
    weeklyOverview: string
    performanceSummary: {
      winRate: number
      bestTrade: DecisionItem | null
      worstTrade: DecisionItem | null
    }
    patternInsights: string[]
    nextWeekFocus: FocusItem[]
  }
}

export interface DecisionItem {
  stockCode: string
  stockName: string
  action: '买入' | '卖出' | '观望'
  reason: string
  confidence: number
  entryId: string
}

export interface RiskItem {
  level: 'high' | 'medium' | 'low'
  description: string
  relatedStocks: string[]
  suggestion: string
}

export interface FocusItem {
  stockCode: string
  stockName: string
  reason: string
  actionType: 'monitor' | 'execute' | 'review'
  sourceEntryId?: string
}

export interface RelatedEntry {
  entryId: string
  stockCode: string
  stockName: string
  eventTime: string
  category: string
  viewpoint: string
  preview: string
}

export interface PendingItem {
  stockCode: string
  stockName: string
  description: string
  priority: 'high' | 'medium' | 'low'
  dueDate: string
  sourceEntryId: string
}

export interface KeyLevel {
  stockCode: string
  stockName: string
  level: 'support' | 'resistance'
  price: number
  note: string
}

export interface WatchlistItem {
  stockCode: string
  stockName: string
  reason: string
  expectedAction: string
}

export interface CollectedNotes {
  date: string
  totalNotes: number
  stocksCount: number
  stats: {
    totalNotes: number
    stocksCount: number
    buyActions: number
    sellActions: number
    bullishNotes: number
    bearishNotes: number
  }
  entries: Array<{
    entryId: string
    stockCode: string
    stockName: string
    eventTime: string
    category: string
    viewpoint: { direction: string; confidence: number; timeHorizon: string }
    operationTag: string
    contentPreview: string
    action?: { type: string; price?: number; quantity?: number }
  }>
}

export interface DailyReviewConfig {
  enabled: boolean
  schedule: {
    dailySummaryTime: string
    preMarketTime: string
    weeklyReviewDay: string
    monthlyReviewDay: number
    onlyWeekdays: boolean
  }
  ai: {
    model: string
    temperature: number
    maxTokens: number
  }
  ui: {
    showPreMarketModal: boolean
    sidebarBadge: boolean
    autoMarkRead: boolean
    showInTimeline: boolean
  }
}

export const DEFAULT_DAILY_REVIEW_CONFIG: DailyReviewConfig = {
  enabled: true,
  schedule: {
    dailySummaryTime: '15:30',
    preMarketTime: '08:50',
    weeklyReviewDay: 'Friday',
    monthlyReviewDay: 1,
    onlyWeekdays: true
  },
  ai: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 2000
  },
  ui: {
    showPreMarketModal: true,
    sidebarBadge: true,
    autoMarkRead: false,
    showInTimeline: true
  }
}
