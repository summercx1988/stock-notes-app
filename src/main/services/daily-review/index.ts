import type {
  DailyReviewGenerationStatus,
  DailyReviewGenerationProgress,
  DailyReviewReminderIncludeSections,
  DailyReviewSettings,
  TimeEntry
} from '../../../shared/types'
import {
  DAILY_REVIEW_STOCK_CODE,
  type DailyReviewCategory,
  type DailySummaryData,
  type PreMarketData,
  type CollectedNotes,
  type DecisionItem,
  type ReviewGenerationMeta
} from './types'
import {
  buildDailySummaryPrompt,
  buildPreMarketPrompt,
  buildWeeklyPrompt,
  parseDailySummaryResponse,
  parsePreMarketResponse,
  parseWeeklyResponse
} from './prompts'
import type { NotesService, ReviewCandidateEntry } from '../notes'
import type { AIService } from '../ai'
import { notifyNotesChanged } from '../notes-events'
import { appLogger } from '../app-logger'
import { appConfigService } from '../app-config'
import { reviewGenerationStateService } from '../review-generation-state'

type ProgressReporter = (event: DailyReviewGenerationProgress) => void

interface DailyReviewRuntimeConfig {
  enabled: boolean
  analysisLookbackDays: number
  analysisMaxItems: number
  reminder: {
    enabled: boolean
    time: string
    weekdaysOnly: boolean
    autoGeneratePreMarket: boolean
    includeSections: DailyReviewReminderIncludeSections
  }
}

const DEFAULT_RUNTIME_CONFIG: DailyReviewRuntimeConfig = {
  enabled: true,
  analysisLookbackDays: 3,
  analysisMaxItems: 120,
  reminder: {
    enabled: true,
    time: '09:00',
    weekdaysOnly: true,
    autoGeneratePreMarket: true,
    includeSections: {
      yesterdaySummary: true,
      pendingItems: true,
      keyLevels: true,
      watchlist: true,
      riskReminders: true
    }
  }
}

export class DailyReviewService {
  private notesService: NotesService
  private aiService: AIService

  constructor(notesService: NotesService, aiService: AIService) {
    this.notesService = notesService
    this.aiService = aiService
  }

  async collectDayNotes(
    date: Date,
    options?: {
      lookbackDays?: number
      maxItems?: number
      reportProgress?: ProgressReporter
      operation?: DailyReviewGenerationProgress['operation']
    }
  ): Promise<CollectedNotes> {
    const dateStr = this.toDateString(date)
    const lookbackDays = Math.max(1, options?.lookbackDays ?? DEFAULT_RUNTIME_CONFIG.analysisLookbackDays)
    const maxItems = Math.max(20, options?.maxItems ?? DEFAULT_RUNTIME_CONFIG.analysisMaxItems)
    const dayEnd = new Date(`${dateStr}T23:59:59`)
    const dayStart = new Date(dayEnd)
    dayStart.setHours(0, 0, 0, 0)
    dayStart.setDate(dayStart.getDate() - (lookbackDays - 1))

    this.emitProgress(options?.reportProgress, {
      operation: options?.operation ?? 'daily-summary',
      stage: 'collecting',
      progress: 15,
      message: `读取近 ${lookbackDays} 天笔记`
    })

    const allEntries = (await this.notesService.getReviewCandidatesByTimeRange(dayStart, dayEnd, maxItems))
      .map((item: ReviewCandidateEntry) => ({
        entryId: item.entryId,
        stockCode: item.stockCode,
        stockName: item.stockName,
        eventTime: item.eventTime,
        category: item.category,
        viewpoint: item.viewpoint || { direction: '未知', confidence: 0, timeHorizon: '短线' },
        operationTag: item.operationTag || '无',
        contentPreview: (item.contentPreview || item.content || '').slice(0, 200),
        action: item.action
      }))
      .sort((left, right) => new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime())

    const entries = allEntries.slice(0, maxItems)

    const uniqueStocks = new Set(entries.map(e => e.stockCode))
    
    let buyActions = 0
    let sellActions = 0
    let bullishNotes = 0
    let bearishNotes = 0

    for (const entry of entries) {
      if (entry.operationTag === '买入') buyActions++
      else if (entry.operationTag === '卖出') sellActions++

      if (entry.viewpoint.direction === '看多') bullishNotes++
      else if (entry.viewpoint.direction === '看空') bearishNotes++
    }

    appLogger.debug('DailyReview', 'Collected notes for day', {
      date: dateStr,
      lookbackDays,
      dateRange: {
        start: this.toDateString(dayStart),
        end: dateStr
      },
      matchedNotes: allEntries.length,
      selectedNotes: entries.length,
      maxItems,
      totalNotes: entries.length,
      stocksCount: uniqueStocks.size,
      buyActions,
      sellActions,
      bullishNotes,
      bearishNotes
    })

    return {
      date: dateStr,
      totalNotes: entries.length,
      stocksCount: uniqueStocks.size,
      stats: {
        totalNotes: entries.length,
        stocksCount: uniqueStocks.size,
        buyActions,
        sellActions,
        bullishNotes,
        bearishNotes
      },
      entries
    }
  }

  async generateDailySummary(
    date?: Date,
    reportProgress?: ProgressReporter,
    options?: { force?: boolean; existingEntryId?: string }
  ): Promise<TimeEntry> {
    const targetDate = date || new Date()
    const dateStr = this.toDateString(targetDate)
    const startedAt = Date.now()
    const config = await this.getRuntimeConfig()
    const isToday = this.toDateString(new Date()) === dateStr

    console.log(`[DailyReview] Generating daily summary for ${dateStr}`)
    appLogger.info('DailyReview', 'Generate daily summary started', {
      date: dateStr,
      lookbackDays: config.analysisLookbackDays,
      maxItems: config.analysisMaxItems
    })
    this.emitProgress(reportProgress, {
      operation: 'daily-summary',
      stage: 'start',
      progress: 5,
      message: '开始生成今日复盘'
    })

    try {
      const collected = await this.collectDayNotes(targetDate, {
        lookbackDays: config.analysisLookbackDays,
        maxItems: config.analysisMaxItems,
        reportProgress,
        operation: 'daily-summary'
      })

      if (collected.totalNotes === 0) {
        throw new Error(`近 ${config.analysisLookbackDays} 天没有可用于复盘的笔记`)
      }

      const localSummary = this.buildLocalDailySummary(collected, config.analysisLookbackDays)
      const existingEntryId = options?.force
        ? (options?.existingEntryId || null)
        : (options?.existingEntryId || (await this.findLatestSummary(dateStr))?.id || null)

      this.emitProgress(reportProgress, {
        operation: 'daily-summary',
        stage: 'saving',
        progress: 34,
        message: existingEntryId ? '更新本地复盘草稿' : '保存本地复盘草稿'
      })
      let entry = await this.upsertReviewEntry({
        existingEntryId,
        category: '每日总结',
        title: `${dateStr} 每日复盘`,
        content: JSON.stringify(localSummary),
        eventTime: targetDate
      })

      try {
        this.emitProgress(reportProgress, {
          operation: 'daily-summary',
          stage: 'building-prompt',
          progress: 48,
          message: '整理 AI 增强上下文'
        })
        const prompt = buildDailySummaryPrompt(collected)
        appLogger.debug('DailyReview', 'Daily summary prompt prepared', {
          date: dateStr,
          promptChars: prompt.length,
          sourceNotes: collected.totalNotes
        })
        
        console.log('[DailyReview] Calling AI service for daily summary...')
        this.emitProgress(reportProgress, {
          operation: 'daily-summary',
          stage: 'ai-processing',
          progress: 62,
          message: 'AI 正在增强复盘内容'
        })
        const rawResponse = await this.aiService.summarize(prompt)
        console.log('[DailyReview] AI response received')

        this.emitProgress(reportProgress, {
          operation: 'daily-summary',
          stage: 'parsing',
          progress: 78,
          message: '解析 AI 返回内容'
        })
        const aiSummary = parseDailySummaryResponse(rawResponse)
        const finalSummary = this.mergeDailySummary(localSummary, aiSummary, config.analysisLookbackDays)

        this.emitProgress(reportProgress, {
          operation: 'daily-summary',
          stage: 'saving',
          progress: 92,
          message: '保存 AI 增强后的复盘'
        })
        entry = await this.upsertReviewEntry({
          existingEntryId: entry.id,
          category: '每日总结',
          title: `${dateStr} 每日复盘`,
          content: JSON.stringify(finalSummary),
          eventTime: targetDate
        })
      } catch (aiError) {
        appLogger.warn('DailyReview', 'AI enhancement failed, keep local summary', {
          date: dateStr,
          error: aiError
        })
        const fallbackSummary = {
          ...localSummary,
          generatedAt: new Date().toISOString(),
          meta: this.buildReviewMeta('local', 'fallback', config.analysisLookbackDays, aiError)
        }
        entry = await this.upsertReviewEntry({
          existingEntryId: entry.id,
          category: '每日总结',
          title: `${dateStr} 每日复盘`,
          content: JSON.stringify(fallbackSummary),
          eventTime: targetDate
        })
      }

      console.log(`[DailyReview] Daily summary generated successfully for ${dateStr}`)
      appLogger.info('DailyReview', 'Generate daily summary completed', {
        date: dateStr,
        entryId: entry.id,
        durationMs: Date.now() - startedAt
      })
      if (isToday) {
        const latestState = await reviewGenerationStateService.getState()
        await reviewGenerationStateService.markDailySummaryGenerated(latestState.notesLastUpdatedAt)
      }
      this.emitProgress(reportProgress, {
        operation: 'daily-summary',
        stage: 'completed',
        progress: 100,
        message: '今日复盘已生成'
      })
      return entry
    } catch (error) {
      appLogger.error('DailyReview', 'Generate daily summary failed', {
        date: dateStr,
        durationMs: Date.now() - startedAt,
        error
      })
      this.emitProgress(reportProgress, {
        operation: 'daily-summary',
        stage: 'error',
        progress: 100,
        message: `生成失败: ${error instanceof Error ? error.message : String(error)}`
      })
      throw error
    }
  }

  async generatePreMarketReview(
    targetDate?: Date,
    reportProgress?: ProgressReporter,
    options?: { existingEntryId?: string }
  ): Promise<TimeEntry> {
    const today = targetDate || new Date()
    const todayStr = this.toDateString(today)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = this.toDateString(yesterday)
    const startedAt = Date.now()
    const config = await this.getRuntimeConfig()

    console.log(`[DailyReview] Generating premarket review for ${todayStr}`)
    appLogger.info('DailyReview', 'Generate premarket review started', {
      date: todayStr,
      sourceDate: yesterdayStr
    })
    this.emitProgress(reportProgress, {
      operation: 'pre-market',
      stage: 'start',
      progress: 5,
      message: '开始生成盘前复习'
    })

    try {
      const yesterdaySummary = await this.findLatestSummary(yesterdayStr)
      let summaryData: DailySummaryData | null = null
      if (yesterdaySummary) {
        const parsedSummary = this.parseEntryContent(yesterdaySummary) as Partial<DailySummaryData>
        summaryData = parsedSummary?.content?.overview ? parsedSummary as DailySummaryData : null
      } else {
        this.emitProgress(reportProgress, {
          operation: 'pre-market',
          stage: 'collecting',
          progress: 24,
          message: `未找到 ${yesterdayStr} 复盘，回溯近 ${config.analysisLookbackDays} 天笔记`
        })
        const collected = await this.collectDayNotes(yesterday, {
          lookbackDays: config.analysisLookbackDays,
          maxItems: config.analysisMaxItems,
          reportProgress,
          operation: 'pre-market'
        })
        if (collected.totalNotes > 0) {
          summaryData = this.buildLocalDailySummary(collected, config.analysisLookbackDays)
        }
      }

      const localPreMarket = this.buildLocalPreMarket(summaryData, yesterdayStr, config.analysisLookbackDays)
      const existingEntryId = options?.existingEntryId || (await this.findLatestPreMarket(todayStr))?.id || null

      this.emitProgress(reportProgress, {
        operation: 'pre-market',
        stage: 'saving',
        progress: 36,
        message: existingEntryId ? '更新盘前复习草稿' : '保存盘前复习草稿'
      })
      let entry = await this.upsertReviewEntry({
        existingEntryId,
        category: '盘前复习',
        title: `${todayStr} 盘前复习`,
        content: JSON.stringify(localPreMarket),
        eventTime: today
      })

      if (summaryData) {
        try {
          this.emitProgress(reportProgress, {
            operation: 'pre-market',
            stage: 'building-prompt',
            progress: 52,
            message: '整理盘前复习上下文'
          })
          const prompt = buildPreMarketPrompt(summaryData)
          console.log('[DailyReview] Calling AI service for premarket review...')
          this.emitProgress(reportProgress, {
            operation: 'pre-market',
            stage: 'ai-processing',
            progress: 68,
            message: 'AI 正在增强盘前复习'
          })
          const rawResponse = await this.aiService.summarize(prompt)
          this.emitProgress(reportProgress, {
            operation: 'pre-market',
            stage: 'parsing',
            progress: 82,
            message: '解析盘前复习内容'
          })
          const aiPreMarket = parsePreMarketResponse(rawResponse)
          const finalPreMarket = this.mergePreMarketReview(localPreMarket, aiPreMarket, config.analysisLookbackDays)
          this.emitProgress(reportProgress, {
            operation: 'pre-market',
            stage: 'saving',
            progress: 92,
            message: '保存 AI 增强后的盘前复习'
          })
          entry = await this.upsertReviewEntry({
            existingEntryId: entry.id,
            category: '盘前复习',
            title: `${todayStr} 盘前复习`,
            content: JSON.stringify(finalPreMarket),
            eventTime: today
          })
        } catch (aiError) {
          appLogger.warn('DailyReview', 'AI enhancement failed, keep local premarket review', {
            date: todayStr,
            sourceDate: yesterdayStr,
            error: aiError
          })
          const fallbackPreMarket = {
            ...localPreMarket,
            generatedAt: new Date().toISOString(),
            meta: this.buildReviewMeta('local', 'fallback', config.analysisLookbackDays, aiError)
          }
          entry = await this.upsertReviewEntry({
            existingEntryId: entry.id,
            category: '盘前复习',
            title: `${todayStr} 盘前复习`,
            content: JSON.stringify(fallbackPreMarket),
            eventTime: today
          })
        }
      }

      console.log(`[DailyReview] Premarket review generated successfully for ${todayStr}`)
      appLogger.info('DailyReview', 'Generate premarket review completed', {
        date: todayStr,
        sourceDate: yesterdayStr,
        entryId: entry.id,
        durationMs: Date.now() - startedAt
      })
      this.emitProgress(reportProgress, {
        operation: 'pre-market',
        stage: 'completed',
        progress: 100,
        message: '盘前复习已生成'
      })
      return entry
    } catch (error) {
      appLogger.error('DailyReview', 'Generate premarket review failed', {
        date: todayStr,
        sourceDate: yesterdayStr,
        durationMs: Date.now() - startedAt,
        error
      })
      this.emitProgress(reportProgress, {
        operation: 'pre-market',
        stage: 'error',
        progress: 100,
        message: `生成失败: ${error instanceof Error ? error.message : String(error)}`
      })
      throw error
    }
  }

  async generateWeeklyReview(weekStart?: Date, reportProgress?: ProgressReporter): Promise<TimeEntry> {
    const startOfWeek = weekStart || this.getMondayOfCurrentWeek()
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(endOfWeek.getDate() + 6)

    const startStr = this.toDateString(startOfWeek)
    const endStr = this.toDateString(endOfWeek)
    const startedAt = Date.now()

    console.log(`[DailyReview] Generating weekly review for ${startStr} ~ ${endStr}`)
    appLogger.info('DailyReview', 'Generate weekly review started', {
      weekStart: startStr,
      weekEnd: endStr
    })
    this.emitProgress(reportProgress, {
      operation: 'weekly',
      stage: 'start',
      progress: 5,
      message: '开始生成周回顾'
    })

    try {
      const weekEntries = await this.getReviewEntriesByCategory('每日总结', startOfWeek, endOfWeek)

      if (weekEntries.length === 0) {
        throw new Error(`本周(${startStr}~${endStr})没有每日总结，无法生成周回顾`)
      }

      const weeklySummaries = weekEntries.map(entry => {
        try {
          return {
            date: entry.title?.replace(' 每日总结', '') || '',
            summary: JSON.parse(entry.content) as DailySummaryData
          }
        } catch {
          return null
        }
      }).filter(Boolean) as Array<{ date: string; summary: DailySummaryData }>

      this.emitProgress(reportProgress, {
        operation: 'weekly',
        stage: 'building-prompt',
        progress: 30,
        message: '整理本周每日总结'
      })
      const prompt = buildWeeklyPrompt(weeklySummaries)
      console.log('[DailyReview] Calling AI service for weekly review...')
      this.emitProgress(reportProgress, {
        operation: 'weekly',
        stage: 'ai-processing',
        progress: 55,
        message: 'AI 正在生成周回顾'
      })
      const rawResponse = await this.aiService.summarize(prompt)
      
      this.emitProgress(reportProgress, {
        operation: 'weekly',
        stage: 'parsing',
        progress: 78,
        message: '解析周回顾内容'
      })
      const weeklyData = parseWeeklyResponse(rawResponse)
      weeklyData.weekStart = startStr
      weeklyData.weekEnd = endStr
      weeklyData.summaryDates = weeklySummaries.map(s => s.date)

      const totalWinRate = weeklySummaries.reduce((sum, s) => sum + (s.summary.content.keyDecisions.length > 0 ? 1 : 0), 0) / weeklySummaries.length

      const allDecisions = weeklySummaries.flatMap(s => s.summary.content.keyDecisions)
      let bestTrade: DecisionItem | null = null
      let worstTrade: DecisionItem | null = null

      for (const decision of allDecisions) {
        if (!bestTrade || decision.confidence > bestTrade.confidence) {
          bestTrade = decision
        }
        if (!worstTrade || decision.confidence < worstTrade.confidence) {
          worstTrade = decision
        }
      }

      weeklyData.content.performanceSummary.winRate = Math.round(totalWinRate * 100) / 100
      weeklyData.content.performanceSummary.bestTrade = bestTrade
      weeklyData.content.performanceSummary.worstTrade = worstTrade

      this.emitProgress(reportProgress, {
        operation: 'weekly',
        stage: 'saving',
        progress: 92,
        message: '保存周回顾卡片'
      })
      const entry = await this.createReviewEntry(
        '周回顾',
        `${startStr}~${endStr} 周回顾`,
        JSON.stringify(weeklyData)
      )

      console.log(`[DailyReview] Weekly review generated successfully`)
      appLogger.info('DailyReview', 'Generate weekly review completed', {
        weekStart: startStr,
        weekEnd: endStr,
        entryId: entry.id,
        durationMs: Date.now() - startedAt,
        sourceDailySummaries: weekEntries.length
      })
      this.emitProgress(reportProgress, {
        operation: 'weekly',
        stage: 'completed',
        progress: 100,
        message: '周回顾已生成'
      })
      return entry
    } catch (error) {
      appLogger.error('DailyReview', 'Generate weekly review failed', {
        weekStart: startStr,
        weekEnd: endStr,
        durationMs: Date.now() - startedAt,
        error
      })
      this.emitProgress(reportProgress, {
        operation: 'weekly',
        stage: 'error',
        progress: 100,
        message: `生成失败: ${error instanceof Error ? error.message : String(error)}`
      })
      throw error
    }
  }

  async getTodaySummary(): Promise<TimeEntry | null> {
    const today = new Date()
    const todayStr = this.toDateString(today)
    const dayStart = new Date(todayStr + 'T00:00:00')
    const dayEnd = new Date(todayStr + 'T23:59:59')

    const entries = await this.getReviewEntriesByCategory('每日总结', dayStart, dayEnd)
    return entries.length > 0 ? entries[0] : null
  }

  async getPendingPreMarket(): Promise<TimeEntry | null> {
    const today = new Date()
    const todayStr = this.toDateString(today)
    const dayStart = new Date(todayStr + 'T00:00:00')
    const dayEnd = new Date(todayStr + 'T23:59:59')

    const entries = await this.getReviewEntriesByCategory('盘前复习', dayStart, dayEnd)
    
    for (const entry of entries) {
      if (entry.trackingStatus === '未读') {
        return entry
      }
    }
    
    return null
  }

  async getReviewHistory(startDate: Date, endDate: Date): Promise<TimeEntry[]> {
    const entries = await this.getAllReviewEntries(startDate, endDate)
    return entries.filter((entry) => this.isPrimaryReviewEntry(entry))
  }

  async getUnreadCount(): Promise<number> {
    try {
      const note = await this.notesService.getStockNote(DAILY_REVIEW_STOCK_CODE)
      if (!note) return 0

      return note.entries.filter((entry) =>
        this.isPrimaryReviewEntry(entry) && entry.trackingStatus === '未读'
      ).length
    } catch {
      return 0
    }
  }

  async getRuntimeSettings(): Promise<DailyReviewRuntimeConfig> {
    return this.getRuntimeConfig()
  }

  async getDailySummaryGenerationStatus(): Promise<DailyReviewGenerationStatus> {
    try {
      await this.ensureNotesUpdatedAtInitialized()
      const state = await reviewGenerationStateService.getState()
      return {
        notesLastUpdatedAt: state.notesLastUpdatedAt,
        dailySummaryLastGeneratedAt: state.dailySummaryLastGeneratedAt,
        dailySummaryLastGeneratedFromUpdatedAt: state.dailySummaryLastGeneratedFromUpdatedAt,
        hasPendingChanges: reviewGenerationStateService.hasPendingChanges(state)
      }
    } catch (error) {
      appLogger.warn('DailyReview', 'Get daily summary generation status failed, fallback enabled', { error })
      return {
        notesLastUpdatedAt: null,
        dailySummaryLastGeneratedAt: null,
        dailySummaryLastGeneratedFromUpdatedAt: null,
        hasPendingChanges: true
      }
    }
  }

  async markAsRead(entryId: string): Promise<void> {
    const entry = await this.notesService.updateEntry(DAILY_REVIEW_STOCK_CODE, entryId, {
      trackingStatus: '已读' as any
    })
    notifyNotesChanged({
      stockCode: DAILY_REVIEW_STOCK_CODE,
      entryId: entry.id,
      action: 'updated',
      source: 'local'
    })
  }

  async markAllAsRead(): Promise<void> {
    try {
      const note = await this.notesService.getStockNote(DAILY_REVIEW_STOCK_CODE)
      if (!note) return

      for (const entry of note.entries) {
        if (entry.trackingStatus === '未读') {
          await this.notesService.updateEntry(DAILY_REVIEW_STOCK_CODE, entry.id, {
            trackingStatus: '已读' as any
          })
          notifyNotesChanged({
            stockCode: DAILY_REVIEW_STOCK_CODE,
            entryId: entry.id,
            action: 'updated',
            source: 'local'
          })
        }
      }
    } catch (error) {
      console.error('[DailyReview] Failed to mark all as read:', error)
    }
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.notesService.deleteEntry(DAILY_REVIEW_STOCK_CODE, entryId)
    notifyNotesChanged({
      stockCode: DAILY_REVIEW_STOCK_CODE,
      entryId,
      action: 'deleted',
      source: 'local'
    })
  }

  async deleteEntries(entryIds: string[]): Promise<number> {
    let deleted = 0
    for (const entryId of entryIds) {
      try {
        await this.deleteEntry(entryId)
        deleted += 1
      } catch (error) {
        appLogger.warn('DailyReview', 'Delete review entry failed', { entryId, error })
      }
    }
    return deleted
  }

  async collectToNotes(entryId: string, reportProgress?: ProgressReporter): Promise<{ created: number; stockCodes: string[] }> {
    const startedAt = Date.now()
    appLogger.info('DailyReview', 'Collect review entry to notes started', { entryId })
    this.emitProgress(reportProgress, {
      operation: 'collect-to-notes',
      stage: 'start',
      progress: 5,
      message: '开始收录到股票笔记'
    })
    try {
      const stockNote = await this.notesService.getStockNote(DAILY_REVIEW_STOCK_CODE)
      if (!stockNote) throw new Error('复盘笔记不存在')

      const sourceEntry = stockNote.entries.find((entry) => entry.id === entryId)
      if (!sourceEntry) throw new Error('复盘条目不存在')

      const parsed = this.parseEntryContent(sourceEntry)
      const targets = this.extractTargetStocks(sourceEntry.category, parsed)
      if (targets.length === 0) {
        throw new Error('未识别到可收录的关联股票')
      }
      this.emitProgress(reportProgress, {
        operation: 'collect-to-notes',
        stage: 'processing',
        progress: 25,
        message: `识别到 ${targets.length} 个候选标的`
      })

      const markdown = this.buildCollectedMarkdown(sourceEntry, parsed)
      const uniqueTargets = new Map<string, string>()
      for (const item of targets) {
        if (!item.stockCode) continue
        if (!uniqueTargets.has(item.stockCode)) {
          uniqueTargets.set(item.stockCode, item.stockName || item.stockCode)
        }
      }

      let created = 0
      const totalTargets = uniqueTargets.size
      let processed = 0
      for (const [stockCode] of uniqueTargets.entries()) {
        processed += 1
        const progress = Math.min(95, Math.round((processed / Math.max(totalTargets, 1)) * 60 + 30))
        this.emitProgress(reportProgress, {
          operation: 'collect-to-notes',
          stage: 'saving',
          progress,
          message: `正在收录 ${processed}/${totalTargets}`
        })

        const createdEntry = await this.notesService.addEntry(stockCode, {
          content: markdown,
          title: `${this.toDateString(new Date(sourceEntry.eventTime))} ${sourceEntry.category} 收录`,
          eventTime: new Date(sourceEntry.eventTime),
          category: '普通笔记' as any,
          operationTag: '无' as any,
          trackingStatus: '关注' as any,
          viewpoint: { direction: '未知', confidence: 0, timeHorizon: '短线' },
          inputType: 'manual'
        })
        notifyNotesChanged({
          stockCode,
          entryId: createdEntry.id,
          action: 'created',
          source: 'local'
        })
        created++
      }

      appLogger.info('DailyReview', 'Collect review entry to notes completed', {
        entryId,
        created,
        stockCodes: [...uniqueTargets.keys()],
        durationMs: Date.now() - startedAt
      })
      this.emitProgress(reportProgress, {
        operation: 'collect-to-notes',
        stage: 'completed',
        progress: 100,
        message: '收录完成'
      })

      return {
        created,
        stockCodes: [...uniqueTargets.keys()]
      }
    } catch (error) {
      this.emitProgress(reportProgress, {
        operation: 'collect-to-notes',
        stage: 'error',
        progress: 100,
        message: `收录失败: ${error instanceof Error ? error.message : String(error)}`
      })
      throw error
    }
  }

  async regenerate(entryId: string, reportProgress?: ProgressReporter): Promise<TimeEntry> {
    const stockNote = await this.notesService.getStockNote(DAILY_REVIEW_STOCK_CODE)
    if (!stockNote) throw new Error('复盘笔记不存在')

    const existingEntry = stockNote.entries.find(e => e.id === entryId)
    if (!existingEntry) throw new Error('复盘条目不存在')

    const category = (this.resolveReviewCategory(existingEntry) || existingEntry.category) as DailyReviewCategory

    switch (category) {
      case '每日总结':
        return this.generateDailySummary(new Date(existingEntry.eventTime), reportProgress, { existingEntryId: existingEntry.id })
      case '盘前复习':
        return this.generatePreMarketReview(new Date(existingEntry.eventTime), reportProgress, { existingEntryId: existingEntry.id })
      case '周回顾':
        return this.generateWeeklyReview(new Date(existingEntry.eventTime), reportProgress)
      default:
        throw new Error(`不支持的复习类别: ${category}`)
    }
  }

  private async findLatestSummary(dateStr: string): Promise<TimeEntry | null> {
    try {
      const dayStart = new Date(dateStr + 'T00:00:00')
      const dayEnd = new Date(dateStr + 'T23:59:59')
      return this.findLatestByCategory('每日总结', dayStart, dayEnd)
    } catch {
      return null
    }
  }

  private async findLatestPreMarket(dateStr: string): Promise<TimeEntry | null> {
    try {
      const dayStart = new Date(dateStr + 'T00:00:00')
      const dayEnd = new Date(dateStr + 'T23:59:59')
      return this.findLatestByCategory('盘前复习', dayStart, dayEnd)
    } catch {
      return null
    }
  }

  private async getReviewEntriesByCategory(category: string, startDate?: Date, endDate?: Date): Promise<TimeEntry[]> {
    try {
      const note = await this.notesService.getStockNote(DAILY_REVIEW_STOCK_CODE)
      if (!note) return []

      let entries = note.entries.filter((entry) => this.resolveReviewCategory(entry) === category)

      if (startDate) {
        entries = entries.filter(entry => {
          const eventTime = entry.eventTime instanceof Date ? entry.eventTime : new Date(entry.eventTime)
          return eventTime >= startDate
        })
      }

      if (endDate) {
        entries = entries.filter(entry => {
          const eventTime = entry.eventTime instanceof Date ? entry.eventTime : new Date(entry.eventTime)
          return eventTime <= endDate
        })
      }

      return entries.sort((a, b) => {
        const timeA = a.eventTime instanceof Date ? a.eventTime.getTime() : new Date(a.eventTime).getTime()
        const timeB = b.eventTime instanceof Date ? b.eventTime.getTime() : new Date(b.eventTime).getTime()
        return timeB - timeA
      })
    } catch {
      return []
    }
  }

  private async getAllReviewEntries(startDate?: Date, endDate?: Date): Promise<TimeEntry[]> {
    try {
      const note = await this.notesService.getStockNote(DAILY_REVIEW_STOCK_CODE)
      if (!note) return []

      let entries = [...note.entries]

      if (startDate) {
        entries = entries.filter(entry => {
          const eventTime = entry.eventTime instanceof Date ? entry.eventTime : new Date(entry.eventTime)
          return eventTime >= startDate
        })
      }

      if (endDate) {
        entries = entries.filter(entry => {
          const eventTime = entry.eventTime instanceof Date ? entry.eventTime : new Date(entry.eventTime)
          return eventTime <= endDate
        })
      }

      return entries.sort((a, b) => {
        const timeA = a.eventTime instanceof Date ? a.eventTime.getTime() : new Date(a.eventTime).getTime()
        const timeB = b.eventTime instanceof Date ? b.eventTime.getTime() : new Date(b.eventTime).getTime()
        return timeB - timeA
      })
    } catch {
      return []
    }
  }

  private buildReviewMeta(
    generationMode: ReviewGenerationMeta['generationMode'],
    aiStatus: ReviewGenerationMeta['aiStatus'],
    lookbackDays: number,
    note?: unknown
  ): ReviewGenerationMeta {
    return {
      generationMode,
      aiStatus,
      lookbackDays,
      note: note ? String(note instanceof Error ? note.message : note) : undefined
    }
  }

  private buildLocalDailySummary(collected: CollectedNotes, lookbackDays: number): DailySummaryData {
    const targetDate = new Date(`${collected.date}T00:00:00`)
    const primaryEntries = collected.entries.filter((entry) => this.diffCalendarDays(targetDate, new Date(entry.eventTime)) <= 1)
    const trailingEntries = collected.entries.filter((entry) => this.diffCalendarDays(targetDate, new Date(entry.eventTime)) >= 2)

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
      const diffDays = this.diffCalendarDays(targetDate, new Date(entry.eventTime))
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

    const marketSentiment = this.inferMarketSentiment(collected)
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
        reason: this.makeReadableSentence(
          this.compactText(item.latestEntry.contentPreview, 52) || `T0/T-1 内有 ${item.primaryCount} 条新的跟踪记录`
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
        suggestion: this.makeReadableSentence(
          this.compactText(item.latestEntry.contentPreview, 42) || '优先确认触发条件，再决定是否执行'
        )
      }))

    const tomorrowFocus = focusStocks.slice(0, 3).map((item) => ({
      stockCode: item.stockCode,
      stockName: item.stockName,
      reason: this.makeReadableSentence(
        this.compactText(item.latestEntry.contentPreview, 42) || `近期有 ${item.primaryCount} 条记录需要继续跟踪`
      ),
      actionType: (item.buyCount > 0 || item.sellCount > 0 ? 'execute' : 'monitor') as 'execute' | 'monitor',
      sourceEntryId: item.latestEntry.entryId
    }))

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      meta: this.buildReviewMeta('local', 'pending', lookbackDays),
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

  private buildLocalPreMarket(
    summaryData: DailySummaryData | null,
    sourceSummaryDate: string,
    lookbackDays: number
  ): PreMarketData {
    if (!summaryData) {
      return {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        sourceSummaryDate,
        meta: this.buildReviewMeta('local', 'fallback', lookbackDays, '未找到可用的昨日日志，保留本地提示'),
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
      description: this.makeReadableSentence(decision.reason || `${decision.action} 计划待验证`),
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
      reason: this.makeReadableSentence(item.reason),
      expectedAction: item.actionType === 'execute' ? '关注触发条件，必要时执行' : '持续观察'
    }))

    const riskReminders = summaryData.content.riskAlerts.length > 0
      ? summaryData.content.riskAlerts.slice(0, 3).map((item) => this.makeReadableSentence(item.description))
      : ['若盘前没有新增确认信号，优先观察而非立即交易']

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      sourceSummaryDate,
      meta: this.buildReviewMeta('local', 'pending', lookbackDays),
      quickReview: {
        yesterdaySummary: this.makeReadableSentence(summaryData.content.overview),
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

  private mergeDailySummary(
    localSummary: DailySummaryData,
    aiSummary: DailySummaryData,
    lookbackDays: number
  ): DailySummaryData {
    return {
      ...localSummary,
      ...aiSummary,
      generatedAt: new Date().toISOString(),
      meta: this.buildReviewMeta('hybrid', 'completed', lookbackDays),
      stats: localSummary.stats,
      relatedEntries: localSummary.relatedEntries,
      content: {
        overview: aiSummary.content.overview || localSummary.content.overview,
        keyDecisions: aiSummary.content.keyDecisions.length > 0 ? aiSummary.content.keyDecisions : localSummary.content.keyDecisions,
        riskAlerts: aiSummary.content.riskAlerts.length > 0 ? aiSummary.content.riskAlerts : localSummary.content.riskAlerts,
        tomorrowFocus: aiSummary.content.tomorrowFocus.length > 0 ? aiSummary.content.tomorrowFocus : localSummary.content.tomorrowFocus,
        marketSentiment: aiSummary.content.marketSentiment || localSummary.content.marketSentiment
      }
    }
  }

  private mergePreMarketReview(
    localPreMarket: PreMarketData,
    aiPreMarket: PreMarketData,
    lookbackDays: number
  ): PreMarketData {
    return {
      ...localPreMarket,
      ...aiPreMarket,
      generatedAt: new Date().toISOString(),
      sourceSummaryDate: localPreMarket.sourceSummaryDate,
      meta: this.buildReviewMeta('hybrid', 'completed', lookbackDays),
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
    }
  }

  private inferMarketSentiment(collected: CollectedNotes): string {
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

  private diffCalendarDays(anchorDate: Date, value: Date): number {
    const anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()).getTime()
    const target = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
    return Math.max(0, Math.floor((anchor - target) / (24 * 60 * 60 * 1000)))
  }

  private compactText(value: string, maxLength: number): string {
    const compact = String(value || '').replace(/\s+/g, ' ').trim()
    if (!compact) return ''
    return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact
  }

  private makeReadableSentence(value: string): string {
    const text = String(value || '').trim()
    if (!text) return ''
    return /[。！？.!?]$/.test(text) ? text : `${text}。`
  }

  private async upsertReviewEntry(params: {
    existingEntryId?: string | null
    category: DailyReviewCategory
    title: string
    content: string
    eventTime: Date
  }): Promise<TimeEntry> {
    const { existingEntryId, category, title, content, eventTime } = params
    if (!existingEntryId) {
      return this.createReviewEntry(category, title, content, eventTime)
    }

    const updatedEntry = await this.notesService.updateEntry(DAILY_REVIEW_STOCK_CODE, existingEntryId, {
      content,
      title,
      eventTime,
      category: category as any,
      operationTag: '自动生成' as any,
      trackingStatus: '未读' as any,
      viewpoint: {
        direction: '系统生成',
        confidence: 1,
        timeHorizon: '当日'
      }
    })

    notifyNotesChanged({
      stockCode: DAILY_REVIEW_STOCK_CODE,
      entryId: updatedEntry.id,
      action: 'updated',
      source: 'local'
    })

    return updatedEntry
  }

  private async createReviewEntry(
    category: DailyReviewCategory,
    title: string,
    content: string,
    eventTime: Date = new Date()
  ): Promise<TimeEntry> {
    const createdEntry = await this.notesService.addEntry(DAILY_REVIEW_STOCK_CODE, {
      content,
      title,
      eventTime,
      category: category as any,
      operationTag: '自动生成' as any,
      trackingStatus: '未读' as any,
      viewpoint: {
        direction: '系统生成',
        confidence: 1,
        timeHorizon: '当日'
      }
    })

    notifyNotesChanged({
      stockCode: DAILY_REVIEW_STOCK_CODE,
      entryId: createdEntry.id,
      action: 'created',
      source: 'local'
    })

    return createdEntry
  }

  private emitProgress(reporter: ProgressReporter | undefined, event: DailyReviewGenerationProgress): void {
    if (!reporter) return
    reporter(event)
  }

  private async getRuntimeConfig(): Promise<DailyReviewRuntimeConfig> {
    try {
      const configured = await appConfigService.get<DailyReviewSettings>('dailyReview')
      if (!configured) {
        return { ...DEFAULT_RUNTIME_CONFIG }
      }
      return {
        enabled: Boolean(configured.enabled ?? DEFAULT_RUNTIME_CONFIG.enabled),
        analysisLookbackDays: Math.max(
          1,
          Math.min(7, Number(configured.analysisLookbackDays ?? DEFAULT_RUNTIME_CONFIG.analysisLookbackDays) || DEFAULT_RUNTIME_CONFIG.analysisLookbackDays)
        ),
        analysisMaxItems: Math.max(
          20,
          Math.min(300, Number(configured.analysisMaxItems ?? DEFAULT_RUNTIME_CONFIG.analysisMaxItems) || DEFAULT_RUNTIME_CONFIG.analysisMaxItems)
        ),
        reminder: {
          enabled: Boolean(configured.reminder?.enabled ?? DEFAULT_RUNTIME_CONFIG.reminder.enabled),
          time: String(configured.reminder?.time || DEFAULT_RUNTIME_CONFIG.reminder.time),
          weekdaysOnly: Boolean(configured.reminder?.weekdaysOnly ?? DEFAULT_RUNTIME_CONFIG.reminder.weekdaysOnly),
          autoGeneratePreMarket: Boolean(configured.reminder?.autoGeneratePreMarket ?? DEFAULT_RUNTIME_CONFIG.reminder.autoGeneratePreMarket),
          includeSections: {
            yesterdaySummary: Boolean(
              configured.reminder?.includeSections?.yesterdaySummary ?? DEFAULT_RUNTIME_CONFIG.reminder.includeSections.yesterdaySummary
            ),
            pendingItems: Boolean(
              configured.reminder?.includeSections?.pendingItems ?? DEFAULT_RUNTIME_CONFIG.reminder.includeSections.pendingItems
            ),
            keyLevels: Boolean(
              configured.reminder?.includeSections?.keyLevels ?? DEFAULT_RUNTIME_CONFIG.reminder.includeSections.keyLevels
            ),
            watchlist: Boolean(
              configured.reminder?.includeSections?.watchlist ?? DEFAULT_RUNTIME_CONFIG.reminder.includeSections.watchlist
            ),
            riskReminders: Boolean(
              configured.reminder?.includeSections?.riskReminders ?? DEFAULT_RUNTIME_CONFIG.reminder.includeSections.riskReminders
            )
          }
        }
      }
    } catch (error) {
      appLogger.warn('DailyReview', 'Failed to load runtime config, fallback defaults', { error })
      return { ...DEFAULT_RUNTIME_CONFIG }
    }
  }

  private toDateString(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private getMondayOfCurrentWeek(): Date {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(now.setDate(diff))
    monday.setHours(0, 0, 0, 0)
    return monday
  }

  private parseEntryContent(entry: TimeEntry): Record<string, any> {
    try {
      return JSON.parse(String(entry.content || '{}'))
    } catch {
      return {}
    }
  }

  private extractTargetStocks(category: string, parsed: Record<string, any>): Array<{ stockCode: string; stockName: string }> {
    const results: Array<{ stockCode: string; stockName: string }> = []

    if (category === '每日总结') {
      const decisions = Array.isArray(parsed.content?.keyDecisions) ? parsed.content.keyDecisions : []
      const focus = Array.isArray(parsed.content?.tomorrowFocus) ? parsed.content.tomorrowFocus : []
      const related = Array.isArray(parsed.relatedEntries) ? parsed.relatedEntries : []
      for (const item of [...decisions, ...focus, ...related]) {
        const stockCode = this.normalizeStockCode(item?.stockCode)
        const stockName = String(item?.stockName || stockCode).trim()
        if (stockCode) results.push({ stockCode, stockName })
      }
    }

    if (category === '盘前复习') {
      const pendingItems = Array.isArray(parsed.quickReview?.pendingItems) ? parsed.quickReview.pendingItems : []
      const keyLevels = Array.isArray(parsed.quickReview?.keyLevels) ? parsed.quickReview.keyLevels : []
      const watchlist = Array.isArray(parsed.todayStrategy?.watchlist) ? parsed.todayStrategy.watchlist : []
      for (const item of [...pendingItems, ...keyLevels, ...watchlist]) {
        const stockCode = this.normalizeStockCode(item?.stockCode)
        const stockName = String(item?.stockName || stockCode).trim()
        if (stockCode) results.push({ stockCode, stockName })
      }
    }

    if (category === '周回顾') {
      const nextWeekFocus = Array.isArray(parsed.content?.nextWeekFocus) ? parsed.content.nextWeekFocus : []
      const bestTrade = parsed.content?.performanceSummary?.bestTrade ? [parsed.content.performanceSummary.bestTrade] : []
      const worstTrade = parsed.content?.performanceSummary?.worstTrade ? [parsed.content.performanceSummary.worstTrade] : []
      for (const item of [...nextWeekFocus, ...bestTrade, ...worstTrade]) {
        const stockCode = this.normalizeStockCode(item?.stockCode)
        const stockName = String(item?.stockName || stockCode).trim()
        if (stockCode) results.push({ stockCode, stockName })
      }
    }

    return results
  }

  private buildCollectedMarkdown(entry: TimeEntry, parsed: Record<string, any>): string {
    const eventTime = entry.eventTime instanceof Date ? entry.eventTime : new Date(entry.eventTime)
    const category = String(entry.category || '复盘')
    const title = String(entry.title || `${this.toDateString(eventTime)} ${category}`)
    const generatedAt = parsed.generatedAt ? new Date(parsed.generatedAt) : eventTime
    const generatedAtText = this.toLocalMinuteText(generatedAt)

    const lines: string[] = []
    lines.push(`## ${title}`)
    lines.push('')
    lines.push('> 来源: 每日复盘卡片')
    lines.push(`> 类型: ${category}`)
    lines.push(`> 生成时间: ${generatedAtText}`)
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(parsed, null, 2))
    lines.push('```')

    return lines.join('\n')
  }

  private toLocalMinuteText(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }

  private normalizeStockCode(value: unknown): string {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const matched = raw.match(/(\d{6})/)
    return matched ? matched[1] : ''
  }

  private async findLatestByCategory(
    category: '每日总结' | '盘前复习' | '周回顾',
    startDate: Date,
    endDate: Date
  ): Promise<TimeEntry | null> {
    const entries = await this.getAllReviewEntries(startDate, endDate)
    return entries.find((entry) => this.resolveReviewCategory(entry) === category) || null
  }

  private isPrimaryReviewCategory(category: unknown): boolean {
    return category === '每日总结' || category === '盘前复习'
  }

  private isPrimaryReviewEntry(entry: TimeEntry): boolean {
    return this.isPrimaryReviewCategory(this.resolveReviewCategory(entry))
  }

  private resolveReviewCategory(entry: TimeEntry): '每日总结' | '盘前复习' | '周回顾' | null {
    if (this.isPrimaryReviewCategory(entry.category) || entry.category === '周回顾') {
      return entry.category as '每日总结' | '盘前复习' | '周回顾'
    }

    const parsed = this.parseEntryContent(entry)
    if (
      parsed?.content?.overview &&
      Array.isArray(parsed?.content?.keyDecisions) &&
      Array.isArray(parsed?.content?.tomorrowFocus)
    ) {
      return '每日总结'
    }
    if (parsed?.quickReview && parsed?.todayStrategy) {
      return '盘前复习'
    }
    if (parsed?.content?.performanceSummary || Array.isArray(parsed?.content?.nextWeekFocus)) {
      return '周回顾'
    }

    return null
  }

  private async ensureNotesUpdatedAtInitialized(): Promise<void> {
    const state = await reviewGenerationStateService.getState()
    if (state.notesLastUpdatedAt) return

    try {
      const latestUpdatedAt = await this.notesService.getLatestUserNoteModifiedAt()
      if (latestUpdatedAt) {
        await reviewGenerationStateService.markNotesUpdated(latestUpdatedAt)
      }
    } catch (error) {
      appLogger.warn('DailyReview', 'Failed to initialize notes updated timestamp from existing notes', { error })
    }
  }
}
