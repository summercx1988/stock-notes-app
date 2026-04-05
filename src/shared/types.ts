export type ViewpointDirection = string
export type TimeHorizon = string
export type NoteInputType = 'voice' | 'manual'
export type NoteCategory = string
export type OperationTag = string
export type TrackingStatus = string
export type NoteStyle = '轻量' | '结构化'

export interface EnumOptionConfig {
  code: string
  label: string
  enabled: boolean
  order: number
}

export interface NoteCategoryFieldConfig {
  enabled: boolean
  options: EnumOptionConfig[]
}

export interface NoteCategoryConfig {
  code: string
  label: string
  enabled: boolean
  reviewEligible: boolean
  builtIn?: boolean
  fields: {
    viewpoint: NoteCategoryFieldConfig
    operationTag: NoteCategoryFieldConfig
    timeHorizon: NoteCategoryFieldConfig
  }
}

export interface TimeEntry {
  id: string
  timestamp: Date
  eventTime: Date
  createdAt: Date
  inputType?: NoteInputType
  category: NoteCategory
  operationTag: OperationTag
  trackingStatus: TrackingStatus
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

export interface FeishuConfig {
  enabled: boolean
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

export interface FeishuStatus {
  enabled: boolean
  connected: boolean
  error?: string
}

export interface VoiceServiceStatus {
  isConnected: boolean
  isRunning: boolean
  isRecording: boolean
  duration: number
  memoryUsage: number
  lastError?: string
}

export interface DailyReviewReminderIncludeSections {
  yesterdaySummary: boolean
  pendingItems: boolean
  keyLevels: boolean
  watchlist: boolean
  riskReminders: boolean
}

export interface DailyReviewGenerationProgress {
  operation: 'daily-summary' | 'pre-market' | 'weekly' | 'regenerate' | 'collect-to-notes' | 'archive'
  stage: 'start' | 'collecting' | 'building-prompt' | 'ai-processing' | 'parsing' | 'saving' | 'processing' | 'completed' | 'error'
  progress: number
  message: string
  detail?: Record<string, unknown>
}

export interface DailyReviewGenerationStatus {
  notesLastUpdatedAt: string | null
  dailySummaryLastGeneratedAt: string | null
  dailySummaryLastGeneratedFromUpdatedAt: string | null
  hasPendingChanges: boolean
}

export interface DailyReviewReminderPayload {
  entry: TimeEntry
  includeSections: DailyReviewReminderIncludeSections
}

export interface DailyReviewSettings {
  enabled: boolean
  analysisLookbackDays: number
  analysisMaxItems: number
  reminder: {
    enabled: boolean
    time: string
    weekdaysOnly: boolean
    autoGeneratePreMarket: boolean
    includeSections: DailyReviewReminderIncludeSections
  }
}

export interface UserSettings {
  textAnalysis: {
    baseUrl: string
    model: string
    apiKey: string
  }
  cloudASR: {
    baseUrl: string
    model: string
    apiKey: string
    language: 'zh-CN' | 'zh'
  }
  notes: {
    defaultCategory: NoteCategory
    defaultDirection: ViewpointDirection
    defaultTimeHorizon: TimeHorizon
    style: NoteStyle
    categoryConfigs: NoteCategoryConfig[]
  }
  dailyReview: DailyReviewSettings
  feishu: FeishuConfig
}

export interface WatchlistImportResult {
  mode: 'append' | 'replace'
  totalCodes: number
  importedCodes: string[]
  duplicatedCodes: string[]
  invalidTokens: string[]
  knownStocks: number
}

export interface NotesExportResult {
  scope: 'single' | 'all'
  stockCode?: string
  outputDir: string
  exportDir: string
  exportedStocks: string[]
  exportedFiles: number
  copiedAudioDirs: number
  manifestPath: string
}

export interface NotesImportResult {
  sourceDir: string
  mode: 'skip' | 'replace'
  imported: number
  skipped: number
  failed: number
  importedStocks: string[]
  skippedStocks: string[]
  failedFiles: Array<{ fileName: string; reason: string }>
}

export interface NotesChangedEvent {
  stockCode: string
  entryId?: string
  action: 'created' | 'updated' | 'deleted'
  source: 'local' | 'feishu'
}

export interface TimelineItem {
  id: string
  stockCode: string
  stockName: string
  timestamp: Date
  category: NoteCategory
  operationTag: OperationTag
  trackingStatus: TrackingStatus
  title: string
  viewpoint?: Viewpoint
  hasAudio: boolean
}

export interface TimelineExplorerFilters {
  categories?: NoteCategory[]
  viewpointDirections?: ViewpointDirection[]
  operationTags?: OperationTag[]
  trackingStatuses?: TrackingStatus[]
  stockQuery?: string
  startDate?: string
  endDate?: string
}

export interface TimelineExplorerFacetOption {
  value: string
  label: string
  count: number
}

export interface TimelineExplorerEvent {
  entryId: string
  stockCode: string
  stockName: string
  industry?: string
  sector?: string
  eventTime: string
  createdAt: string
  category: NoteCategory
  operationTag: OperationTag
  trackingStatus: TrackingStatus
  currentTrackingStatus: TrackingStatus
  title: string
  content: string
  contentPreview: string
  inputType?: NoteInputType
  viewpoint?: Viewpoint
  hasAudio: boolean
  isLatestForStock: boolean
}

export interface TimelineExplorerResponse {
  items: TimelineExplorerEvent[]
  totalItems: number
  totalStocks: number
  facets: {
    categories: TimelineExplorerFacetOption[]
    viewpointDirections: TimelineExplorerFacetOption[]
    operationTags: TimelineExplorerFacetOption[]
    trackingStatuses: TimelineExplorerFacetOption[]
  }
}

export type ReviewScope = 'single' | 'overall'
export type KlineInterval = '5m' | '15m' | '30m' | '60m' | '1d'
export type ReviewMarkerDirection = '看多' | '看空' | '震荡' | '未知'

export interface ReviewSnapshot {
  total: number
  bullish: number
  bearish: number
  unknown: number
  actionable: number
}

export interface ReviewSnapshotRequest {
  scope: ReviewScope
  stockCode?: string
  startDate?: string
  endDate?: string
  interval?: KlineInterval
}

export interface ReviewSnapshotResponse {
  scope: ReviewScope
  stockCode?: string
  startDate?: string
  endDate?: string
  interval: KlineInterval
  snapshot: ReviewSnapshot
  generatedAt: string
}

export interface ReviewVisualRequest {
  scope: ReviewScope
  stockCode?: string
  startDate?: string
  endDate?: string
  interval?: KlineInterval
  includeCategories?: NoteCategory[]
}

export interface ReviewMarker {
  entryId: string
  stockCode: string
  eventTime: string
  alignedCandleTime?: string
  direction: ReviewMarkerDirection
  category: NoteCategory
  outOfRange: boolean
}

export interface ReviewMarkerCluster {
  candleTime: string
  count: number
  bullish: number
  bearish: number
  neutral: number
  unknown: number
  markerEntryIds: string[]
}

export interface ReviewVisualStats {
  totalMarkers: number
  clusteredCandles: number
  maxClusterSize: number
  outOfRangeMarkers: number
}

export interface ReviewVisualResponse {
  scope: ReviewScope
  stockCode: string
  startDate?: string
  endDate?: string
  interval: KlineInterval
  candles: MarketCandle[]
  markers: ReviewMarker[]
  clusters: ReviewMarkerCluster[]
  stats: ReviewVisualStats
  generatedAt: string
}

export interface MarketCandle {
  stockCode: string
  timestamp: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

export interface ReviewRuleConfig {
  windowDays: number
  thresholdPct: number
  excludeUnknown: boolean
}

export interface ReviewEventResult {
  entryId: string
  stockCode: string
  eventTime: string
  direction: '看多' | '看空'
  entryPrice: number
  targetPrice: number
  changePct: number
  hit: boolean
  reason: string
}

export interface ReviewActionResult {
  entryId: string
  stockCode: string
  eventTime: string
  operationTag: '买入' | '卖出'
  viewpointDirection: '看多' | '看空' | '未知'
  entryPrice: number
  targetPrice: number
  changePct: number
  hit: boolean
  reason: string
}

export interface ReviewDirectionStats {
  samples: number
  hits: number
  accuracy: number
}

export interface ReviewEvaluateSummary {
  totalNotes: number
  unknownNotes: number
  actionableNotes: number
  evaluatedSamples: number
  insufficientData: number
  hits: number
  accuracy: number
  bullish: ReviewDirectionStats
  bearish: ReviewDirectionStats
}

export interface ReviewActionSummary {
  totalActions: number
  buyActions: number
  sellActions: number
  evaluatedSamples: number
  insufficientData: number
  hits: number
  accuracy: number
  buyAccuracy: number
  sellAccuracy: number
  alignedWithViewpoint: number
  viewpointLinkedActions: number
  alignmentRate: number
}

export interface ReviewEvaluateRequest {
  scope: ReviewScope
  stockCode?: string
  startDate?: string
  endDate?: string
  interval?: KlineInterval
  rule?: Partial<ReviewRuleConfig>
}

export interface ReviewEvaluateResponse {
  scope: ReviewScope
  stockCode?: string
  startDate?: string
  endDate?: string
  interval: KlineInterval
  rule: ReviewRuleConfig
  summary: ReviewEvaluateSummary
  results: ReviewEventResult[]
  actionSummary: ReviewActionSummary
  actionResults: ReviewActionResult[]
  generatedAt: string
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
