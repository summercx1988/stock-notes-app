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
import { DEFAULT_NOTE_CATEGORY_CONFIGS, normalizeNoteCategoryConfigs } from '../shared/note-categories'

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
    style: '轻量',
    categoryConfigs: DEFAULT_NOTE_CATEGORY_CONFIGS
  }
}

const isMissingHandlerError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes('No handler registered')

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
let fallbackSettings: UserSettings = deepClone(DEFAULT_USER_SETTINGS)

const deepMerge = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue
    const baseValue = result[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(baseValue as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

const setByPath = (target: Record<string, unknown>, key: string, value: unknown): void => {
  const segments = key.split('.').filter(Boolean)
  let current: Record<string, unknown> = target
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const isLeaf = index === segments.length - 1
    if (isLeaf) {
      current[segment] = value
      return
    }
    const existing = current[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
}

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
    get: async (key: string) => {
      try {
        return await ipcRenderer.invoke('config:get', key)
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] config:get handler missing, reading fallback settings')
          if (!key || !key.trim()) {
            return deepClone(fallbackSettings)
          }
          return key.split('.').reduce<unknown>((value, segment) => {
            if (value && typeof value === 'object') {
              return (value as Record<string, unknown>)[segment]
            }
            return undefined
          }, fallbackSettings as unknown as Record<string, unknown>)
        }
        throw error
      }
    },
    getAll: async (): Promise<UserSettings> => {
      try {
        const settings = await ipcRenderer.invoke('config:getAll')
        settings.notes.categoryConfigs = normalizeNoteCategoryConfigs(settings.notes.categoryConfigs)
        fallbackSettings = deepClone(settings)
        return settings
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] config:getAll handler missing, using default settings')
          const defaults = deepClone(fallbackSettings)
          defaults.notes.categoryConfigs = normalizeNoteCategoryConfigs(defaults.notes.categoryConfigs)
          return defaults
        }
        throw error
      }
    },
    set: async (key: string, value: any): Promise<UserSettings> => {
      try {
        const settings = await ipcRenderer.invoke('config:set', key, value)
        fallbackSettings = deepClone(settings)
        return settings
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] config:set handler missing, writing fallback settings only')
          const next = deepClone(fallbackSettings) as unknown as Record<string, unknown>
          setByPath(next, key, value)
          fallbackSettings = next as unknown as UserSettings
          fallbackSettings.notes.categoryConfigs = normalizeNoteCategoryConfigs(fallbackSettings.notes.categoryConfigs)
          return deepClone(fallbackSettings)
        }
        throw error
      }
    },
    update: async (partial: Partial<UserSettings>): Promise<UserSettings> => {
      try {
        const settings = await ipcRenderer.invoke('config:update', partial)
        fallbackSettings = deepClone(settings)
        return settings
      } catch (error) {
        if (isMissingHandlerError(error)) {
          console.warn('[preload] config:update handler missing, writing fallback settings only')
          fallbackSettings = deepMerge(
            fallbackSettings as unknown as Record<string, unknown>,
            partial as unknown as Record<string, unknown>
          ) as unknown as UserSettings
          fallbackSettings.notes.categoryConfigs = normalizeNoteCategoryConfigs(fallbackSettings.notes.categoryConfigs)
          return deepClone(fallbackSettings)
        }
        throw error
      }
    },
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
