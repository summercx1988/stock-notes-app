import { ipcMain } from 'electron'
import { AIProcessor, type AIExtractResult } from '../services/ai-processor'

const aiProcessor = new AIProcessor()

ipcMain.handle('ai:extract', async (_, text: string): Promise<AIExtractResult> => {
  console.log('[IPC] ai:extract called with:', text.substring(0, 100))
  const result = await aiProcessor.extract(text)
  console.log('[IPC] ai:extract result:', result.stock?.code, result.stock?.name)
  return result
})

ipcMain.handle('ai:extractFast', async (_, text: string): Promise<AIExtractResult> => {
  console.log('[IPC] ai:extractFast called with:', text.substring(0, 100))
  const result = await aiProcessor.extractForFeishu(text)
  console.log('[IPC] ai:extractFast result:', result.stock?.code, result.stock?.name)
  return result
})
