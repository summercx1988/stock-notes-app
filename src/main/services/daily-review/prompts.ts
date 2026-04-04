import type { CollectedNotes, DailySummaryData, PreMarketData, WeeklyReviewData } from './types'

const THINK_TAG_PATTERN = /<think[\s\S]*?(?:<\/think>|$)/gi
const MARKDOWN_JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/gi

function stripModelWrappers(raw: string): string {
  const source = String(raw || '').replace(/\uFEFF/g, '')
  const withoutThink = source.replace(THINK_TAG_PATTERN, '').trim()

  const fencedBlocks: string[] = []
  let matched: RegExpExecArray | null = null
  const regex = new RegExp(MARKDOWN_JSON_FENCE_PATTERN)
  while ((matched = regex.exec(withoutThink)) !== null) {
    if (matched[1]?.trim()) {
      fencedBlocks.push(matched[1].trim())
    }
  }

  if (fencedBlocks.length > 0) {
    return fencedBlocks.join('\n')
  }

  return withoutThink
}

function extractBalancedJsonCandidate(text: string): string | null {
  const content = String(text || '')
  for (let start = 0; start < content.length; start += 1) {
    const ch = content[start]
    if (ch !== '{' && ch !== '[') continue

    const stack: Array<'{' | '['> = [ch as '{' | '[']
    let inString = false
    let escaped = false

    for (let index = start + 1; index < content.length; index += 1) {
      const current = content[index]

      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (current === '\\') {
          escaped = true
          continue
        }
        if (current === '"') {
          inString = false
        }
        continue
      }

      if (current === '"') {
        inString = true
        continue
      }

      if (current === '{' || current === '[') {
        stack.push(current)
        continue
      }

      if (current === '}' || current === ']') {
        const top = stack[stack.length - 1]
        const matchedPair =
          (top === '{' && current === '}') ||
          (top === '[' && current === ']')

        if (!matchedPair) break

        stack.pop()
        if (stack.length === 0) {
          return content.slice(start, index + 1)
        }
      }
    }
  }

  return null
}

function parseModelJson(raw: string): Record<string, any> {
  const stripped = stripModelWrappers(raw).trim()
  const directCandidate = stripped
  const extractedCandidate = extractBalancedJsonCandidate(stripped)

  const candidates = [directCandidate, extractedCandidate].filter(Boolean) as string[]
  let lastError: unknown = null

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>
      }
      lastError = new Error('JSON 顶层不是对象')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('无法从响应中提取JSON对象')
}

function pickDailySummaryPayload(parsed: Record<string, any>): Record<string, any> {
  if (parsed.overview || parsed.keyDecisions) return parsed
  if (parsed.content?.overview || parsed.content?.keyDecisions) {
    return {
      ...parsed.content,
      stats: parsed.stats ?? parsed.content?.stats
    }
  }
  if (parsed.dailySummary && typeof parsed.dailySummary === 'object') {
    return parsed.dailySummary as Record<string, any>
  }
  return parsed
}

function pickPreMarketPayload(parsed: Record<string, any>): Record<string, any> {
  if (parsed.quickReview || parsed.todayStrategy) return parsed
  if (parsed.content?.quickReview || parsed.content?.todayStrategy) {
    return parsed.content as Record<string, any>
  }
  if (parsed.preMarket && typeof parsed.preMarket === 'object') {
    return parsed.preMarket as Record<string, any>
  }
  return parsed
}

function pickWeeklyPayload(parsed: Record<string, any>): Record<string, any> {
  if (parsed.weeklyOverview || parsed.performanceSummary) return parsed
  if (parsed.content?.weeklyOverview || parsed.content?.performanceSummary) {
    return parsed.content as Record<string, any>
  }
  if (parsed.weeklyReview && typeof parsed.weeklyReview === 'object') {
    return parsed.weeklyReview as Record<string, any>
  }
  return parsed
}

export function buildDailySummaryPrompt(notes: CollectedNotes): string {
  const targetDate = new Date(`${notes.date}T23:59:59`)
  const notesText = notes.entries.map((entry, index) => {
    const entryDate = new Date(entry.eventTime)
    const diffDays = Math.max(
      0,
      Math.floor((targetDate.getTime() - new Date(
        entryDate.getFullYear(),
        entryDate.getMonth(),
        entryDate.getDate()
      ).getTime()) / (24 * 60 * 60 * 1000))
    )
    const recencyLabel = diffDays <= 1 ? '主体参考(T0/T-1)' : `延续提醒(T-${diffDays})`
    return `[${index + 1}] 股票: ${entry.stockName}(${entry.stockCode})
时间: ${entry.eventTime}
时效: ${recencyLabel}
类别: ${entry.category}
观点: ${entry.viewpoint.direction} (信心: ${entry.viewpoint.confidence}, 周期: ${entry.viewpoint.timeHorizon})
操作: ${entry.operationTag}${entry.action ? ` - ${entry.action.type}${entry.action.price ? ` @${entry.action.price}元` : ''}` : ''}
内容: ${entry.contentPreview}`
  }).join('\n\n')

  return `你是一位资深的投资顾问助手。请根据以下今日投资笔记，生成一份结构化的每日总结。

## 今日笔记数据 (${notes.date})
共 ${notes.totalNotes} 条笔记，涉及 ${notes.stocksCount} 只股票

${notesText}

## 输出要求
1. 以 T0/T-1 的近期笔记为主体展开结论、决策和明日关注。
2. T-2/T-3 只做“延续性提醒”，不要平均铺开，不要喧宾夺主。
3. 若近期可执行信号不足，可明确写“继续观察/等待确认”，不要编造交易动作。
请严格按以下JSON格式输出，不要添加其他内容：
{
  "overview": "总体概述（200字以内），包含市场整体表现、主要板块动向",
  "keyDecisions": [
    {
      "stockCode": "股票代码",
      "stockName": "股票名称", 
      "action": "买入/卖出/观望",
      "reason": "决策理由（一句话）",
      "confidence": 0.8,
      "entryId": "笔记ID"
    }
  ],
  "riskAlerts": [
    {
      "level": "high/medium/low",
      "description": "风险描述",
      "relatedStocks": ["代码1"],
      "suggestion": "应对建议"
    }
  ],
  "tomorrowFocus": [
    {
      "stockCode": "股票代码",
      "stockName": "股票名称",
      "reason": "关注原因",
      "actionType": "monitor/execute/review"
    }
  ],
  "marketSentiment": "整体市场情绪判断(乐观/谨慎/悲观)"
}`
}

export function buildPreMarketPrompt(yesterdaySummary: DailySummaryData): string {
  const keyDecisionsText = yesterdaySummary.content.keyDecisions.map(d =>
    `- ${d.action} ${d.stockName}(${d.stockCode}): ${d.reason}`
  ).join('\n')

  const focusItemsText = yesterdaySummary.content.tomorrowFocus.map(f =>
    `- ${f.stockName}(${f.stockCode}): ${f.reason} [${f.actionType}]`
  ).join('\n')

  return `你是投资顾问助手。根据昨日的投资总结，为今天的交易准备盘前复习材料。

## 昨日总结 (${yesterdaySummary.generatedAt})

### 总体概述
${yesterdaySummary.content.overview}

### 关键决策
${keyDecisionsText || '无关键决策'}

### 风险提示
${yesterdaySummary.content.riskAlerts.map(r => `- [${r.level}] ${r.description}`).join('\n') || '无风险提示'}

### 明日关注
${focusItemsText || '无特别关注'}

### 市场情绪
${yesterdaySummary.content.marketSentiment}

## 输出要求
{
  "quickReview": {
    "yesterdaySummary": "昨日概要（100字以内）",
    "pendingItems": [
      {
        "stockCode": "代码",
        "stockName": "名称",
        "description": "待跟进事项",
        "priority": "high/medium/low",
        "dueDate": "期望跟进日期",
        "sourceEntryId": "来源笔记ID"
      }
    ],
    "keyLevels": [
      {
        "stockCode": "代码",
        "stockName": "名称",
        "level": "support/resistance",
        "price": 价格数字,
        "note": "备注"
      }
    ]
  },
  "todayStrategy": {
    "focusAreas": ["关注领域1"],
    "watchlist": [
      {
        "stockCode": "代码",
        "stockName": "名称",
        "reason": "观察原因",
        "expectedAction": "预期操作"
      }
    ],
    "riskReminders": ["风险提醒1"]
  }
}`
}

export function buildWeeklyPrompt(weeklySummaries: Array<{ date: string; summary: DailySummaryData }>): string {
  const summariesText = weeklySummaries.map(({ date, summary }) => `
### ${date}
- 笔记数: ${summary.stats.totalNotes}, 股票数: ${summary.stats.stocksCount}
- 操作: 买入${summary.stats.buyActions}次, 卖出${summary.stats.sellActions}次
- 概述: ${summary.content.overview}
- 关键决策: ${summary.content.keyDecisions.map(d => `${d.action}${d.stockName}`).join(', ') || '无'}
`).join('\n')

  return `你是资深投资顾问。根据本周的每日投资总结，生成本周投资回顾报告。

## 本周每日总结

${summariesText}

## 输出要求
{
  "weeklyOverview": "本周整体表现概述（200字以内）",
  "performanceSummary": {
    "winRate": 0.xx,
    "bestTrade": {"stockCode":"代码","stockName":"名称","action":"买入/卖出","reason":"理由","confidence":0.9,"entryId":"ID"} | null,
    "worstTrade": {"stockCode":"代码","stockName":"名称","action":"买入/卖出","reason":"理由","confidence":0.3,"entryId":"ID"} | null
  },
  "patternInsights": ["发现的交易模式或规律1"],
  "nextWeekFocus": [
    {
      "stockCode": "代码",
      "stockName": "名称",
      "reason": "关注原因",
      "actionType": "monitor/execute/review"
    }
  ]
}`
}

export function parseDailySummaryResponse(raw: string): DailySummaryData {
  try {
    const parsed = pickDailySummaryPayload(parseModelJson(raw))
    
    if (!parsed.overview || !Array.isArray(parsed.keyDecisions)) {
      throw new Error('Invalid response structure')
    }

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      stats: {
        totalNotes: parsed.stats?.totalNotes ?? 0,
        stocksCount: parsed.stats?.stocksCount ?? 0,
        buyActions: parsed.stats?.buyActions ?? 0,
        sellActions: parsed.stats?.sellActions ?? 0,
        bullishNotes: parsed.stats?.bullishNotes ?? 0,
        bearishNotes: parsed.stats?.bearishNotes ?? 0
      },
      content: {
        overview: String(parsed.overview || ''),
        keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
        riskAlerts: Array.isArray(parsed.riskAlerts) ? parsed.riskAlerts : [],
        tomorrowFocus: Array.isArray(parsed.tomorrowFocus) ? parsed.tomorrowFocus : [],
        marketSentiment: String(parsed.marketSentiment || '中性')
      },
      relatedEntries: []
    }
  } catch (error) {
    console.error('[DailyReview] Failed to parse daily summary response:', error)
    throw new Error(`解析AI响应失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function parsePreMarketResponse(raw: string): PreMarketData {
  try {
    const parsed = pickPreMarketPayload(parseModelJson(raw))

    if (!parsed.quickReview || !parsed.todayStrategy) {
      throw new Error('Invalid response structure')
    }

    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      sourceSummaryDate: '',
      quickReview: {
        yesterdaySummary: String(parsed.quickReview?.yesterdaySummary || ''),
        pendingItems: Array.isArray(parsed.quickReview?.pendingItems) ? parsed.quickReview.pendingItems : [],
        keyLevels: Array.isArray(parsed.quickReview?.keyLevels) ? parsed.quickReview.keyLevels : []
      },
      todayStrategy: {
        focusAreas: Array.isArray(parsed.todayStrategy?.focusAreas) ? parsed.todayStrategy.focusAreas : [],
        watchlist: Array.isArray(parsed.todayStrategy?.watchlist) ? parsed.todayStrategy.watchlist : [],
        riskReminders: Array.isArray(parsed.todayStrategy?.riskReminders) ? parsed.todayStrategy.riskReminders : []
      }
    }
  } catch (error) {
    console.error('[DailyReview] Failed to parse premarket response:', error)
    throw new Error(`解析盘前复习响应失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function parseWeeklyResponse(raw: string): WeeklyReviewData {
  try {
    const parsed = pickWeeklyPayload(parseModelJson(raw))

    if (!parsed.weeklyOverview || !parsed.performanceSummary) {
      throw new Error('Invalid response structure')
    }

    return {
      version: '1.0',
      weekStart: '',
      weekEnd: '',
      summaryDates: [],
      content: {
        weeklyOverview: String(parsed.weeklyOverview || ''),
        performanceSummary: {
          winRate: Number(parsed.performanceSummary?.winRate) || 0,
          bestTrade: parsed.performanceSummary?.bestTrade || null,
          worstTrade: parsed.performanceSummary?.worstTrade || null
        },
        patternInsights: Array.isArray(parsed.patternInsights) ? parsed.patternInsights : [],
        nextWeekFocus: Array.isArray(parsed.nextWeekFocus) ? parsed.nextWeekFocus : []
      }
    }
  } catch (error) {
    console.error('[DailyReview] Failed to parse weekly response:', error)
    throw new Error(`解析周回顾响应失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}
