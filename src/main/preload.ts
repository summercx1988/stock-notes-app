import { contextBridge, ipcRenderer } from 'electron'
import type {
  NotesExportResult,
  NotesImportResult,
  ReviewEvaluateRequest,
  ReviewEvaluateResponse,
  ReviewSnapshotRequest,
  ReviewSnapshotResponse,
  ReviewVisualRequest,
  ReviewVisualResponse,
  TimelineExplorerFilters,
  TimelineExplorerResponse,
  UserSettings,
  FeishuStatus,
  NotesChangedEvent,
  VoiceServiceStatus
} from '../shared/types'

interface VoiceCommandResult {
  success: boolean
  error?: string
}

interface VoiceTranscribeResult extends VoiceCommandResult {
  text?: string | null
}

const api = {
  notes: {
    addEntry: (stockCode: string, data: unknown) =>
      ipcRenderer.invoke('notes:addEntry', stockCode, data),
    getStockNote: (stockCode: string) =>
      ipcRenderer.invoke('notes:getStockNote', stockCode),
    getEntries: (stockCode: string) =>
      ipcRenderer.invoke('notes:getEntries', stockCode),
    getEntriesByTimeRange: (stockCode: string, start: Date, end: Date) =>
      ipcRenderer.invoke('notes:getEntriesByTimeRange', stockCode, start, end),
    updateEntry: (stockCode: string, entryId: string, data: unknown) =>
      ipcRenderer.invoke('notes:updateEntry', stockCode, entryId, data),
    deleteEntry: (stockCode: string, entryId: string) =>
      ipcRenderer.invoke('notes:deleteEntry', stockCode, entryId),
    getTimeline: (filters?: unknown) =>
      ipcRenderer.invoke('notes:getTimeline', filters),
    exportStock: (stockCode: string, outputDir: string): Promise<NotesExportResult> =>
      ipcRenderer.invoke('notes:exportStock', stockCode, outputDir),
    exportAll: (outputDir: string): Promise<NotesExportResult> =>
      ipcRenderer.invoke('notes:exportAll', outputDir),
    importFromDirectory: (sourceDir: string, mode: 'skip' | 'replace' = 'skip'): Promise<NotesImportResult> =>
      ipcRenderer.invoke('notes:importFromDirectory', sourceDir, mode),
    onChanged: (callback: (event: NotesChangedEvent) => void) => {
      const handler = (_: unknown, event: NotesChangedEvent) => callback(event)
      ipcRenderer.on('notes:changed', handler)
      return () => ipcRenderer.removeListener('notes:changed', handler)
    }
  },

  ai: {
    extract: (text: string) => ipcRenderer.invoke('ai:extract', text),
    extractFast: (text: string) => ipcRenderer.invoke('ai:extractFast', text),
    optimizeText: (text: string) => ipcRenderer.invoke('ai:optimize', text),
  },

  voice: {
    start: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:start'),
    stop: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:stop'),
    status: (): Promise<VoiceServiceStatus> => ipcRenderer.invoke('voice:status'),
    startRecording: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:startRecording'),
    stopRecording: (): Promise<VoiceCommandResult> => ipcRenderer.invoke('voice:stopRecording'),
    transcribeFile: (audioPath: string) =>
      ipcRenderer.invoke('voice:transcribeFile', audioPath) as Promise<VoiceTranscribeResult>,
    transcribeWithCloud: (audioPath: string) =>
      ipcRenderer.invoke('voice:transcribeWithCloud', audioPath) as Promise<VoiceTranscribeResult>,
    onTranscript: (callback: (text: string, isFinal: boolean) => void) => {
      const handler = (_: unknown, text: string, isFinal: boolean) => callback(text, isFinal)
      ipcRenderer.on('voice:transcript', handler)
      return () => ipcRenderer.removeListener('voice:transcript', handler)
    },
    onAudioSaved: (callback: (path: string) => void) => {
      const handler = (_: unknown, path: string) => callback(path)
      ipcRenderer.on('voice:audio_saved', handler)
      return () => ipcRenderer.removeListener('voice:audio_saved', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_: unknown, error: string) => callback(error)
      ipcRenderer.on('voice:error', handler)
      return () => ipcRenderer.removeListener('voice:error', handler)
    },
    onStatus: (callback: (status: VoiceServiceStatus) => void) => {
      const handler = (_: unknown, status: VoiceServiceStatus) => callback(status)
      ipcRenderer.on('voice:status', handler)
      return () => ipcRenderer.removeListener('voice:status', handler)
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners('voice:transcript')
      ipcRenderer.removeAllListeners('voice:audio_saved')
      ipcRenderer.removeAllListeners('voice:error')
      ipcRenderer.removeAllListeners('voice:status')
    }
  },

  audio: {
    saveRecording: (buffer: ArrayBuffer, filename: string) =>
      ipcRenderer.invoke('audio:saveRecording', buffer, filename),
  },

  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    getAll: (): Promise<UserSettings> => ipcRenderer.invoke('config:getAll'),
    set: (key: string, value: unknown): Promise<UserSettings> =>
      ipcRenderer.invoke('config:set', key, value),
    update: (partial: Partial<UserSettings>): Promise<UserSettings> =>
      ipcRenderer.invoke('config:update', partial),
  },

  watchlist: {
    get: () => ipcRenderer.invoke('watchlist:get'),
    getCodes: (): Promise<string[]> => ipcRenderer.invoke('watchlist:getCodes'),
    import: (rawInput: string, mode: 'append' | 'replace' = 'append') =>
      ipcRenderer.invoke('watchlist:import', rawInput, mode),
    clear: () => ipcRenderer.invoke('watchlist:clear') as Promise<boolean>
  },

  stock: {
    search: (query: string, limit?: number) => ipcRenderer.invoke('stock:search', query, limit),
    getByCode: (code: string) => ipcRenderer.invoke('stock:getByCode', code),
    getByCodes: (codes: string[]) => ipcRenderer.invoke('stock:getByCodes', codes),
    getByName: (name: string) => ipcRenderer.invoke('stock:getByName', name),
    match: (text: string) => ipcRenderer.invoke('stock:match', text),
  },

  review: {
    getSnapshot: (request: ReviewSnapshotRequest): Promise<ReviewSnapshotResponse> =>
      ipcRenderer.invoke('review:getSnapshot', request),
    evaluate: (request: ReviewEvaluateRequest): Promise<ReviewEvaluateResponse> =>
      ipcRenderer.invoke('review:evaluate', request),
    getVisualData: (request: ReviewVisualRequest): Promise<ReviewVisualResponse> =>
      ipcRenderer.invoke('review:getVisualData', request),
  },

  timeline: {
    queryExplorer: (filters?: TimelineExplorerFilters): Promise<TimelineExplorerResponse> =>
      ipcRenderer.invoke('timeline:queryExplorer', filters),
    updateLatestTrackingStatus: (stockCode: string, trackingStatus?: string) =>
      ipcRenderer.invoke('timeline:updateLatestTrackingStatus', stockCode, trackingStatus)
  },

  system: {
    pickDirectory: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('system:pickDirectory', defaultPath)
  },

  feishu: {
    setEnabled: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('feishu:setEnabled', enabled),
    getStatus: (): Promise<FeishuStatus> =>
      ipcRenderer.invoke('feishu:getStatus'),
    testConnection: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('feishu:testConnection'),
    onStatusChanged: (callback: (status: FeishuStatus) => void) => {
      const handler = (_: unknown, status: FeishuStatus) => callback(status)
      ipcRenderer.on('feishu:statusChanged', handler)
      return () => ipcRenderer.removeListener('feishu:statusChanged', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
