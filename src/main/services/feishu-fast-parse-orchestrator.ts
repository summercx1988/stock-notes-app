import { stockDatabase, type StockInfo } from './stock-db'
import { stockNameMatcher } from './stock-matcher'
import { watchlistService } from './watchlist'
import { createTraceId, logPipelineEvent } from './pipeline-logger'
import type {
  AIExtractResult,
  CardDraft,
  ExtractedNote,
  ExtractedStock,
  StockCandidate
} from './ai-processor'
import type { OperationTag } from '../../shared/types'
import { cleanTranscriptText, normalizeStockNameText, toHalfWidthText } from '../../shared/text-normalizer'

interface FeishuFastParseDeps {
  chat(prompt: string): Promise<string>
}

interface FastFallbackResult {
  stockName?: string
  stockCode?: string
  viewpoint?: string
  operationTag?: string
  decisionReason?: string[]
}

const FAST_FALLBACK_PROMPT = `你是股票笔记极速解析助手。只做字段提取，不做改写，不做总结，不做意图分析。请只返回 JSON：

文本：
{text}

候选股票：
{candidates}

输出格式：
{
  "stock_name": "股票名称或空字符串",
  "stock_code": "6位代码或空字符串",
  "viewpoint": "看多|看空|震荡|未知",
  "operation_tag": "买入|卖出|无",
  "decision_reason": ["原因1","原因2"]
}

要求：
- 不要改写原文
- 无法确认股票时返回空字符串
- 仅返回 JSON`

export class FeishuFastParseOrchestrator {
  constructor(private readonly deps: FeishuFastParseDeps) {}

  async run(text: string): Promise<AIExtractResult> {
    const traceId = createTraceId('feishu_fast_extract')
    const startedAt = Date.now()
    logPipelineEvent({
      traceId,
      stage: 'extract',
      status: 'start',
      message: 'feishu_fast_start'
    })

    const cleanedText = cleanTranscriptText(toHalfWidthText(text || ''))
    if (!cleanedText) {
      return this.emptyResult(text)
    }

    await stockDatabase.ensureLoaded()

    const watchlistStocks = (await watchlistService.getStocks())
      .filter((item) => item.inDatabase)
      .map((item) => ({ code: item.code, name: item.name }))

    const ruleStartedAt = Date.now()
    const rule = await this.ruleFirstStep(cleanedText, watchlistStocks)
    logPipelineEvent({
      traceId,
      stage: 'match',
      status: rule.selectedStock ? 'success' : 'error',
      stockCode: rule.selectedStock?.code,
      durationMs: Date.now() - ruleStartedAt,
      message: 'feishu_rule_first'
    })

    let llmCalls = 0
    let finalCandidates = rule.stockCandidates
    let selectedStock = rule.selectedStock
    let stockConfidence = rule.stockConfidence
    let needsUserDisambiguation = rule.needsUserDisambiguation
    const decisionReason = [...rule.decisionReason]
    let viewpoint = rule.viewpoint
    let operationTag = rule.operationTag

    if (!selectedStock && finalCandidates.length === 0) {
      const fallbackStartedAt = Date.now()
      const fallback = await this.fallbackStep(cleanedText, finalCandidates, watchlistStocks)
      llmCalls = 1
      logPipelineEvent({
        traceId,
        stage: 'extract',
        status: 'success',
        durationMs: Date.now() - fallbackStartedAt,
        message: 'feishu_llm_fallback',
        extra: { llm_calls: llmCalls }
      })

      const verifiedFallback = this.applyFallback(cleanedText, fallback, finalCandidates, watchlistStocks)
      selectedStock = verifiedFallback.selectedStock
      stockConfidence = verifiedFallback.stockConfidence
      needsUserDisambiguation = verifiedFallback.needsUserDisambiguation
      finalCandidates = verifiedFallback.stockCandidates
      viewpoint = viewpoint === '未知' ? verifiedFallback.viewpoint : viewpoint
      operationTag = operationTag === '无' ? verifiedFallback.operationTag : operationTag
      decisionReason.push(...verifiedFallback.decisionReason)
    }

    const note: ExtractedNote = {
      keyPoints: [],
      sentiment: viewpoint,
      timeHorizon: undefined,
      operationTag
    }

    const cardDraft = this.buildCardDraft({
      stock: selectedStock,
      note,
      originalText: cleanedText,
      stockConfidence,
      decisionReason
    })

    const result: AIExtractResult = {
      stock: selectedStock,
      note,
      timestamp: { type: 'none' },
      optimizedText: cleanedText,
      originalText: cleanedText,
      stockCandidates: finalCandidates,
      stockConfidence,
      decisionReason: decisionReason.slice(0, 8),
      needsUserDisambiguation,
      cardDraft
    }

    logPipelineEvent({
      traceId,
      stage: 'extract',
      status: 'success',
      stockCode: selectedStock?.code,
      durationMs: Date.now() - startedAt,
      message: 'feishu_fast_done',
      extra: {
        llm_calls: llmCalls,
        stock_candidates: finalCandidates.length,
        needs_user_disambiguation: needsUserDisambiguation
      }
    })

    return result
  }

  private async ruleFirstStep(
    text: string,
    watchlistStocks: Array<{ code: string; name: string }>
  ): Promise<{
    selectedStock?: ExtractedStock
    stockCandidates: StockCandidate[]
    stockConfidence: number
    needsUserDisambiguation: boolean
    decisionReason: string[]
    viewpoint: '看多' | '看空' | '震荡' | '未知'
    operationTag: OperationTag
  }> {
    const pool = new Map<string, StockCandidate>()
    const decisionReason: string[] = ['FastPath: 飞书消息走规则优先解析']
    const viewpoint = this.inferViewpoint(text)
    const operationTag = this.inferOperationTag(text)

    const codeMatches = text.match(/\d{6}/g) || []
    for (const code of codeMatches) {
      const stock = stockDatabase.getByCode(code)
      if (stock) {
        const source = watchlistStocks.some((item) => item.code === stock.code) ? 'watchlist' : 'db'
        this.upsertCandidate(pool, {
          code: stock.code,
          name: stock.name,
          confidence: source === 'watchlist' ? 1 : 0.99,
          source
        })
      }
    }

    const exactWatchlistMatch = this.findExactMention(text, watchlistStocks)
    if (exactWatchlistMatch) {
      this.upsertCandidate(pool, {
        code: exactWatchlistMatch.code,
        name: exactWatchlistMatch.name,
        confidence: 0.98,
        source: 'watchlist'
      })
      decisionReason.push('FastPath: 命中自选股精确匹配')
    }

    const exactDbMatch = this.findExactMention(
      text,
      stockDatabase.getAll().map((item) => ({ code: item.code, name: item.name }))
    )
    if (exactDbMatch) {
      this.upsertCandidate(pool, {
        code: exactDbMatch.code,
        name: exactDbMatch.name,
        confidence: 0.95,
        source: 'db'
      })
      decisionReason.push('FastPath: 命中股票库精确匹配')
    }

    if (pool.size === 0) {
      await stockNameMatcher.load()
      const fuzzyCandidates = stockNameMatcher.findAllCandidates(text)
      for (const candidate of fuzzyCandidates.slice(0, 5)) {
        const isWatchlist = watchlistStocks.some((item) => item.code === candidate.stock.code)
        this.upsertCandidate(pool, {
          code: candidate.stock.code,
          name: candidate.stock.name,
          confidence: isWatchlist
            ? this.clampConfidence(Math.max(candidate.confidence, 0.88))
            : this.clampConfidence(candidate.confidence),
          source: isWatchlist ? 'watchlist' : 'rule'
        })
      }
      if (fuzzyCandidates.length > 0) {
        decisionReason.push('FastPath: 使用本地股票名模糊匹配补充候选')
      }
    }

    const stockCandidates = Array.from(pool.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5)

    const top = stockCandidates[0]
    const second = stockCandidates[1]
    const closeRace = Boolean(top && second && (top.confidence - second.confidence) <= 0.08)
    const explicitMention = top ? this.hasExplicitStockMention(text, top.code, top.name) : false
    const autoConfirmed = Boolean(top && explicitMention && top.confidence >= 0.93 && !closeRace)

    if (!top) {
      decisionReason.push('FastPath: 本地规则未识别出高置信股票')
      return {
        selectedStock: undefined,
        stockCandidates: [],
        stockConfidence: 0,
        needsUserDisambiguation: true,
        decisionReason,
        viewpoint,
        operationTag
      }
    }

    decisionReason.push(autoConfirmed ? 'FastPath: 本地规则已高置信识别股票' : 'FastPath: 股票候选存在歧义或置信度不足')

    return {
      selectedStock: autoConfirmed
        ? { code: top.code, name: top.name, confidence: top.confidence }
        : undefined,
      stockCandidates,
      stockConfidence: top.confidence,
      needsUserDisambiguation: !autoConfirmed,
      decisionReason,
      viewpoint,
      operationTag
    }
  }

  private async fallbackStep(
    text: string,
    stockCandidates: StockCandidate[],
    watchlistStocks: Array<{ code: string; name: string }>
  ): Promise<FastFallbackResult> {
    const candidateText = this.buildCandidateText(stockCandidates, watchlistStocks)
    const prompt = FAST_FALLBACK_PROMPT
      .replace('{text}', text)
      .replace('{candidates}', candidateText)

    try {
      const response = await this.deps.chat(prompt)
      const parsed = this.safeParseJson(response)
      return {
        stockName: this.readString(parsed?.stock_name),
        stockCode: this.normalizeStockCode(this.readString(parsed?.stock_code)),
        viewpoint: this.readString(parsed?.viewpoint),
        operationTag: this.readString(parsed?.operation_tag),
        decisionReason: this.readStringArray(parsed?.decision_reason, 4)
      }
    } catch (error) {
      console.error('[FeishuFastParse] fallbackStep failed:', error)
      return {}
    }
  }

  private applyFallback(
    text: string,
    fallback: FastFallbackResult,
    existingCandidates: StockCandidate[],
    watchlistStocks: Array<{ code: string; name: string }>
  ): {
    selectedStock?: ExtractedStock
    stockCandidates: StockCandidate[]
    stockConfidence: number
    needsUserDisambiguation: boolean
    decisionReason: string[]
    viewpoint: '看多' | '看空' | '震荡' | '未知'
    operationTag: OperationTag
  } {
    const pool = new Map(existingCandidates.map((candidate) => [candidate.code, candidate]))
    const decisionReason = [...(fallback.decisionReason || [])]

    let matchedStock: StockInfo | undefined
    if (fallback.stockCode) {
      matchedStock = stockDatabase.getByCode(fallback.stockCode)
    }
    if (!matchedStock && fallback.stockName) {
      matchedStock = stockDatabase.getByName(fallback.stockName) || undefined
    }

    if (matchedStock) {
      const explicitMention = this.hasExplicitStockMention(text, matchedStock.code, matchedStock.name)
      const fromWatchlist = watchlistStocks.some((item) => item.code === matchedStock!.code)
      const confidence = explicitMention ? (fromWatchlist ? 0.96 : 0.92) : 0.78
      this.upsertCandidate(pool, {
        code: matchedStock.code,
        name: matchedStock.name,
        confidence,
        source: fromWatchlist ? 'watchlist' : 'llm'
      })
    }

    const stockCandidates = Array.from(pool.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5)
    const top = stockCandidates[0]
    const selectedStock = top && this.hasExplicitStockMention(text, top.code, top.name) && top.confidence >= 0.9
      ? { code: top.code, name: top.name, confidence: top.confidence }
      : undefined

    if (selectedStock) {
      decisionReason.push('FastPath: LLM 兜底后完成股票识别')
    } else {
      decisionReason.push('FastPath: LLM 兜底后仍需用户确认股票')
    }

    return {
      selectedStock,
      stockCandidates,
      stockConfidence: top?.confidence || 0,
      needsUserDisambiguation: !selectedStock,
      decisionReason,
      viewpoint: this.normalizeViewpoint(fallback.viewpoint),
      operationTag: this.normalizeOperationTag(fallback.operationTag, text)
    }
  }

  private findExactMention(
    text: string,
    stocks: Array<{ code: string; name: string }>
  ): { code: string; name: string } | null {
    const normalizedText = normalizeStockNameText(text)
    for (const stock of stocks) {
      if (!stock.name) continue
      const normalizedName = normalizeStockNameText(stock.name)
      if (normalizedName && normalizedText.includes(normalizedName)) {
        return { code: stock.code, name: stock.name }
      }
    }
    return null
  }

  private hasExplicitStockMention(text: string, stockCode: string, stockName: string): boolean {
    const codes: string[] = text.match(/\d{6}/g) || []
    if (codes.includes(stockCode)) return true
    const normalizedText = normalizeStockNameText(text)
    const normalizedStockName = normalizeStockNameText(stockName)
    return Boolean(normalizedText && normalizedStockName && normalizedText.includes(normalizedStockName))
  }

  private inferViewpoint(value: unknown): '看多' | '看空' | '震荡' | '未知' {
    const text = String(value || '').trim()
    if (!text) return '未知'
    if (/(看多|做多|偏多|继续涨|上涨|突破|强势)/.test(text)) return '看多'
    if (/(看空|做空|偏空|下跌|走弱|破位|回落)/.test(text)) return '看空'
    if (/(震荡|中性|横盘|整理|区间)/.test(text)) return '震荡'
    return '未知'
  }

  private normalizeViewpoint(value: unknown): '看多' | '看空' | '震荡' | '未知' {
    const text = String(value || '').trim()
    if (!text) return '未知'
    if (text.includes('看多')) return '看多'
    if (text.includes('看空')) return '看空'
    if (text.includes('震荡') || text.includes('中性')) return '震荡'
    return '未知'
  }

  private normalizeOperationTag(value: unknown, fallbackText: string): OperationTag {
    const text = String(value || '').trim()
    if (text.includes('买')) return '买入'
    if (text.includes('卖')) return '卖出'
    return this.inferOperationTag(fallbackText)
  }

  private inferOperationTag(text: string): OperationTag {
    const normalizedText = normalizeStockNameText(text || '')
    if (!normalizedText) return '无'
    if (/(买入|建仓|加仓|开仓|抄底|吸筹)/.test(normalizedText)) return '买入'
    if (/(卖出|减仓|止盈|止损|清仓|高抛)/.test(normalizedText)) return '卖出'
    return '无'
  }

  private buildCardDraft(input: {
    stock?: ExtractedStock
    note: ExtractedNote
    originalText: string
    stockConfidence: number
    decisionReason: string[]
  }): CardDraft | undefined {
    if (!input.stock) return undefined
    return {
      stockName: input.stock.name,
      stockCode: input.stock.code,
      viewpoint: input.note.sentiment || '未知',
      operationTag: input.note.operationTag || '无',
      keyPoints: [],
      originalText: input.originalText,
      confidence: input.stockConfidence,
      decisionReason: input.decisionReason.slice(0, 5)
    }
  }

  private buildCandidateText(
    stockCandidates: StockCandidate[],
    watchlistStocks: Array<{ code: string; name: string }>
  ): string {
    const candidates = stockCandidates.length > 0
      ? stockCandidates
        .slice(0, 8)
        .map((item) => `- ${item.name}(${item.code}), 可信度 ${(item.confidence * 100).toFixed(0)}%, 来源 ${item.source}`)
        .join('\n')
      : '无候选股票'
    const watchlist = watchlistStocks.length > 0
      ? watchlistStocks.slice(0, 20).map((item) => `- ${item.name}(${item.code})`).join('\n')
      : '无自选股'
    return `${candidates}\n自选股优先：\n${watchlist}`
  }

  private upsertCandidate(pool: Map<string, StockCandidate>, candidate: StockCandidate): void {
    const existing = pool.get(candidate.code)
    if (!existing || candidate.confidence > existing.confidence) {
      pool.set(candidate.code, candidate)
    }
  }

  private clampConfidence(confidence: number): number {
    if (Number.isNaN(confidence)) return 0
    return Math.max(0, Math.min(1, Number(confidence.toFixed(4))))
  }

  private normalizeStockCode(value?: string): string | undefined {
    if (!value) return undefined
    const matched = value.match(/(\d{6})/)
    return matched ? matched[1] : undefined
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = cleanTranscriptText(String(value))
    return normalized || undefined
  }

  private readStringArray(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item) => cleanTranscriptText(String(item || '')))
      .filter(Boolean)
      .slice(0, limit)
  }

  private safeParseJson(input: string): any {
    const cleaned = String(input || '')
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
      return {}
    }
  }

  private emptyResult(text: string): AIExtractResult {
    const cleanedText = cleanTranscriptText(toHalfWidthText(text || ''))
    return {
      stock: undefined,
      note: {
        keyPoints: [],
        sentiment: '未知',
        timeHorizon: undefined,
        operationTag: this.inferOperationTag(cleanedText)
      },
      timestamp: { type: 'none' },
      optimizedText: cleanedText,
      originalText: cleanedText,
      stockCandidates: [],
      stockConfidence: 0,
      decisionReason: ['FastPath: 空输入'],
      needsUserDisambiguation: true,
      cardDraft: undefined
    }
  }
}
