import { appConfigService } from './app-config'
import { ParseOrchestrator } from './parse-orchestrator'
import { FeishuFastParseOrchestrator } from './feishu-fast-parse-orchestrator'
import type { OperationTag } from '../../shared/types'

export type CandidateSource = 'llm' | 'db' | 'watchlist' | 'rule'

export interface ExtractedStock {
  code: string
  name: string
  confidence: number
}

export interface StockCandidate {
  code: string
  name: string
  confidence: number
  source: CandidateSource
}

export interface ExtractedNote {
  keyPoints: string[]
  sentiment?: string
  timeHorizon?: string
  operationTag?: OperationTag
}

export interface ExtractedTimestamp {
  type: 'absolute' | 'relative' | 'none'
  value?: Date
  originalText?: string
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

export interface AIExtractResult {
  stock?: ExtractedStock
  note: ExtractedNote
  timestamp: ExtractedTimestamp
  optimizedText: string
  originalText: string
  stockCandidates: StockCandidate[]
  stockConfidence: number
  decisionReason: string[]
  needsUserDisambiguation: boolean
  cardDraft?: CardDraft
}

export class AIProcessor {
  private readonly defaultApiKey: string
  private readonly defaultBaseUrl: string
  private readonly defaultModel: string
  private readonly orchestrator: ParseOrchestrator
  private readonly feishuFastOrchestrator: FeishuFastParseOrchestrator

  constructor() {
    this.defaultApiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || ''
    this.defaultBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1'
    this.defaultModel = process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed'
    this.orchestrator = new ParseOrchestrator({
      chat: (prompt: string) => this.chat(prompt)
    })
    this.feishuFastOrchestrator = new FeishuFastParseOrchestrator({
      chat: (prompt: string) => this.chat(prompt)
    })
  }

  async extract(text: string): Promise<AIExtractResult> {
    return this.orchestrator.run(text)
  }

  async extractForFeishu(text: string): Promise<AIExtractResult> {
    return this.feishuFastOrchestrator.run(text)
  }

  private async chat(prompt: string): Promise<string> {
    const runtime = await this.getRuntimeConfig()
    if (!runtime.apiKey) {
      throw new Error('Text analysis API key is not configured')
    }

    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${runtime.apiKey}`
      },
      body: JSON.stringify({
        model: runtime.model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 900
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  }

  private async getRuntimeConfig(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    const settings = await appConfigService.getAll()
    return {
      baseUrl: settings.textAnalysis.baseUrl || this.defaultBaseUrl,
      model: settings.textAnalysis.model || this.defaultModel,
      apiKey: settings.textAnalysis.apiKey || this.defaultApiKey
    }
  }
}
