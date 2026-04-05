import { ipcMain } from 'electron'
import { notesAppService } from '../application/container'
import type {
  TimelineExplorerFilters,
  TimelineExplorerResponse
} from '../../shared/types'

ipcMain.handle('timeline:queryExplorer', async (_, filters?: TimelineExplorerFilters): Promise<TimelineExplorerResponse> => {
  return notesAppService.getTimelineExplorer(filters)
})
