import { create } from 'zustand'
import type { StockNote, TimeEntry, Stock, AIMode, HealthStatus, TimelineItem, SearchResult } from '../../shared/types'

export type RecordingStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'error'
export type AppModule = 'notes' | 'timeline' | 'review'

interface RecordingState {
  status: RecordingStatus
  duration: number
  error?: string
  currentStockCode?: string
  currentStockName?: string
}

interface AppState {
  stockNotes: Map<string, StockNote>
  currentStockCode: string | null
  currentStockName: string | null
  currentEntry: TimeEntry | null
  timeline: TimelineItem[]
  stocks: Stock[]
  aiMode: AIMode
  aiHealth: { local: HealthStatus; cloud: HealthStatus } | null
  darkMode: boolean
  loading: boolean
  activeModule: AppModule

  recording: RecordingState
  searchResults: SearchResult[]
  isSearching: boolean

  setStockNote: (stockCode: string, note: StockNote) => void
  getStockNote: (stockCode: string) => StockNote | undefined
  setCurrentStock: (code: string | null, name?: string | null) => void
  setCurrentEntry: (entry: TimeEntry | null) => void
  setTimeline: (items: TimelineItem[]) => void
  setStocks: (stocks: Stock[]) => void
  setAIMode: (mode: AIMode) => void
  setAIHealth: (health: { local: HealthStatus; cloud: HealthStatus }) => void
  setDarkMode: (dark: boolean) => void
  setLoading: (loading: boolean) => void
  setActiveModule: (module: AppModule) => void

  setRecordingStatus: (status: RecordingStatus) => void
  setRecordingDuration: (duration: number) => void
  setRecordingError: (error?: string) => void
  setRecordingStock: (code?: string, name?: string) => void
  resetRecording: () => void

  setSearchResults: (results: SearchResult[]) => void
  setIsSearching: (searching: boolean) => void
  clearSearchResults: () => void
}

const initialRecordingState: RecordingState = {
  status: 'idle',
  duration: 0
}

export const useAppStore = create<AppState>((set, get) => ({
  stockNotes: new Map(),
  currentStockCode: null,
  currentStockName: null,
  currentEntry: null,
  timeline: [],
  stocks: [],
  aiMode: { current: 'cloud', forced: false },
  aiHealth: null,
  darkMode: false,
  loading: false,
  activeModule: 'notes',

  recording: initialRecordingState,
  searchResults: [],
  isSearching: false,

  setStockNote: (stockCode, note) => set((state) => {
    const newMap = new Map(state.stockNotes)
    newMap.set(stockCode, note)
    return { stockNotes: newMap }
  }),

  getStockNote: (stockCode) => get().stockNotes.get(stockCode),

  setCurrentStock: (code, name = null) => set({
    currentStockCode: code,
    currentStockName: name
  }),

  setCurrentEntry: (entry) => set({ currentEntry: entry }),

  setTimeline: (items) => set({ timeline: items }),

  setStocks: (stocks) => set({ stocks }),

  setAIMode: (mode) => set({ aiMode: mode }),

  setAIHealth: (health) => set({ aiHealth: health }),

  setDarkMode: (dark) => set({ darkMode: dark }),

  setLoading: (loading) => set({ loading }),

  setActiveModule: (module) => set({ activeModule: module }),

  setRecordingStatus: (status) => set((state) => ({
    recording: { ...state.recording, status }
  })),

  setRecordingDuration: (duration) => set((state) => ({
    recording: { ...state.recording, duration }
  })),

  setRecordingError: (error) => set((state) => ({
    recording: { ...state.recording, error }
  })),

  setRecordingStock: (code, name) => set((state) => ({
    recording: {
      ...state.recording,
      currentStockCode: code,
      currentStockName: name
    }
  })),

  resetRecording: () => set({ recording: initialRecordingState }),

  setSearchResults: (results) => set({ searchResults: results }),

  setIsSearching: (searching) => set({ isSearching: searching }),

  clearSearchResults: () => set({ searchResults: [] }),
}))
