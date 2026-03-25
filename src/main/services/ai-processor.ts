import { stockNameMatcher } from './stock-matcher'
import { stockDatabase } from './stock-db'
import { createTraceId, logPipelineEvent } from './pipeline-logger'
import { appConfigService } from './app-config'
import { watchlistService } from './watchlist'
import type { OperationTag } from '../../shared/types'
import { cleanTranscriptText, normalizeStockNameText, normalizeToSimplifiedChinese, toHalfWidthText } from '../../shared/text-normalizer'

export interface ExtractedStock {
  code: string
  name: string
  confidence: number
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

export interface AIExtractResult {
  stock?: ExtractedStock
  note: ExtractedNote
  timestamp: ExtractedTimestamp
  optimizedText: string
  originalText: string
}

const STOCK_CORRECTION_PROMPT = `请纠正以下录音转写文本中的错误，并仅返回JSON（不要额外解释）：

{text}

{candidates}

任务：
- 纠正错别字和同音字错误
- 根据候选股票列表，纠正常见的股票名称错误
- 不要改变原意，只做文字纠正
- 输出默认使用简体中文

请返回：
{
  "corrected_text": "纠正后的简体中文文本"
}`

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
  "operation_tag": "买入|卖出|无",
  "key_points": ["要点1", "要点2", "要点3"]
}

要求：
- 若无法确定股票，则股票字段给空字符串
- viewpoint 只能是看多/看空/震荡/未知
- operation_tag 只能是买入/卖出/无
- 输出默认使用简体中文`

interface ThemeExtractResult {
  stockName?: string
  stockCode?: string
  viewpoint: '看多' | '看空' | '震荡' | '未知'
  operationTag: OperationTag
  keyPoints: string[]
}

interface CorrectionExtractResult {
  correctedText: string
}

export class AIProcessor {
  private defaultApiKey: string
  private defaultBaseUrl: string
  private defaultModel: string

  constructor() {
    this.defaultApiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || ''
    this.defaultBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1'
    this.defaultModel = process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed'
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
    const correctedText = cleanTranscriptText(correctedTextRaw)
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

    const operationTag = this.normalizeOperationTag(theme.operationTag, correctedText || originalText)

    return {
      stock: stockCode && stockName ? { code: stockCode, name: stockName, confidence: stockConfidence } : undefined,
      note: {
        keyPoints: theme.keyPoints,
        sentiment: theme.viewpoint,
        timeHorizon: undefined,
        operationTag
      },
      timestamp: { type: 'none' },
      optimizedText: correctedText,
      originalText: originalText
    }
  }

  async extract(text: string): Promise<AIExtractResult> {
    const traceId = createTraceId('extract')
    const startedAt = Date.now()
    logPipelineEvent({
      traceId,
      stage: 'extract',
      status: 'start'
    })

    const cleanedInput = this.cleanTranscriptText(text)
    if (!cleanedInput.trim()) {
      logPipelineEvent({
        traceId,
        stage: 'extract',
        status: 'success',
        durationMs: Date.now() - startedAt,
        message: 'empty_input'
      })
      return this.emptyResult(text)
    }

    await stockNameMatcher.load()
    await stockDatabase.ensureLoaded()
    const watchlistCodes = await watchlistService.getCodes()
    const watchlistSet = new Set(watchlistCodes)
    const watchlistStocks = watchlistCodes
      .map((code) => stockDatabase.getByCode(code))
      .filter((stock): stock is NonNullable<typeof stock> => Boolean(stock))
      .slice(0, 60)

    const candidates = stockNameMatcher.findAllCandidates(cleanedInput)
    const watchlistCandidateText = watchlistStocks.length > 0
      ? `\n优先关注股票（优先从这些股票中匹配）：\n${watchlistStocks.map((stock) => `  - ${stock.name} (${stock.code})`).join('\n')}`
      : ''
    const candidateText = candidates.length > 0
      ? `候选股票列表（文本中可能提到的股票）：\n${candidates.map(c => `  - "${c.segment}" 可能对应 "${c.stock.name}"，可信度${(c.confidence * 100).toFixed(0)}%`).join('\n')}${watchlistCandidateText}`
      : `（未检测到候选股票）${watchlistCandidateText}`

    if (candidates.length > 0) {
      console.log('[AIProcessor] Stock candidates found:', candidates.map(c => `${c.segment}->${c.stock.name}`).join(', '))
    }

    try {
      const correction = await this.extractCorrection(cleanedInput, candidateText)
      const simplifiedText = await this.normalizeToSimplified(correction.correctedText || cleanedInput)
      const theme = await this.extractTheme(simplifiedText || cleanedInput, candidateText)
      const result = this.parseAIResponse(simplifiedText || cleanedInput, cleanedInput, theme)
      const dbMatch = stockDatabase.matchStock(simplifiedText || cleanedInput)
      const watchlistMatch = this.findWatchlistMatch(simplifiedText || cleanedInput, watchlistStocks)

      if (candidates.length > 0 && !result.stock) {
        const bestCandidate = candidates.reduce((best, c) => c.confidence > best.confidence ? c : best, candidates[0])
        result.stock = {
          code: bestCandidate.stock.code,
          name: bestCandidate.stock.name,
          confidence: bestCandidate.confidence
        }
      }

      if (!result.stock) {
        if (dbMatch) {
          result.stock = {
            code: dbMatch.stock.code,
            name: dbMatch.stock.name,
            confidence: Math.min(0.95, Math.max(0.6, dbMatch.score / 100))
          }
        }
      }

      if (watchlistMatch && (!result.stock || result.stock.code !== watchlistMatch.code || result.stock.confidence < 0.95)) {
        result.stock = {
          code: watchlistMatch.code,
          name: watchlistMatch.name,
          confidence: Math.max(result.stock?.confidence ?? 0, 0.95)
        }
      } else if (result.stock && watchlistSet.size > 0 && !watchlistSet.has(result.stock.code)) {
        const preferredCandidate = candidates
          .filter((candidate) => watchlistSet.has(candidate.stock.code))
          .sort((a, b) => b.confidence - a.confidence)[0]
        if (preferredCandidate && preferredCandidate.confidence >= result.stock.confidence - 0.1) {
          result.stock = {
            code: preferredCandidate.stock.code,
            name: preferredCandidate.stock.name,
            confidence: Math.max(result.stock.confidence, preferredCandidate.confidence)
          }
        }
      } else if (
        dbMatch &&
        result.stock &&
        (
          dbMatch.score >= 95 ||
          (result.stock.confidence < 0.9 && dbMatch.stock.code !== result.stock.code)
        )
      ) {
        // 本地库高置信命中时，覆盖低置信的模糊匹配结果，降低误配率。
        result.stock = {
          code: dbMatch.stock.code,
          name: dbMatch.stock.name,
          confidence: Math.min(0.98, Math.max(result.stock.confidence, dbMatch.score / 100))
        }
      }

      if (result.stock) {
        logPipelineEvent({
          traceId,
          stage: 'match',
          status: 'success',
          stockCode: result.stock.code,
          durationMs: Date.now() - startedAt
        })
      } else {
        logPipelineEvent({
          traceId,
          stage: 'match',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'STOCK_NOT_FOUND'
        })
      }

      result.originalText = cleanedInput
      logPipelineEvent({
        traceId,
        stage: 'extract',
        status: 'success',
        stockCode: result.stock?.code,
        durationMs: Date.now() - startedAt
      })
      return result
    } catch (error: any) {
      console.error('[AIProcessor] Extraction failed:', error)
      logPipelineEvent({
        traceId,
        stage: 'extract',
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorCode: 'EXTRACT_FAILED',
        message: error?.message || String(error)
      })
      const fallbackTheme = this.extractThemeByRule(cleanedInput)
      return this.parseAIResponse(cleanedInput, cleanedInput, fallbackTheme)
    }
  }

  private async extractCorrection(text: string, candidateText: string): Promise<CorrectionExtractResult> {
    const prompt = STOCK_CORRECTION_PROMPT
      .replace('{text}', text)
      .replace('{candidates}', candidateText)

    try {
      const response = await this.chat(prompt)
      const raw = this.safeParseJson(response)

      // 严格只接受结构化字段，避免把模型“思考过程”当成正文保存。
      const correctedText = typeof raw?.corrected_text === 'string'
        ? raw.corrected_text
        : text

      return {
        correctedText: cleanTranscriptText(correctedText || text)
      }
    } catch {
      return {
        correctedText: cleanTranscriptText(text)
      }
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
      const operationTag = this.normalizeOperationTag(raw?.operation_tag, text)
      const stockName = typeof raw?.stock_name === 'string' ? raw.stock_name.trim() : undefined
      const stockCode = typeof raw?.stock_code === 'string' ? raw.stock_code.trim() : undefined
      const keyPoints = Array.isArray(raw?.key_points)
        ? raw.key_points.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 5)
        : []

      return {
        stockName: stockName ? normalizeStockNameText(stockName) : undefined,
        stockCode: stockCode || undefined,
        viewpoint,
        operationTag,
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
      operationTag: this.inferOperationTag(text),
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

  private normalizeOperationTag(value: unknown, textForFallback: string): OperationTag {
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized.includes('买')) return '买入'
      if (normalized.includes('卖')) return '卖出'
      if (normalized.includes('无') || normalized.includes('没有')) return '无'
    }
    return this.inferOperationTag(textForFallback)
  }

  private inferOperationTag(text: string): OperationTag {
    const normalizedText = normalizeStockNameText(text || '')
    if (!normalizedText) return '无'

    const buyKeywords = ['买入', '建仓', '加仓', '抄底', '开仓', '吸筹']
    const sellKeywords = ['卖出', '减仓', '止盈', '止损', '清仓', '高抛']
    const buyIndex = this.findLastKeywordIndex(normalizedText, buyKeywords)
    const sellIndex = this.findLastKeywordIndex(normalizedText, sellKeywords)

    if (buyIndex < 0 && sellIndex < 0) return '无'
    if (buyIndex >= 0 && sellIndex < 0) return '买入'
    if (sellIndex >= 0 && buyIndex < 0) return '卖出'
    return buyIndex >= sellIndex ? '买入' : '卖出'
  }

  private findLastKeywordIndex(text: string, keywords: string[]): number {
    let maxIndex = -1
    for (const keyword of keywords) {
      const index = text.lastIndexOf(keyword)
      if (index > maxIndex) {
        maxIndex = index
      }
    }
    return maxIndex
  }

  private safeParseJson(input: string): any {
    const cleaned = input
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    try {
      return JSON.parse(cleaned)
    } catch {
      const objectMatch = cleaned.match(/\{[\s\S]*\}/)
      if (objectMatch) {
        return JSON.parse(objectMatch[0])
      }
      throw new Error('invalid json')
    }
  }

  private async normalizeToSimplified(text: string): Promise<string> {
    const normalized = cleanTranscriptText(text)
    if (!normalized) return normalized

    const prompt = `请把下面内容转换为简体中文，仅返回 JSON（不要额外解释）：

{
  "text": "转换后的简体中文文本"
}

文本：
${normalized}`
    try {
      const response = await this.chat(prompt)
      const raw = this.safeParseJson(response)
      const simplified = typeof raw?.text === 'string' ? raw.text : normalized
      return cleanTranscriptText(normalizeToSimplifiedChinese(toHalfWidthText(simplified || normalized)))
    } catch {
      return cleanTranscriptText(normalizeToSimplifiedChinese(toHalfWidthText(normalized)))
    }
  }

  private cleanTranscriptText(text: string): string {
    return cleanTranscriptText(text)
  }

  private emptyResult(text: string): AIExtractResult {
    return {
      note: {
        keyPoints: [],
        sentiment: undefined,
        timeHorizon: undefined,
        operationTag: this.inferOperationTag(text)
      },
      timestamp: { type: 'none' },
      optimizedText: cleanTranscriptText(text),
      originalText: cleanTranscriptText(text)
    }
  }

  private async getRuntimeConfig(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    const settings = await appConfigService.getAll()
    return {
      baseUrl: settings.textAnalysis.baseUrl || this.defaultBaseUrl,
      model: settings.textAnalysis.model || this.defaultModel,
      apiKey: settings.textAnalysis.apiKey || this.defaultApiKey
    }
  }

  private findWatchlistMatch(
    text: string,
    watchlistStocks: Array<{ code: string; name: string }>
  ): { code: string; name: string } | null {
    if (watchlistStocks.length === 0) return null

    const normalizedText = normalizeStockNameText(text)
    const byCode = text.match(/\d{6}/g) || []

    for (const code of byCode) {
      const stock = watchlistStocks.find((item) => item.code === code)
      if (stock) {
        return { code: stock.code, name: stock.name }
      }
    }

    for (const stock of watchlistStocks) {
      if (normalizedText.includes(normalizeStockNameText(stock.name))) {
        return { code: stock.code, name: stock.name }
      }
    }

    return null
  }
}
