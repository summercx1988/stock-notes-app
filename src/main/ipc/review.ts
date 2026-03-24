import { ipcMain } from 'electron'
import { notesAppService } from '../application/container'
import type {
  ReviewEvaluateRequest,
  ReviewEvaluateResponse,
  ReviewSnapshotRequest,
  ReviewSnapshotResponse
} from '../../shared/types'

ipcMain.handle('review:getSnapshot', async (_, request: ReviewSnapshotRequest): Promise<ReviewSnapshotResponse> => {
  return notesAppService.getReviewSnapshot(request)
})

ipcMain.handle('review:evaluate', async (_, request: ReviewEvaluateRequest): Promise<ReviewEvaluateResponse> => {
  return notesAppService.getReviewEvaluation(request)
})
