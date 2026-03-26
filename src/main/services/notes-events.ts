import { BrowserWindow } from 'electron'
import type { NotesChangedEvent } from '../../shared/types'

export function notifyNotesChanged(event: NotesChangedEvent): void {
  try {
    const windows = BrowserWindow?.getAllWindows?.() || []
    for (const win of windows) {
      win.webContents.send('notes:changed', event)
    }
  } catch (error) {
    console.error('[NotesEvents] Failed to notify renderer:', error)
  }
}
