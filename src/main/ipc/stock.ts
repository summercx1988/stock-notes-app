import { ipcMain } from 'electron'
import { stockDatabase, type StockInfo, type SearchResult } from '../services/stock-db'
import { AIProcessor, type AIExtractResult } from '../services/ai-processor'
import { voiceTranscriberClient } from '../services/VoiceTranscriberClient'
import { openAIWhisperService } from '../services/OpenAIWhisper'

const aiProcessor = new AIProcessor()

const cleanTranscriptText = (text: string): string => {
  const withoutTimestamps = text.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, ' ')
  return withoutTimestamps
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：])/g, '$1')
    .trim()
}

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
    
    if (!status.isRunning || !status.isConnected) {
      console.log('[IPC] Starting or reconnecting voice service...')
      await voiceTranscriberClient.start()
      console.log('[IPC] Voice service started, status:', voiceTranscriberClient.getStatus())
    }

    return { success: true }
  } catch (error: any) {
    console.error('[IPC] voice:start error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('voice:stop', async () => {
  console.log('[IPC] voice:stop')

  try {
    await voiceTranscriberClient.stop()
    return { success: true }
  } catch (error: any) {
    console.error('[IPC] voice:stop error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('voice:startRecording', async () => {
  console.log('[IPC] voice:startRecording')

  try {
    const status = voiceTranscriberClient.getStatus()
    if (!status.isRunning || !status.isConnected) {
      await voiceTranscriberClient.start()
    }

    voiceTranscriberClient.startRecording()
    return { success: true }
  } catch (error: any) {
    console.error('[IPC] voice:startRecording error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('voice:stopRecording', async () => {
  console.log('[IPC] voice:stopRecording')

  try {
    voiceTranscriberClient.stopRecording()
    return { success: true }
  } catch (error: any) {
    console.error('[IPC] voice:stopRecording error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('voice:status', async () => {
  const status = voiceTranscriberClient.getStatus()
  console.log('[IPC] voice:status:', status)
  return status
})

ipcMain.handle('voice:transcribeFile', async (_, audioPath: string) => {
  console.log('[IPC] voice:transcribeFile:', audioPath)

  try {
    const status = voiceTranscriberClient.getStatus()
    if (!status.isRunning || !status.isConnected) {
      await voiceTranscriberClient.start()
    }

    const text = await voiceTranscriberClient.transcribeFile(audioPath)
    return { success: true, text: cleanTranscriptText(text) }
  } catch (error: any) {
    console.error('[IPC] voice:transcribeFile error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('voice:transcribeWithCloud', async (_, audioPath: string) => {
  console.log('[IPC] voice:transcribeWithCloud:', audioPath)
  try {
    const result = await openAIWhisperService.transcribe(audioPath)
    const cleaned = cleanTranscriptText(result || '')
    console.log('[IPC] voice:transcribeWithCloud result:', cleaned?.substring(0, 100))
    return { success: true, text: cleaned }
  } catch (error: any) {
    console.error('[IPC] voice:transcribeWithCloud error:', error)
    return { success: false, error: error.message }
  }
})
