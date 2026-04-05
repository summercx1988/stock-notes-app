import { ipcMain } from 'electron'
import { notesAppService } from '../application/container'
import type {
  TimeEntry,
  StockNote,
  StockNoteSummary,
  TimelineItem,
  Viewpoint,
  Action,
  NoteInputType,
  NoteCategory,
  OperationTag,
  NotesExportResult,
  NotesImportResult
} from '../../shared/types'
import { appLogger } from '../services/app-logger'

const withIpcLog = async <T>(
  channel: string,
  context: Record<string, unknown>,
  handler: () => Promise<T>
): Promise<T> => {
  const startedAt = Date.now()
  appLogger.info('IPC:Notes', `${channel} started`, context)
  try {
    const result = await handler()
    appLogger.info('IPC:Notes', `${channel} succeeded`, {
      durationMs: Date.now() - startedAt,
      ...context
    })
    return result
  } catch (error) {
    appLogger.error('IPC:Notes', `${channel} failed`, {
      durationMs: Date.now() - startedAt,
      ...context,
      error
    })
    throw error
  }
}

ipcMain.handle('notes:addEntry', async (_, stockCode: string, data: {
  content: string
  title?: string
  eventTime?: Date | string
  category?: NoteCategory
  operationTag?: OperationTag
  trackingStatus?: string
  viewpoint?: Viewpoint
  action?: Action
  inputType?: NoteInputType
  audioFile?: string
  audioDuration?: number
}): Promise<TimeEntry> => {
  return withIpcLog(
    'notes:addEntry',
    { stockCode, category: data.category, inputType: data.inputType },
    () => notesAppService.addEntry(stockCode, data)
  )
})

ipcMain.handle('notes:getStockNote', async (_, stockCode: string): Promise<StockNote | null> => {
  return withIpcLog(
    'notes:getStockNote',
    { stockCode },
    () => notesAppService.getStockNote(stockCode)
  )
})

ipcMain.handle('notes:getEntries', async (_, stockCode: string): Promise<TimeEntry[]> => {
  return withIpcLog(
    'notes:getEntries',
    { stockCode },
    () => notesAppService.getEntries(stockCode)
  )
})

ipcMain.handle('notes:getEntriesByTimeRange', async (_, stockCode: string, start: Date, end: Date): Promise<TimeEntry[]> => {
  return withIpcLog(
    'notes:getEntriesByTimeRange',
    {
      stockCode,
      start: start instanceof Date ? start.toISOString() : start,
      end: end instanceof Date ? end.toISOString() : end
    },
    () => notesAppService.getEntriesByTimeRange(stockCode, start, end)
  )
})

ipcMain.handle('notes:updateEntry', async (_, stockCode: string, entryId: string, data: Partial<TimeEntry>): Promise<TimeEntry> => {
  return withIpcLog(
    'notes:updateEntry',
    { stockCode, entryId },
    () => notesAppService.updateEntry(stockCode, entryId, data)
  )
})

ipcMain.handle('notes:deleteEntry', async (_, stockCode: string, entryId: string): Promise<void> => {
  return withIpcLog(
    'notes:deleteEntry',
    { stockCode, entryId },
    () => notesAppService.deleteEntry(stockCode, entryId)
  )
})

ipcMain.handle('notes:getTimeline', async (_, filters?: {
  stockCode?: string
  startDate?: Date
  endDate?: Date
  viewpoint?: string
  category?: NoteCategory
}): Promise<TimelineItem[]> => {
  return withIpcLog(
    'notes:getTimeline',
    {
      stockCode: filters?.stockCode,
      category: filters?.category,
      hasRange: Boolean(filters?.startDate || filters?.endDate)
    },
    () => notesAppService.getTimeline(filters)
  )
})

ipcMain.handle('notes:getStockSummaries', async (): Promise<StockNoteSummary[]> => {
  return withIpcLog(
    'notes:getStockSummaries',
    {},
    () => notesAppService.getStockSummaries()
  )
})

ipcMain.handle('notes:exportStock', async (_, stockCode: string, outputDir: string): Promise<NotesExportResult> => {
  return withIpcLog(
    'notes:exportStock',
    { stockCode, outputDir },
    () => notesAppService.exportStockNote(stockCode, outputDir)
  )
})

ipcMain.handle('notes:exportAll', async (_, outputDir: string): Promise<NotesExportResult> => {
  return withIpcLog(
    'notes:exportAll',
    { outputDir },
    () => notesAppService.exportAllNotes(outputDir)
  )
})

ipcMain.handle('notes:importFromDirectory', async (_, sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> => {
  return withIpcLog(
    'notes:importFromDirectory',
    { sourceDir, mode },
    () => notesAppService.importNotesFromDirectory(sourceDir, mode)
  )
})
