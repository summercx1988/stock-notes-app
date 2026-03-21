import { ipcMain } from 'electron'
import { stockDatabase, type StockInfo, type SearchResult } from '../services/stock-db'
import { AIProcessor, type AIExtractResult } from '../services/ai-processor'
import { voiceTranscriberClient } from '../services/VoiceTranscriberClient'
import { openAIWhisperService } from '../services/OpenAIWhisper'

const aiProcessor = new AIProcessor()

ipcMain.handle('stock:search', async (_, query: string, limit?: number): Promise<SearchResult[]> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.search(query, limit)
})

ipcMain.handle('stock:getByCode', async (_, code: string): Promise<StockInfo | null> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.getByCode(code) || null
})

ipcMain.handle('stock:getByName', async (_, name: string): Promise<StockInfo | null> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.getByName(name) || null
})

ipcMain.handle('stock:match', async (_, text: string): Promise<SearchResult | null> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.matchStock(text)
})

ipcMain.handle('ai:extract', async (_, text: string): Promise<AIExtractResult> => {
  console.log('[IPC] ai:extract called with:', text.substring(0, 100))
  const result = await aiProcessor.extract(text)
  console.log('[IPC] ai:extract result:', result.stock?.code, result.stock?.name)
  return result
})

ipcMain.handle('voice:start', async () => {
  console.log('[IPC] voice:start')
  
  try {
    const status = voiceTranscriberClient.getStatus()
    console.log('[IPC] Current status:', status)
    
    if (!status.isRunning) {
      console.log('[IPC] Starting voice service...')
      await voiceTranscriberClient.start()
      console.log('[IPC] Voice service started, status:', voiceTranscriberClient.getStatus())
    }
    
    voiceTranscriberClient.startRecording()
    console.log('[IPC] Recording started')
    return { success: true }
  } catch (error: any) {
    console.error('[IPC] voice:start error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('voice:stop', async () => {
  console.log('[IPC] voice:stop')
  voiceTranscriberClient.stopRecording()
  return { success: true }
})

ipcMain.handle('voice:startRecording', async () => {
  console.log('[IPC] voice:startRecording')
  voiceTranscriberClient.startRecording()
  return { success: true }
})

ipcMain.handle('voice:stopRecording', async () => {
  console.log('[IPC] voice:stopRecording')
  voiceTranscriberClient.stopRecording()
  return { success: true }
})

ipcMain.handle('voice:status', async () => {
  const status = voiceTranscriberClient.getStatus()
  console.log('[IPC] voice:status:', status)
  return status
})

ipcMain.handle('voice:transcribeFile', async (_, audioPath: string) => {
  console.log('[IPC] voice:transcribeFile:', audioPath)
  voiceTranscriberClient.transcribeFile(audioPath)
  return { success: true }
})

ipcMain.handle('voice:transcribeWithCloud', async (_, audioPath: string) => {
  console.log('[IPC] voice:transcribeWithCloud:', audioPath)
  try {
    const result = await openAIWhisperService.transcribe(audioPath)
    console.log('[IPC] voice:transcribeWithCloud result:', result?.substring(0, 100))
    return { success: true, text: result }
  } catch (error: any) {
    console.error('[IPC] voice:transcribeWithCloud error:', error)
    return { success: false, error: error.message }
  }
})
