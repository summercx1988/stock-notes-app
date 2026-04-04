import { BrowserWindow } from 'electron'
import type { NotesChangedEvent } from '../../shared/types'
import { reviewGenerationStateService } from './review-generation-state'

const DAILY_REVIEW_STOCK_CODE = '__DAILY_REVIEW__'

export function notifyNotesChanged(event: NotesChangedEvent): void {
  try {
    if (event.stockCode && event.stockCode !== DAILY_REVIEW_STOCK_CODE) {
      void reviewGenerationStateService.markNotesUpdated()
    }
    const windows = BrowserWindow?.getAllWindows?.() || []
    for (const win of windows) {
      win.webContents.send('notes:changed', event)
    }
  } catch (error) {
    console.error('[NotesEvents] Failed to notify renderer:', error)
  }
}
