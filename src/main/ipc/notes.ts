import { ipcMain } from 'electron'
import { notesAppService } from '../application/container'
import type {
  TimeEntry,
  StockNote,
  TimelineItem,
  Viewpoint,
  Action,
  NoteInputType,
  NoteCategory,
  OperationTag,
  NotesExportResult,
  NotesImportResult
} from '../../shared/types'

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
  return notesAppService.addEntry(stockCode, data)
})

ipcMain.handle('notes:getStockNote', async (_, stockCode: string): Promise<StockNote | null> => {
  return notesAppService.getStockNote(stockCode)
})

ipcMain.handle('notes:getEntries', async (_, stockCode: string): Promise<TimeEntry[]> => {
  return notesAppService.getEntries(stockCode)
})

ipcMain.handle('notes:getEntriesByTimeRange', async (_, stockCode: string, start: Date, end: Date): Promise<TimeEntry[]> => {
  return notesAppService.getEntriesByTimeRange(stockCode, start, end)
})

ipcMain.handle('notes:updateEntry', async (_, stockCode: string, entryId: string, data: Partial<TimeEntry>): Promise<TimeEntry> => {
  return notesAppService.updateEntry(stockCode, entryId, data)
})

ipcMain.handle('notes:deleteEntry', async (_, stockCode: string, entryId: string): Promise<void> => {
  return notesAppService.deleteEntry(stockCode, entryId)
})

ipcMain.handle('notes:getTimeline', async (_, filters?: {
  stockCode?: string
  startDate?: Date
  endDate?: Date
  viewpoint?: string
  category?: NoteCategory
}): Promise<TimelineItem[]> => {
  return notesAppService.getTimeline(filters)
})

ipcMain.handle('notes:exportStock', async (_, stockCode: string, outputDir: string): Promise<NotesExportResult> => {
  return notesAppService.exportStockNote(stockCode, outputDir)
})

ipcMain.handle('notes:exportAll', async (_, outputDir: string): Promise<NotesExportResult> => {
  return notesAppService.exportAllNotes(outputDir)
})

ipcMain.handle('notes:importFromDirectory', async (_, sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> => {
  return notesAppService.importNotesFromDirectory(sourceDir, mode)
})
