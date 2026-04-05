import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DailyReviewService } from '../services/daily-review'
import { appLogger } from '../services/app-logger'
import type { DailyReviewGenerationProgress } from '../../shared/types'

let service: DailyReviewService | null = null

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'unknown error')

const logStart = (channel: string, context?: Record<string, unknown>): number => {
  const startedAt = Date.now()
  appLogger.info('IPC:DailyReview', `${channel} started`, context)
  return startedAt
}

const logSuccess = (channel: string, startedAt: number, context?: Record<string, unknown>): void => {
  appLogger.info('IPC:DailyReview', `${channel} succeeded`, {
    durationMs: Date.now() - startedAt,
    ...context
  })
}

const logFailure = (channel: string, startedAt: number, error: unknown, context?: Record<string, unknown>): void => {
  appLogger.error('IPC:DailyReview', `${channel} failed`, {
    durationMs: Date.now() - startedAt,
    error,
    ...context
  })
}

const emitProgress = (
  event: IpcMainInvokeEvent,
  payload: DailyReviewGenerationProgress
): void => {
  event.sender.send('daily-review:generation-progress', payload)
}

export function registerDailyReviewIPC(dailyReviewService: DailyReviewService): void {
  service = dailyReviewService

  ipcMain.handle('daily-review:generate-summary', async (event, options?: { force?: boolean }) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:generate-summary')
    try {
      const entry = await service.generateDailySummary(undefined, (progress) => {
        emitProgress(event, progress)
      }, options)
      logSuccess('daily-review:generate-summary', startedAt, { entryId: entry.id })
      return { success: true, data: entry }
    } catch (error: any) {
      logFailure('daily-review:generate-summary', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:generate-premarket', async (event) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:generate-premarket')
    try {
      const entry = await service.generatePreMarketReview(undefined, (progress) => {
        emitProgress(event, progress)
      })
      logSuccess('daily-review:generate-premarket', startedAt, { entryId: entry.id })
      return { success: true, data: entry }
    } catch (error: any) {
      logFailure('daily-review:generate-premarket', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:generate-weekly', async () => {
    const startedAt = logStart('daily-review:generate-weekly')
    try {
      logSuccess('daily-review:generate-weekly', startedAt, { deprecated: true })
      return { success: false, error: '周回顾功能已停用，仅保留每日总结与盘前复习' }
    } catch (error: any) {
      logFailure('daily-review:generate-weekly', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:get-today', async () => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:get-today')
    try {
      const entry = await service.getTodaySummary()
      logSuccess('daily-review:get-today', startedAt, { found: Boolean(entry) })
      return { success: true, data: entry }
    } catch (error: any) {
      logFailure('daily-review:get-today', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:get-pending', async () => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:get-pending')
    try {
      const entry = await service.getPendingPreMarket()
      logSuccess('daily-review:get-pending', startedAt, { found: Boolean(entry) })
      return { success: true, data: entry }
    } catch (error: any) {
      logFailure('daily-review:get-pending', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:get-history', async (_event, startDate?: string, endDate?: string, includeArchived?: boolean) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:get-history', { startDate, endDate, includeArchived: Boolean(includeArchived) })
    try {
      const start = startDate ? new Date(startDate) : undefined
      const end = endDate ? new Date(endDate) : undefined
      const entries = await service.getReviewHistory(start || new Date(0), end || new Date(), {
        includeArchived: Boolean(includeArchived)
      })
      logSuccess('daily-review:get-history', startedAt, { count: entries.length })
      return { success: true, data: entries }
    } catch (error: any) {
      logFailure('daily-review:get-history', startedAt, error, { startDate, endDate, includeArchived: Boolean(includeArchived) })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:mark-read', async (_event, entryId: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:mark-read', { entryId })
    try {
      await service.markAsRead(entryId)
      logSuccess('daily-review:mark-read', startedAt, { entryId })
      return { success: true }
    } catch (error: any) {
      logFailure('daily-review:mark-read', startedAt, error, { entryId })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:mark-all-read', async () => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:mark-all-read')
    try {
      await service.markAllAsRead()
      logSuccess('daily-review:mark-all-read', startedAt)
      return { success: true }
    } catch (error: any) {
      logFailure('daily-review:mark-all-read', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:regenerate', async (event, entryId: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:regenerate', { entryId })
    try {
      const entry = await service.regenerate(entryId, (progress) => {
        event.sender.send('daily-review:generation-progress', {
          ...progress,
          operation: 'regenerate'
        })
      })
      logSuccess('daily-review:regenerate', startedAt, { entryId, newEntryId: entry.id })
      return { success: true, data: entry }
    } catch (error: any) {
      logFailure('daily-review:regenerate', startedAt, error, { entryId })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:collect-to-notes', async (event, entryId: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:collect-to-notes', { entryId })
    try {
      const result = await service.collectToNotes(entryId, (progress) => {
        emitProgress(event, progress)
      })
      logSuccess('daily-review:collect-to-notes', startedAt, {
        entryId,
        created: result.created,
        stockCodes: result.stockCodes
      })
      return { success: true, data: result }
    } catch (error: any) {
      logFailure('daily-review:collect-to-notes', startedAt, error, { entryId })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:get-unread-count', async () => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:get-unread-count')
    try {
      const count = await service.getUnreadCount()
      logSuccess('daily-review:get-unread-count', startedAt, { count })
      return { success: true, data: count }
    } catch (error: any) {
      logFailure('daily-review:get-unread-count', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:get-generation-status', async () => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:get-generation-status')
    try {
      const status = await service.getDailySummaryGenerationStatus()
      logSuccess('daily-review:get-generation-status', startedAt, { hasPendingChanges: status.hasPendingChanges })
      return { success: true, data: status }
    } catch (error: any) {
      logFailure('daily-review:get-generation-status', startedAt, error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:delete-entry', async (_event, entryId: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:delete-entry', { entryId })
    try {
      await service.deleteEntry(entryId)
      logSuccess('daily-review:delete-entry', startedAt, { entryId })
      return { success: true }
    } catch (error: any) {
      logFailure('daily-review:delete-entry', startedAt, error, { entryId })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:delete-entries', async (_event, entryIds: string[]) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const safeIds = Array.isArray(entryIds) ? entryIds : []
    const startedAt = logStart('daily-review:delete-entries', { count: safeIds.length })
    try {
      const deleted = await service.deleteEntries(safeIds)
      logSuccess('daily-review:delete-entries', startedAt, { requested: safeIds.length, deleted })
      return { success: true, data: { deleted } }
    } catch (error: any) {
      logFailure('daily-review:delete-entries', startedAt, error, { count: safeIds.length })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:archive-entry', async (_event, entryId: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:archive-entry', { entryId })
    try {
      await service.archiveEntry(entryId)
      logSuccess('daily-review:archive-entry', startedAt, { entryId })
      return { success: true }
    } catch (error: any) {
      logFailure('daily-review:archive-entry', startedAt, error, { entryId })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:unarchive-entry', async (_event, entryId: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:unarchive-entry', { entryId })
    try {
      await service.unarchiveEntry(entryId)
      logSuccess('daily-review:unarchive-entry', startedAt, { entryId })
      return { success: true }
    } catch (error: any) {
      logFailure('daily-review:unarchive-entry', startedAt, error, { entryId })
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('daily-review:archive-before', async (_event, cutoffIso: string) => {
    if (!service) throw new Error('DailyReview service not initialized')
    const startedAt = logStart('daily-review:archive-before', { cutoffIso })
    try {
      const cutoffDate = new Date(cutoffIso)
      if (Number.isNaN(cutoffDate.getTime())) {
        throw new Error('无效的归档时间参数')
      }
      const archived = await service.archiveEntriesBefore(cutoffDate)
      logSuccess('daily-review:archive-before', startedAt, { cutoffIso, archived })
      return { success: true, data: { archived } }
    } catch (error: any) {
      logFailure('daily-review:archive-before', startedAt, error, { cutoffIso })
      return { success: false, error: errorMessage(error) }
    }
  })

  console.log('[DailyReview IPC] All handlers registered')
}
