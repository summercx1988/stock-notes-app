import { ipcMain } from 'electron'
import path from 'path'
import { AIService } from '../services/ai'
import type { TranscribeResult, OptimizeResult, ViewpointResult } from '../../shared/types'
import { appLogger } from '../services/app-logger'

const aiService = new AIService()

const withIpcLog = async <T>(
  channel: string,
  context: Record<string, unknown>,
  handler: () => Promise<T>
): Promise<T> => {
  const startedAt = Date.now()
  appLogger.info('IPC:AI', `${channel} started`, context)
  try {
    const result = await handler()
    appLogger.info('IPC:AI', `${channel} succeeded`, {
      durationMs: Date.now() - startedAt,
      ...context
    })
    return result
  } catch (error) {
    appLogger.error('IPC:AI', `${channel} failed`, {
      durationMs: Date.now() - startedAt,
      ...context,
      error
    })
    throw error
  }
}

ipcMain.handle('ai:transcribe', async (_, audioPath: string): Promise<TranscribeResult> => {
  return withIpcLog(
    'ai:transcribe',
    { audioFile: path.basename(audioPath || '') },
    () => aiService.transcribe(audioPath)
  )
})

ipcMain.handle('ai:optimizeText', async (_, text: string): Promise<OptimizeResult> => {
  return withIpcLog(
    'ai:optimizeText',
    { textChars: String(text || '').length },
    () => aiService.optimizeText(text)
  )
})

ipcMain.handle('ai:extractViewpoint', async (_, text: string): Promise<ViewpointResult> => {
  return withIpcLog(
    'ai:extractViewpoint',
    { textChars: String(text || '').length },
    () => aiService.extractViewpoint(text)
  )
})

ipcMain.handle('ai:summarize', async (_, text: string): Promise<string> => {
  return withIpcLog(
    'ai:summarize',
    { textChars: String(text || '').length },
    () => aiService.summarize(text)
  )
})
