import { contextBridge, ipcRenderer } from 'electron'
import type {
  NotesExportResult,
  NotesImportResult,
  ReviewEvaluateRequest,
  ReviewEvaluateResponse,
  ReviewSnapshotRequest,
  ReviewSnapshotResponse,
  UserSettings
} from '../shared/types'

interface VoiceCommandResult {
  success: boolean
  error?: string
}

interface VoiceStatus {
  isConnected: boolean
  isRunning: boolean
}

interface VoiceTranscribeResult extends VoiceCommandResult {
  text?: string | null
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  textAnalysis: {
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.7-highspeed',
    apiKey: ''
  },
  cloudASR: {
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'speech-01',
    apiKey: '',
    language: 'zh-CN'
  },
  notes: {
    defaultCategory: '看盘预测',
    defaultDirection: '未知',
    defaultTimeHorizon: '短线',
    style: '轻量'
  }
}

const isMissingHandlerError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes('No handler registered')

const api = {
  notes: {
    addEntry: (stockCode: string, data: any) => 
      ipcRenderer.invoke('notes:addEntry', stockCode, data),
    getStockNote: (stockCode: string) => 
      ipcRenderer.invoke('notes:getStockNote', stockCode),
    getEntries: (stockCode: string) => 
      ipcRenderer.invoke('notes:getEntries', stockCode),
    getEntriesByTimeRange: (stockCode: string, start: Date, end: Date) => 
      ipcRenderer.invoke('notes:getEntriesByTimeRange', stockCode, start, end),
    updateEntry: (stockCode: string, entryId: string, data: any) => 
      ipcRenderer.invoke('notes:updateEntry', stockCode, entryId, data),
    deleteEntry: (stockCode: string, entryId: string) => 
      ipcRenderer.invoke('notes:deleteEntry', stockCode, entryId),
    getTimeline: (filters?: any) => 
      ipcRenderer.invoke('notes:getTimeline', filters),
    exportStock: (stockCode: string, outputDir: string): Promise<NotesExportResult> =>
      ipcRenderer.invoke('notes:exportStock', stockCode, outputDir),
    exportAll: (outputDir: string): Promise<NotesExportResult> =>
      ipcRenderer.invoke('notes:exportAll', outputDir),
    importFromDirectory: (sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> =>
      ipcRenderer.invoke('notes:importFromDirectory', sourceDir, mode),
  },
  
  ai: {
    extract: (text: string) => ipcRenderer.invoke('ai:extract', text),
    optimizeText: (text: string) => ipcRenderer.invoke('ai:optimize', text),
  },
  
  voice: {
    start: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:start'),
    stop: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:stop'),
    status: (): Promise<VoiceStatus> => ipcRenderer.invoke('voice:status'),
    startRecording: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:startRecording'),
    stopRecording: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:stopRecording'),
    transcribeFile: (audioPath: string) => 
      ipcRenderer.invoke('voice:transcribeFile', audioPath) as Promise<VoiceTranscribeResult>,
    transcribeWithCloud: (audioPath: string) =>
      ipcRenderer.invoke('voice:transcribeWithCloud', audioPath) as Promise<VoiceTranscribeResult>,
    onTranscript: (callback: (text: string, isFinal: boolean) => void) => {
      const handler = (_: any, text: string, isFinal: boolean) => callback(text, isFinal)
      ipcRenderer.on('voice:transcript', handler)
      return () => ipcRenderer.removeListener('voice:transcript', handler)
    },
    onAudioSaved: (callback: (path: string) => void) => {
      const handler = (_: any, path: string) => callback(path)
      ipcRenderer.on('voice:audio_saved', handler)
      return () => ipcRenderer.removeListener('voice:audio_saved', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: any, error: string) => callback(error)
      ipcRenderer.on('voice:error', handler)
      return () => ipcRenderer.removeListener('voice:error', handler)
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('voice:transcript')
      ipcRenderer.removeAllListeners('voice:audio_saved')
      ipcRenderer.removeAllListeners('voice:error')
    }
  },
  
  audio: {
    saveRecording: (buffer: ArrayBuffer, filename: string) => 
      ipcRenderer.invoke('audio:saveRecording', buffer, filename),
  },
  
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    getAll: async (): Promise<UserSettings> => {
      try {
        return await ipcRenderer.invoke('config:getAll')
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] config:getAll handler missing, using default settings')
          return JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))
        }
        throw error
      }
    },
    set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
    update: (partial: Partial<UserSettings>) => ipcRenderer.invoke('config:update', partial) as Promise<UserSettings>,
  },

  watchlist: {
    get: async () => {
      try {
        return await ipcRenderer.invoke('watchlist:get')
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] watchlist:get handler missing, returning empty list')
          return []
        }
        throw error
      }
    },
    getCodes: async (): Promise<string[]> => {
      try {
        return await ipcRenderer.invoke('watchlist:getCodes')
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] watchlist:getCodes handler missing, returning empty list')
          return []
        }
        throw error
      }
    },
    import: (rawInput: string, mode: 'append' | 'replace' = 'append') =>
      ipcRenderer.invoke('watchlist:import', rawInput, mode),
    clear: () => ipcRenderer.invoke('watchlist:clear') as Promise<boolean>
  },

  stock: {
    search: (query: string, limit?: number) => ipcRenderer.invoke('stock:search', query, limit),
    getByCode: (code: string) => ipcRenderer.invoke('stock:getByCode', code),
    getByName: (name: string) => ipcRenderer.invoke('stock:getByName', name),
    match: (text: string) => ipcRenderer.invoke('stock:match', text),
  },

  review: {
    getSnapshot: (request: ReviewSnapshotRequest): Promise<ReviewSnapshotResponse> =>
      ipcRenderer.invoke('review:getSnapshot', request),
    evaluate: (request: ReviewEvaluateRequest): Promise<ReviewEvaluateResponse> =>
      ipcRenderer.invoke('review:evaluate', request),
  },

  system: {
    pickDirectory: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('system:pickDirectory', defaultPath)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
