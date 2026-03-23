export type ViewpointDirection = '看多' | '看空' | '未知' | '中性' | '观望'
export type TimeHorizon = '短线' | '中线' | '长线'
export type NoteInputType = 'voice' | 'manual'

export interface TimeEntry {
  id: string
  timestamp: Date
  eventTime: Date
  createdAt: Date
  inputType?: NoteInputType
  title: string
  content: string
  
  viewpoint?: Viewpoint
  action?: Action
  keywords: string[]
  
  audioFile?: string
  audioDuration?: number
  
  aiProcessed: boolean
  transcriptionConfidence?: number
}

export interface Viewpoint {
  direction: ViewpointDirection
  confidence: number
  timeHorizon: TimeHorizon
}

export interface ViewpointResult extends Viewpoint {
  reasoning: string
  keyFactors: string[]
}

export interface Action {
  type: '买入' | '卖出' | '持有' | '观望'
  price?: number
  quantity?: number
  reason?: string
}

export interface StockNote {
  stockCode: string
  stockName: string
  market: 'SH' | 'SZ' | 'BJ'
  industry?: string
  sector?: string
  
  createdAt: Date
  updatedAt: Date
  
  totalEntries: number
  totalAudioDuration: number
  
  entries: TimeEntry[]
}

export interface Stock {
  code: string
  name: string
  market: 'SH' | 'SZ' | 'BJ'
  industry?: string
  sector?: string
}

export interface AIMode {
  current: 'local' | 'cloud' | 'auto'
  forced: boolean
}

export interface AIProvider {
  id: string
  name: string
  enabled: boolean
  priority: number
  model: string
}

export interface HealthStatus {
  available: boolean
  latency?: number
  error?: string
  lastChecked: Date
}

export interface TranscribeResult {
  text: string
  segments?: TranscriptSegment[]
  confidence: number
  processingTime: number
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface OptimizeResult {
  original: string
  optimized: string
  changes: TextChange[]
  tokenUsage?: TokenUsage
}

export interface TextChange {
  type: 'add' | 'remove' | 'modify'
  position: number
  oldText?: string
  newText?: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost?: number
}

export interface BudgetStatus {
  used: number
  remaining: number
  usedPercent: number
  periodStart: Date
  periodEnd: Date
}

export interface AppConfig {
  ai: {
    mode: 'local' | 'cloud' | 'auto'
    local: {
      asrEngine: 'whisper-cpp' | 'faster-whisper'
      llmEngine: 'ollama'
      model: string
    }
    cloud: {
      defaultProvider: string
      providers: AIProvider[]
    }
  }
  storage: {
    notesDir: string
    audioFormat: string
    keepOriginalAudio: boolean
  }
  ui: {
    theme: 'light' | 'dark'
    timelineScale: string
  }
}

export interface TimelineItem {
  id: string
  stockCode: string
  stockName: string
  timestamp: Date
  title: string
  viewpoint?: Viewpoint
  hasAudio: boolean
}

export interface IAIService {
  readonly provider: string
  readonly mode: 'local' | 'cloud'

  initialize(): Promise<void>
  isAvailable(): Promise<boolean>
  getHealthStatus(): Promise<HealthStatus>

  transcribe(audioPath: string): Promise<TranscribeResult>
  optimizeText(text: string): Promise<OptimizeResult>
  extractViewpoint(text: string): Promise<ViewpointResult>
  summarize(text: string): Promise<string>
}

export interface StockInfo {
  code: string
  name: string
  market: 'SH' | 'SZ' | 'BJ'
  industry?: string
  sector?: string
  pinyin?: string
  pinyinShort?: string
}

export interface SearchResult {
  stock: StockInfo
  matchType: 'code' | 'name' | 'pinyin' | 'pinyinShort'
  score: number
}

export interface TopicConfig {
  id: string
  name: string
  description?: string
  icon?: string
}

export interface TopicDetectionResult {
  detected: boolean
  topicId?: string
  confidence: number
  suggestions?: string[]
}

export interface CalibrationResult {
  isValid: boolean
  confidence: number
  score: number
  suggestions: string[]
}
