import { stockNameMatcher } from './stock-matcher'

export interface ExtractedStock {
  code: string
  name: string
  confidence: number
}

export interface ExtractedNote {
  keyPoints: string[]
  sentiment?: string
  timeHorizon?: string
}

export interface ExtractedTimestamp {
  type: 'absolute' | 'relative' | 'none'
  value?: Date
  originalText?: string
}

export interface AIExtractResult {
  stock?: ExtractedStock
  note: ExtractedNote
  timestamp: ExtractedTimestamp
  optimizedText: string
  originalText: string
}

const STOCK_EXTRACT_PROMPT_HEADER = `请纠正以下录音转写文本中的错误：

{text}

{candidates}

任务：
- 纠正错别字和同音字错误
- 根据候选股票列表，纠正常见的股票名称错误
- 不要改变原意，只做文字纠正

只返回纠正后的文本。`

export class AIProcessor {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || ''
    this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1'
    this.model = process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed'
  }

  private async chat(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    return data.choices[0]?.message?.content || ''
  }

  private parseAIResponse(response: string, originalText: string): AIExtractResult {
    const correctedText = response.trim()

    const candidates = stockNameMatcher.findAllCandidates(originalText)
    let stockName: string | undefined
    let stockCode: string | undefined
    let stockConfidence = 0.8

    if (candidates.length > 0) {
      stockName = candidates[0].stock.name
      stockCode = candidates[0].stock.code
      stockConfidence = candidates[0].confidence
      console.log('[AIProcessor] Stock from candidates:', stockName, '->', stockCode)
    }

    return {
      stock: stockCode && stockName ? { code: stockCode, name: stockName, confidence: stockConfidence } : undefined,
      note: {
        keyPoints: [],
        sentiment: undefined,
        timeHorizon: undefined
      },
      timestamp: { type: 'none' },
      optimizedText: correctedText,
      originalText: originalText
    }
  }

  async extract(text: string): Promise<AIExtractResult> {
    if (!text.trim()) {
      return this.emptyResult(text)
    }

    await stockNameMatcher.load()

    const candidates = stockNameMatcher.findAllCandidates(text)
    const candidateText = candidates.length > 0
      ? `候选股票列表（文本中可能提到的股票）：\n${candidates.map(c => `  - "${c.segment}" 可能对应 "${c.stock.name}"，可信度${(c.confidence * 100).toFixed(0)}%`).join('\n')}`
      : '（未检测到候选股票）'

    if (candidates.length > 0) {
      console.log('[AIProcessor] Stock candidates found:', candidates.map(c => `${c.segment}->${c.stock.name}`).join(', '))
    }

    try {
      const prompt = STOCK_EXTRACT_PROMPT_HEADER
        .replace('{text}', text)
        .replace('{candidates}', candidateText)
      const response = await this.chat(prompt)
      const result = this.parseAIResponse(response, text)

      if (candidates.length > 0 && !result.stock) {
        const bestCandidate = candidates.reduce((best, c) => c.confidence > best.confidence ? c : best, candidates[0])
        result.stock = {
          code: bestCandidate.stock.code,
          name: bestCandidate.stock.name,
          confidence: bestCandidate.confidence
        }
      }

      result.originalText = text
      return result
    } catch (error: any) {
      console.error('[AIProcessor] Extraction failed:', error)
      return this.emptyResult(text)
    }
  }

  private emptyResult(text: string): AIExtractResult {
    return {
      note: {
        keyPoints: [],
        sentiment: undefined,
        timeHorizon: undefined
      },
      timestamp: { type: 'none' },
      optimizedText: text,
      originalText: text
    }
  }
}
