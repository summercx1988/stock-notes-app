import { ipcMain } from 'electron'
import { notesAppService } from '../application/container'
import type { ReviewSnapshotRequest, ReviewSnapshotResponse } from '../../shared/types'

ipcMain.handle('review:getSnapshot', async (_, request: ReviewSnapshotRequest): Promise<ReviewSnapshotResponse> => {
  return notesAppService.getReviewSnapshot(request)
})
