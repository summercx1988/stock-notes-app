import { ipcMain } from 'electron'
import { AIService } from '../services/ai'
import type { TranscribeResult, OptimizeResult, ViewpointResult, HealthStatus } from '../../shared/types'

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

ipcMain.handle('ai:getMode', async () => {
  return aiService.getMode()
})

ipcMain.handle('ai:setMode', async (_, mode: 'local' | 'cloud' | 'auto') => {
  return aiService.setMode(mode)
})

ipcMain.handle('ai:getHealth', async (): Promise<{ local: HealthStatus; cloud: HealthStatus }> => {
  return aiService.getHealth()
})
