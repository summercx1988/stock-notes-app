import { stockNameMatcher } from './stock-matcher'
import { stockDatabase } from './stock-db'
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
import { cleanTranscriptText, normalizeStockNameText, normalizeToSimplifiedChinese, toHalfWidthText } from '../../shared/text-normalizer'

interface ParseOrchestratorDeps {
  chat(prompt: string): Promise<string>
}

interface PrimaryExtractResult {
  correctedText?: string
  stockName?: string
  stockCode?: string
  viewpoint?: string
  operationTag?: string
  keyPoints?: string[]
  decisionReason?: string[]
}

interface SecondaryExtractResult {
  stockName?: string
  stockCode?: string
  viewpoint?: string
  operationTag?: string
  keyPoints?: string[]
  decisionReason?: string[]
}

interface ParseMetrics {
  totalRequests: number
  stockResolved: number
  disambiguationRequired: number
}

const PRIMARY_EXTRACT_PROMPT = `你是股票笔记结构化助手。请解析文本并只返回JSON（不要额外解释）：

文本：
{text}

候选股票（可能相关）：
{candidates}

输出格式：
{
  "corrected_text": "纠正后的简体中文文本",
  "stock_name": "股票名或空字符串",
  "stock_code": "6位代码或空字符串",
  "viewpoint": "看多|看空|震荡|未知",
  "operation_tag": "买入|卖出|无",
  "key_points": ["要点1","要点2"],
  "decision_reason": ["简短原因1","简短原因2"]
}

要求：
- 仅返回JSON；
- 不确定股票时，股票字段返回空字符串；
- key_points 最多 5 条；
- 输出默认使用简体中文。`

const SECOND_PASS_PROMPT = `你是股票笔记字段补全助手。仅根据输入补全缺失字段并返回JSON（不要额外解释）：

文本：
{text}

候选股票（按置信度排序）：
{candidates}

当前字段：
{current}

输出格式：
{
  "stock_name": "股票名或空字符串",
  "stock_code": "6位代码或空字符串",
  "viewpoint": "看多|看空|震荡|未知",
  "operation_tag": "买入|卖出|无",
  "key_points": ["要点1","要点2"],
  "decision_reason": ["补全原因1","补全原因2"]
}

规则：
- 只填你有把握的字段；
- 无法确定就返回空字符串或空数组；
- 仅返回JSON。`

export class ParseOrchestrator {
  private static metrics: ParseMetrics = {
    totalRequests: 0,
    stockResolved: 0,
    disambiguationRequired: 0
  }

  constructor(private readonly deps: ParseOrchestratorDeps) {}

  async run(text: string): Promise<AIExtractResult> {
    const traceId = createTraceId('extract')
    const startedAt = Date.now()
    ParseOrchestrator.metrics.totalRequests += 1
    logPipelineEvent({
      traceId,
      stage: 'extract',
      status: 'start',
      message: 'orchestrator_start'
    })

    const normalizedInput = this.normalizeStep(text)
    if (!normalizedInput.cleanedText) {
      const empty = this.emptyResult(text)
      logPipelineEvent({
        traceId,
        stage: 'extract',
        status: 'success',
        durationMs: Date.now() - startedAt,
        message: 'empty_input'
      })
      return empty
    }

    await stockNameMatcher.load()
    await stockDatabase.ensureLoaded()
    const watchlistCodes = await watchlistService.getCodes()
    const watchlistStocks = watchlistCodes
      .map((code) => stockDatabase.getByCode(code))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 60)

    const localCandidates = stockNameMatcher.findAllCandidates(normalizedInput.cleanedText)
    const candidateText = this.buildCandidateText(localCandidates, watchlistStocks)
    const decisionReason: string[] = ['NormalizeStep: 输入已标准化并转为简体中文']

    const extractStartedAt = Date.now()
    const primary = await this.extractStep(normalizedInput.cleanedText, candidateText)
    let llmCalls = 1
    decisionReason.push(...(primary.decisionReason || []).slice(0, 3))
    logPipelineEvent({
      traceId,
      stage: 'extract',
      status: 'success',
      durationMs: Date.now() - extractStartedAt,
      message: 'ExtractStep',
      extra: { llm_calls: llmCalls }
    })

    const correctedText = this.normalizeStep(primary.correctedText || normalizedInput.cleanedText).cleanedText
    const merged = this.mergePrimaryFields(primary, correctedText)
    const shouldRunSecondPass = this.shouldRunSecondPass(merged, localCandidates)

    if (shouldRunSecondPass && llmCalls < 2) {
      const secondStartedAt = Date.now()
      const secondary = await this.secondPassStep(correctedText, candidateText, merged)
      llmCalls += 1
      this.mergeSecondaryFields(merged, secondary)
      decisionReason.push(...(secondary.decisionReason || []).slice(0, 2))
      decisionReason.push('ExtractStep: 已执行二次补全')
      logPipelineEvent({
        traceId,
        stage: 'extract',
        status: 'success',
        durationMs: Date.now() - secondStartedAt,
        message: 'SecondPassStep',
        extra: { llm_calls: llmCalls }
      })
    }

    const verifyStartedAt = Date.now()
    const verified = this.verifyStep({
      text: correctedText,
      stockName: merged.stockName,
      stockCode: merged.stockCode,
      localCandidates,
      watchlistStocks
    })
    decisionReason.push(...verified.decisionReason)
    logPipelineEvent({
      traceId,
      stage: 'match',
      status: verified.selectedStock ? 'success' : 'error',
      stockCode: verified.selectedStock?.code,
      durationMs: Date.now() - verifyStartedAt,
      errorCode: verified.selectedStock ? undefined : 'STOCK_NOT_FOUND',
      message: 'VerifyStep',
      extra: { needs_user_disambiguation: verified.needsUserDisambiguation }
    })

    const note: ExtractedNote = {
      keyPoints: merged.keyPoints.length > 0 ? merged.keyPoints : this.extractKeyPointsByRule(correctedText),
      sentiment: this.normalizeViewpoint(merged.viewpoint),
      timeHorizon: undefined,
      operationTag: this.normalizeOperationTag(merged.operationTag, correctedText)
    }

    const cardDraft = this.cardDraftStep({
      stock: verified.selectedStock,
      note,
      originalText: correctedText,
      stockConfidence: verified.stockConfidence,
      decisionReason
    })

    const finalResult = this.finalizeStep({
      selectedStock: verified.selectedStock,
      note,
      originalText: normalizedInput.cleanedText,
      optimizedText: correctedText,
      stockCandidates: verified.stockCandidates,
      stockConfidence: verified.stockConfidence,
      decisionReason,
      needsUserDisambiguation: verified.needsUserDisambiguation,
      cardDraft
    })

    if (finalResult.stock) {
      ParseOrchestrator.metrics.stockResolved += 1
    }
    if (finalResult.needsUserDisambiguation) {
      ParseOrchestrator.metrics.disambiguationRequired += 1
    }
    this.logMetricsSnapshot()

    logPipelineEvent({
      traceId,
      stage: 'extract',
      status: 'success',
      stockCode: finalResult.stock?.code,
      durationMs: Date.now() - startedAt,
      message: 'orchestrator_done',
      extra: {
        llm_calls: llmCalls,
        stock_candidates: finalResult.stockCandidates.length,
        needs_user_disambiguation: finalResult.needsUserDisambiguation
      }
    })

    return finalResult
  }

  private normalizeStep(text: string): { cleanedText: string } {
    const normalized = normalizeToSimplifiedChinese(toHalfWidthText(text || ''))
    return {
      cleanedText: cleanTranscriptText(normalized)
    }
  }

  private async extractStep(text: string, candidates: string): Promise<PrimaryExtractResult> {
    const prompt = PRIMARY_EXTRACT_PROMPT
      .replace('{text}', text)
      .replace('{candidates}', candidates)
    try {
      const response = await this.deps.chat(prompt)
      const parsed = this.safeParseJson(response)
      return {
        correctedText: this.readString(parsed?.corrected_text),
        stockName: this.readString(parsed?.stock_name),
        stockCode: this.readString(parsed?.stock_code),
        viewpoint: this.readString(parsed?.viewpoint),
        operationTag: this.readString(parsed?.operation_tag),
        keyPoints: this.readStringArray(parsed?.key_points, 5),
        decisionReason: this.readStringArray(parsed?.decision_reason, 5)
      }
    } catch (error) {
      console.error('[ParseOrchestrator] extractStep failed:', error)
      return {}
    }
  }

  private async secondPassStep(
    text: string,
    candidates: string,
    current: PrimaryExtractResult
  ): Promise<SecondaryExtractResult> {
    const prompt = SECOND_PASS_PROMPT
      .replace('{text}', text)
      .replace('{candidates}', candidates)
      .replace('{current}', JSON.stringify(current, null, 2))
    try {
      const response = await this.deps.chat(prompt)
      const parsed = this.safeParseJson(response)
      return {
        stockName: this.readString(parsed?.stock_name),
        stockCode: this.readString(parsed?.stock_code),
        viewpoint: this.readString(parsed?.viewpoint),
        operationTag: this.readString(parsed?.operation_tag),
        keyPoints: this.readStringArray(parsed?.key_points, 5),
        decisionReason: this.readStringArray(parsed?.decision_reason, 5)
      }
    } catch (error) {
      console.error('[ParseOrchestrator] secondPassStep failed:', error)
      return {}
    }
  }

  private verifyStep(input: {
    text: string
    stockName?: string
    stockCode?: string
    localCandidates: Array<{ segment: string; stock: { code: string; name: string }; confidence: number }>
    watchlistStocks: Array<{ code: string; name: string }>
  }): {
    selectedStock?: ExtractedStock
    stockCandidates: StockCandidate[]
    stockConfidence: number
    needsUserDisambiguation: boolean
    decisionReason: string[]
  } {
    const pool = new Map<string, StockCandidate>()
    const decisionReason: string[] = []

    for (const candidate of input.localCandidates.slice(0, 8)) {
      this.upsertCandidate(pool, {
        code: candidate.stock.code,
        name: candidate.stock.name,
        confidence: this.clampConfidence(candidate.confidence),
        source: 'rule'
      })
    }

    if (input.stockCode) {
      const stock = stockDatabase.getByCode(input.stockCode)
      if (stock) {
        this.upsertCandidate(pool, {
          code: stock.code,
          name: stock.name,
          confidence: 0.93,
          source: 'llm'
        })
      }
    } else if (input.stockName) {
      const byName = stockNameMatcher.findByName(input.stockName)
      if (byName) {
        this.upsertCandidate(pool, {
          code: byName.code,
          name: byName.name,
          confidence: this.clampConfidence(Math.max(0.75, byName.confidence)),
          source: 'llm'
        })
      }
    }

    const dbMatch = stockDatabase.matchStock(input.text)
    if (dbMatch) {
      this.upsertCandidate(pool, {
        code: dbMatch.stock.code,
        name: dbMatch.stock.name,
        confidence: this.clampConfidence(Math.max(0.6, dbMatch.score / 100)),
        source: 'db'
      })
    }

    const watchlistMatch = this.findWatchlistMatch(input.text, input.watchlistStocks)
    if (watchlistMatch) {
      this.upsertCandidate(pool, {
        code: watchlistMatch.code,
        name: watchlistMatch.name,
        confidence: 0.95,
        source: 'watchlist'
      })
    }

    const sortedCandidates = Array.from(pool.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5)

    const top = sortedCandidates[0]
    const second = sortedCandidates[1]
    const explicitStock = top ? this.hasExplicitStockMention(input.text, top.code, top.name) : false
    const closeRace = Boolean(top && second && (top.confidence - second.confidence) <= 0.08)

    if (!top) {
      decisionReason.push('VerifyStep: 未形成有效股票候选')
      return {
        selectedStock: undefined,
        stockCandidates: [],
        stockConfidence: 0,
        needsUserDisambiguation: true,
        decisionReason
      }
    }

    const needsUserDisambiguation = !explicitStock || top.confidence < 0.9 || closeRace
    if (needsUserDisambiguation) {
      decisionReason.push('VerifyStep: 股票置信度不足或候选冲突，需用户确认')
    } else {
      decisionReason.push('VerifyStep: 股票识别置信度充足，自动进入确认卡片')
    }

    return {
      selectedStock: {
        code: top.code,
        name: top.name,
        confidence: top.confidence
      },
      stockCandidates: sortedCandidates,
      stockConfidence: top.confidence,
      needsUserDisambiguation,
      decisionReason
    }
  }

  private cardDraftStep(input: {
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
      keyPoints: input.note.keyPoints,
      originalText: input.originalText,
      confidence: input.stockConfidence,
      decisionReason: input.decisionReason.slice(0, 5)
    }
  }

  private finalizeStep(input: {
    selectedStock?: ExtractedStock
    note: ExtractedNote
    originalText: string
    optimizedText: string
    stockCandidates: StockCandidate[]
    stockConfidence: number
    decisionReason: string[]
    needsUserDisambiguation: boolean
    cardDraft?: CardDraft
  }): AIExtractResult {
    return {
      stock: input.selectedStock,
      note: input.note,
      timestamp: { type: 'none' },
      optimizedText: input.optimizedText,
      originalText: input.originalText,
      stockCandidates: input.stockCandidates,
      stockConfidence: input.stockConfidence,
      decisionReason: input.decisionReason.slice(0, 8),
      needsUserDisambiguation: input.needsUserDisambiguation,
      cardDraft: input.cardDraft
    }
  }

  private mergePrimaryFields(
    primary: PrimaryExtractResult,
    correctedText: string
  ): {
    stockName?: string
    stockCode?: string
    viewpoint?: string
    operationTag?: string
    keyPoints: string[]
  } {
    return {
      stockName: primary.stockName,
      stockCode: this.normalizeStockCode(primary.stockCode),
      viewpoint: primary.viewpoint,
      operationTag: primary.operationTag,
      keyPoints: primary.keyPoints && primary.keyPoints.length > 0
        ? primary.keyPoints
        : this.extractKeyPointsByRule(correctedText)
    }
  }

  private mergeSecondaryFields(
    current: {
      stockName?: string
      stockCode?: string
      viewpoint?: string
      operationTag?: string
      keyPoints: string[]
    },
    secondary: SecondaryExtractResult
  ): void {
    if (!current.stockCode && secondary.stockCode) {
      current.stockCode = this.normalizeStockCode(secondary.stockCode)
    }
    if (!current.stockName && secondary.stockName) {
      current.stockName = secondary.stockName
    }
    if ((!current.viewpoint || this.normalizeViewpoint(current.viewpoint) === '未知') && secondary.viewpoint) {
      current.viewpoint = secondary.viewpoint
    }
    if (!current.operationTag && secondary.operationTag) {
      current.operationTag = secondary.operationTag
    }
    if (current.keyPoints.length === 0 && secondary.keyPoints && secondary.keyPoints.length > 0) {
      current.keyPoints = secondary.keyPoints
    }
  }

  private shouldRunSecondPass(
    current: {
      stockName?: string
      stockCode?: string
      viewpoint?: string
      operationTag?: string
      keyPoints: string[]
    },
    localCandidates: Array<{ segment: string; stock: { code: string; name: string }; confidence: number }>
  ): boolean {
    const missingStock = !current.stockCode && localCandidates.length > 0
    const missingKeyPoints = current.keyPoints.length === 0
    const unknownViewpoint = this.normalizeViewpoint(current.viewpoint) === '未知'
    return missingStock || missingKeyPoints || unknownViewpoint
  }

  private normalizeViewpoint(value: unknown): '看多' | '看空' | '震荡' | '未知' {
    if (typeof value !== 'string') return '未知'
    const text = value.trim()
    if (!text) return '未知'
    if (text.includes('看多') || text === '多' || text.includes('bull')) return '看多'
    if (text.includes('看空') || text === '空' || text.includes('bear')) return '看空'
    if (text.includes('震荡') || text.includes('中性') || text.includes('横盘')) return '震荡'
    return '未知'
  }

  private normalizeOperationTag(value: unknown, fallbackText: string): OperationTag {
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized.includes('买')) return '买入'
      if (normalized.includes('卖')) return '卖出'
      if (normalized.includes('无') || normalized.includes('没有')) return '无'
    }
    return this.inferOperationTag(fallbackText)
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

  private extractKeyPointsByRule(text: string): string[] {
    return text
      .split(/[。！？\n]/g)
      .map((line) => line.trim())
      .filter((line) => line.length >= 6)
      .slice(0, 5)
  }

  private normalizeStockCode(code?: string): string | undefined {
    if (!code) return undefined
    const matched = String(code).match(/(\d{6})/)
    return matched ? matched[1] : undefined
  }

  private findWatchlistMatch(
    text: string,
    watchlistStocks: Array<{ code: string; name: string }>
  ): { code: string; name: string } | null {
    if (watchlistStocks.length === 0) return null
    const normalizedText = normalizeStockNameText(text)
    const textCodes = text.match(/\d{6}/g) || []

    for (const code of textCodes) {
      const stock = watchlistStocks.find((item) => item.code === code)
      if (stock) return { code: stock.code, name: stock.name }
    }

    for (const stock of watchlistStocks) {
      if (normalizedText.includes(normalizeStockNameText(stock.name))) {
        return { code: stock.code, name: stock.name }
      }
    }

    return null
  }

  private hasExplicitStockMention(text: string, stockCode: string, stockName: string): boolean {
    const codes: string[] = text.match(/\d{6}/g) ?? []
    if (codes.includes(stockCode)) return true
    const normalizedText = normalizeStockNameText(text)
    const normalizedStockName = normalizeStockNameText(stockName)
    if (!normalizedText || !normalizedStockName) return false
    return normalizedText.includes(normalizedStockName)
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

  private buildCandidateText(
    localCandidates: Array<{ segment: string; stock: { code: string; name: string }; confidence: number }>,
    watchlistStocks: Array<{ code: string; name: string }>
  ): string {
    const topLocal = localCandidates
      .slice(0, 8)
      .map((item) => `- "${item.segment}" => ${item.stock.name}(${item.stock.code}), 可信度 ${(item.confidence * 100).toFixed(0)}%`)
      .join('\n')
    const watchlist = watchlistStocks.length > 0
      ? `\n自选股优先：\n${watchlistStocks.slice(0, 20).map((item) => `- ${item.name}(${item.code})`).join('\n')}`
      : '\n自选股优先：无'
    return `${topLocal || '无候选股票'}${watchlist}`
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = cleanTranscriptText(value)
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
    return {
      stock: undefined,
      note: {
        keyPoints: [],
        sentiment: '未知',
        timeHorizon: undefined,
        operationTag: this.inferOperationTag(text)
      },
      timestamp: { type: 'none' },
      optimizedText: cleanTranscriptText(text),
      originalText: cleanTranscriptText(text),
      stockCandidates: [],
      stockConfidence: 0,
      decisionReason: ['NormalizeStep: 空输入'],
      needsUserDisambiguation: true,
      cardDraft: undefined
    }
  }

  private logMetricsSnapshot(): void {
    const metrics = ParseOrchestrator.metrics
    if (metrics.totalRequests % 20 !== 0) return
    const stockResolvedRate = metrics.totalRequests > 0
      ? Number((metrics.stockResolved / metrics.totalRequests).toFixed(4))
      : 0
    const disambiguationRate = metrics.totalRequests > 0
      ? Number((metrics.disambiguationRequired / metrics.totalRequests).toFixed(4))
      : 0

    console.log('[ParseOrchestrator][Metrics]', JSON.stringify({
      total_requests: metrics.totalRequests,
      stock_resolved: metrics.stockResolved,
      stock_resolved_rate: stockResolvedRate,
      disambiguation_required: metrics.disambiguationRequired,
      disambiguation_rate: disambiguationRate
    }))
  }
}
