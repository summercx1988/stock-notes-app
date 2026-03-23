import { ipcMain } from 'electron'
import { NotesService } from '../services/notes'
import type { TimeEntry, StockNote, TimelineItem, Viewpoint, Action, NoteInputType } from '../../shared/types'

const notesService = new NotesService()

ipcMain.handle('notes:addEntry', async (_, stockCode: string, data: {
  content: string
  eventTime?: Date | string
  viewpoint?: Viewpoint
  action?: Action
  inputType?: NoteInputType
  audioFile?: string
  audioDuration?: number
}): Promise<TimeEntry> => {
  return notesService.addEntry(stockCode, data)
})

ipcMain.handle('notes:getStockNote', async (_, stockCode: string): Promise<StockNote | null> => {
  return notesService.getStockNote(stockCode)
})

ipcMain.handle('notes:getEntries', async (_, stockCode: string): Promise<TimeEntry[]> => {
  return notesService.getEntries(stockCode)
})

ipcMain.handle('notes:getEntriesByTimeRange', async (_, stockCode: string, start: Date, end: Date): Promise<TimeEntry[]> => {
  return notesService.getEntriesByTimeRange(stockCode, start, end)
})

ipcMain.handle('notes:updateEntry', async (_, stockCode: string, entryId: string, data: Partial<TimeEntry>): Promise<TimeEntry> => {
  return notesService.updateEntry(stockCode, entryId, data)
})

ipcMain.handle('notes:deleteEntry', async (_, stockCode: string, entryId: string): Promise<void> => {
  return notesService.deleteEntry(stockCode, entryId)
})

ipcMain.handle('notes:getTimeline', async (_, filters?: {
  stockCode?: string
  startDate?: Date
  endDate?: Date
  viewpoint?: string
}): Promise<TimelineItem[]> => {
  return notesService.getTimeline(filters)
})
