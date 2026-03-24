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
- 输出默认使用简体中文

只返回纠正后的文本。`

const THEME_EXTRACT_PROMPT = `请解析以下A股投资笔记，并返回核心主题信息（仅返回JSON）：

文本：
{text}

候选股票：
{candidates}

返回格式：
{
  "stock_name": "股票名或空字符串",
  "stock_code": "6位代码或空字符串",
  "viewpoint": "看多|看空|震荡|未知",
  "key_points": ["要点1", "要点2", "要点3"]
}

要求：
- 若无法确定股票，则股票字段给空字符串
- viewpoint 只能是看多/看空/震荡/未知
- 输出默认使用简体中文`

interface ThemeExtractResult {
  stockName?: string
  stockCode?: string
  viewpoint: '看多' | '看空' | '震荡' | '未知'
  keyPoints: string[]
}

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

  private parseAIResponse(correctedTextRaw: string, originalText: string, theme: ThemeExtractResult): AIExtractResult {
    const correctedText = this.cleanTranscriptText(correctedTextRaw)
    const candidates = stockNameMatcher.findAllCandidates(correctedText || originalText)
    let stockName: string | undefined
    let stockCode: string | undefined
    let stockConfidence = 0.8

    if (theme.stockName && theme.stockCode) {
      stockName = theme.stockName
      stockCode = theme.stockCode
      stockConfidence = 0.92
    } else if (theme.stockName && !theme.stockCode) {
      const matched = stockNameMatcher.findByName(theme.stockName)
      if (matched) {
        stockName = matched.name
        stockCode = matched.code
        stockConfidence = matched.confidence
      }
    } else if (candidates.length > 0) {
      stockName = candidates[0].stock.name
      stockCode = candidates[0].stock.code
      stockConfidence = candidates[0].confidence
      console.log('[AIProcessor] Stock from candidates:', stockName, '->', stockCode)
    }

    return {
      stock: stockCode && stockName ? { code: stockCode, name: stockName, confidence: stockConfidence } : undefined,
      note: {
        keyPoints: theme.keyPoints,
        sentiment: theme.viewpoint,
        timeHorizon: undefined
      },
      timestamp: { type: 'none' },
      optimizedText: correctedText,
      originalText: originalText
    }
  }

  async extract(text: string): Promise<AIExtractResult> {
    const cleanedInput = this.cleanTranscriptText(text)
    if (!cleanedInput.trim()) {
      return this.emptyResult(text)
    }

    await stockNameMatcher.load()

    const candidates = stockNameMatcher.findAllCandidates(cleanedInput)
    const candidateText = candidates.length > 0
      ? `候选股票列表（文本中可能提到的股票）：\n${candidates.map(c => `  - "${c.segment}" 可能对应 "${c.stock.name}"，可信度${(c.confidence * 100).toFixed(0)}%`).join('\n')}`
      : '（未检测到候选股票）'

    if (candidates.length > 0) {
      console.log('[AIProcessor] Stock candidates found:', candidates.map(c => `${c.segment}->${c.stock.name}`).join(', '))
    }

    try {
      const prompt = STOCK_EXTRACT_PROMPT_HEADER
        .replace('{text}', cleanedInput)
        .replace('{candidates}', candidateText)
      const response = await this.chat(prompt)
      const correctedText = this.cleanTranscriptText(response)
      const theme = await this.extractTheme(correctedText || cleanedInput, candidateText)
      const result = this.parseAIResponse(correctedText || cleanedInput, cleanedInput, theme)

      if (candidates.length > 0 && !result.stock) {
        const bestCandidate = candidates.reduce((best, c) => c.confidence > best.confidence ? c : best, candidates[0])
        result.stock = {
          code: bestCandidate.stock.code,
          name: bestCandidate.stock.name,
          confidence: bestCandidate.confidence
        }
      }

      result.originalText = cleanedInput
      return result
    } catch (error: any) {
      console.error('[AIProcessor] Extraction failed:', error)
      const fallbackTheme = this.extractThemeByRule(cleanedInput)
      return this.parseAIResponse(cleanedInput, cleanedInput, fallbackTheme)
    }
  }

  private async extractTheme(text: string, candidateText: string): Promise<ThemeExtractResult> {
    try {
      const prompt = THEME_EXTRACT_PROMPT
        .replace('{text}', text)
        .replace('{candidates}', candidateText)
      const response = await this.chat(prompt)
      const raw = this.safeParseJson(response)
      const viewpoint = this.normalizeViewpoint(raw?.viewpoint)
      const stockName = typeof raw?.stock_name === 'string' ? raw.stock_name.trim() : undefined
      const stockCode = typeof raw?.stock_code === 'string' ? raw.stock_code.trim() : undefined
      const keyPoints = Array.isArray(raw?.key_points)
        ? raw.key_points.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 5)
        : []

      return {
        stockName: stockName || undefined,
        stockCode: stockCode || undefined,
        viewpoint,
        keyPoints: keyPoints.length > 0 ? keyPoints : this.extractThemeByRule(text).keyPoints
      }
    } catch {
      return this.extractThemeByRule(text)
    }
  }

  private extractThemeByRule(text: string): ThemeExtractResult {
    const bullishKeywords = ['看多', '上涨', '反弹', '突破', '加仓', '买入', '做多', '走强']
    const bearishKeywords = ['看空', '下跌', '回落', '减仓', '卖出', '做空', '走弱', '风险']
    const rangeKeywords = ['震荡', '横盘', '区间', '波动', '盘整']

    const count = (words: string[]) => words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0)
    const bullishScore = count(bullishKeywords)
    const bearishScore = count(bearishKeywords)
    const rangeScore = count(rangeKeywords)

    let viewpoint: ThemeExtractResult['viewpoint'] = '未知'
    const maxScore = Math.max(bullishScore, bearishScore, rangeScore)
    if (maxScore > 0) {
      if (maxScore === bullishScore && bullishScore > bearishScore && bullishScore > rangeScore) {
        viewpoint = '看多'
      } else if (maxScore === bearishScore && bearishScore > bullishScore && bearishScore > rangeScore) {
        viewpoint = '看空'
      } else if (rangeScore > 0) {
        viewpoint = '震荡'
      }
    }

    const keyPoints = text
      .split(/[。！？\n]/g)
      .map((line) => line.trim())
      .filter((line) => line.length >= 6)
      .slice(0, 3)

    return {
      viewpoint,
      keyPoints
    }
  }

  private normalizeViewpoint(value: unknown): ThemeExtractResult['viewpoint'] {
    if (typeof value !== 'string') return '未知'
    if (value.includes('看多') || value.includes('多')) return '看多'
    if (value.includes('看空') || value.includes('空')) return '看空'
    if (value.includes('震荡') || value.includes('中性') || value.includes('横盘')) return '震荡'
    return '未知'
  }

  private safeParseJson(input: string): any {
    const cleaned = input
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    return JSON.parse(cleaned)
  }

  private cleanTranscriptText(text: string): string {
    const withoutTimestamps = text.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, ' ')
    return withoutTimestamps
      .replace(/\s+/g, ' ')
      .replace(/\s+([，。！？；：])/g, '$1')
      .trim()
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
