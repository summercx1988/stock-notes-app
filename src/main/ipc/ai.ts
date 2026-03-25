import { ipcMain } from 'electron'
import { AIService } from '../services/ai'
import type { TranscribeResult, OptimizeResult, ViewpointResult } from '../../shared/types'

const aiService = new AIService()

ipcMain.handle('ai:transcribe', async (_, audioPath: string): Promise<TranscribeResult> => {
  return aiService.transcribe(audioPath)
})

ipcMain.handle('ai:optimizeText', async (_, text: string): Promise<OptimizeResult> => {
  return aiService.optimizeText(text)
})

ipcMain.handle('ai:extractViewpoint', async (_, text: string): Promise<ViewpointResult> => {
  return aiService.extractViewpoint(text)
})

ipcMain.handle('ai:summarize', async (_, text: string): Promise<string> => {
  return aiService.summarize(text)
})
