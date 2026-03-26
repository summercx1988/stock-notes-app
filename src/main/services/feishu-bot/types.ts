import type { AIExtractResult, StockCandidate } from '../ai-processor'

export interface FeishuMessage {
  messageId: string
  chatId: string
  openId: string
  text: string
  timestamp: number
}

export interface SessionState {
  messageId: string
  chatId: string
  openId: string
  status: 'idle' | 'awaiting_stock' | 'awaiting_confirm'
  originalText: string
  extractedData?: AIExtractResult
  createdAt: number
  updatedAt: number
}

export interface CardAction {
  action: 'confirm' | 'edit' | 'cancel' | 'provide_stock' | 'save_edit'
  chatId?: string
  stockCode?: string
  stockName?: string
  category?: string
  viewpoint?: string
  operationTag?: string
  eventTime?: string
  formData?: {
    stockInput?: string
    contentInput?: string
    categorySelect?: string
    viewpointSelect?: string
    operationSelect?: string
    eventTimeInput?: string
  }
}

export interface CardActionPayload {
  schemaVersion?: '1.0' | '2.0' | 'legacy'
  action: 'confirm' | 'edit' | 'cancel' | 'provide_stock' | 'save_edit'
  chatId?: string
  messageId?: string
  stockCode?: string
  stockName?: string
  category?: string
  viewpoint?: string
  operationTag?: string
  eventTime?: string
}

export interface CardDraft {
  stockName: string
  stockCode: string
  viewpoint: string
  operationTag: string
  keyPoints: string[]
  originalText: string
  confidence: number
  decisionReason?: string[]
}

export interface ConfirmCardData {
  stockName: string
  stockCode: string
  viewpoint: string
  operationTag: string
  keyPoints: string[]
  originalText: string
  confidence: number
  chatId: string
  messageId: string
  eventTime: string
}

export interface AskStockCardData {
  chatId: string
  messageId: string
  originalText: string
  message: string
  candidates?: StockCandidate[]
}
