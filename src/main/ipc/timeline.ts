import { ipcMain } from 'electron'
import { notesAppService } from '../application/container'
import type {
  TimeEntry,
  TimelineExplorerFilters,
  TimelineExplorerResponse,
  TrackingStatus
} from '../../shared/types'

ipcMain.handle('timeline:queryExplorer', async (_, filters?: TimelineExplorerFilters): Promise<TimelineExplorerResponse> => {
  return notesAppService.getTimelineExplorer(filters)
})

ipcMain.handle('timeline:updateLatestTrackingStatus', async (_, stockCode: string, trackingStatus?: TrackingStatus): Promise<TimeEntry> => {
  return notesAppService.updateLatestTrackingStatus(stockCode, trackingStatus)
})
