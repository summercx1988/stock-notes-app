export type ViewpointDirection = '看多' | '看空' | '中性' | '观望'
export type TimeHorizon = '短线' | '中线' | '长线'
export type ActionType = '买入' | '卖出' | '持有' | '观望'

export interface Viewpoint {
  direction: ViewpointDirection
  confidence: number
  timeHorizon: TimeHorizon
}

export interface Action {
  type: ActionType
  price?: number
  quantity?: number
  reason?: string
}

export interface TopicCategory {
  id: string
  name: string
  description?: string
  viewpointOptions?: ViewpointDirection[]
  actionOptions?: ActionType[]
  customFields?: FieldDefinition[]
}

export interface FieldDefinition {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'date'
  required?: boolean
  options?: string[]
  defaultValue?: any
}

export interface TopicConfig {
  id: string
  name: string
  description?: string
  icon?: string
  categories: TopicCategory[]
  validationRules?: ValidationRule[]
  aiPrompts?: AIPrompts
}

export interface AIPrompts {
  extractViewpoint?: string
  optimizeText?: string
  summarize?: string
  calibrate?: string
}

export interface ValidationRule {
  field: string
  type: 'required' | 'range' | 'pattern' | 'custom'
  message: string
  params?: any
}

export interface CalibrationResult {
  isValid: boolean
  confidence: number
  matchedFields: MatchedField[]
  suggestions: string[]
  score: number
}

export interface MatchedField {
  field: string
  expected: string
  actual: string
  similarity: number
}

export interface TopicDetectionResult {
  detected: boolean
  topicId?: string
  confidence: number
  suggestions?: string[]
}

const STOCK_VIEWPOINT_OPTIONS: ViewpointDirection[] = ['看多', '看空', '中性', '观望']
const STOCK_ACTION_OPTIONS: ActionType[] = ['买入', '卖出', '持有', '观望']

const stockCategories: TopicCategory[] = [
  {
    id: 'viewpoint',
    name: '投资观点',
    description: '对股票走势的看法',
    viewpointOptions: STOCK_VIEWPOINT_OPTIONS
  },
  {
    id: 'action',
    name: '操作记录',
    description: '买入卖出等操作',
    actionOptions: STOCK_ACTION_OPTIONS,
    customFields: [
      { id: 'price', name: '价格', type: 'number', required: false },
      { id: 'quantity', name: '数量', type: 'number', required: false },
      { id: 'reason', name: '理由', type: 'string', required: false }
    ]
  }
]

const stockValidationRules: ValidationRule[] = [
  { field: 'viewpoint.direction', type: 'required', message: '请选择观点方向' },
  { field: 'viewpoint.confidence', type: 'range', message: '信心值需要在0-1之间', params: { min: 0, max: 1 } }
]

const stockAiPrompts: AIPrompts = {
  extractViewpoint: `分析以下投资笔记，提取投资观点：

{text}

请以JSON格式返回：
{
  "direction": "看多/看空/中性/观望",
  "confidence": 0.0-1.0,
  "timeHorizon": "短线/中线/长线"
}`,
  optimizeText: `请优化以下语音转文字内容，要求：
1. 去除"嗯"、"啊"等口语化表达
2. 修正语法错误和标点符号
3. 保持原文的投资逻辑和专业术语
4. 不要添加原文没有的内容

原文：
{text}

请直接输出优化后的文本：`,
  calibrate: `校准以下投资笔记中的主题信息：

提取的主题：{extractedTopic}
笔记内容：{content}

请判断：
1. 主题是否与内容匹配（0-100分）
2. 提取的观点是否准确
3. 是否有遗漏的关键信息
4. 建议的修正方向`
}

export const STOCK_TOPIC_CONFIG: TopicConfig = {
  id: 'stock',
  name: '股票投资',
  description: '专注于股票投资的笔记管理',
  icon: '📈',
  categories: stockCategories,
  validationRules: stockValidationRules,
  aiPrompts: stockAiPrompts
}

const TOPIC_REGISTRY: Map<string, TopicConfig> = new Map()

export function registerTopic(config: TopicConfig): void {
  TOPIC_REGISTRY.set(config.id, config)
}

export function getTopic(topicId: string): TopicConfig | undefined {
  return TOPIC_REGISTRY.get(topicId)
}

export function getAllTopics(): TopicConfig[] {
  return Array.from(TOPIC_REGISTRY.values())
}

export function getDefaultTopic(): TopicConfig {
  return STOCK_TOPIC_CONFIG
}

export class TopicCalibrator {
  private topicConfig: TopicConfig

  constructor(topicConfig: TopicConfig = STOCK_TOPIC_CONFIG) {
    this.topicConfig = topicConfig
  }

  calibrate(content: string, extractedTopic: any): CalibrationResult {
    const matchedFields: MatchedField[] = []
    const suggestions: string[] = []
    let totalSimilarity = 0
    let score = 100

    if (this.topicConfig.id === 'stock') {
      const stockKeywords = ['股票', '股价', '买入', '卖出', '持有', '涨', '跌', '上证', '深证', 'A股']
      const hasStockContent = stockKeywords.some(k => content.includes(k))

      if (!hasStockContent) {
        suggestions.push('内容中未检测到明显的股票投资相关关键词')
        score -= 30
      }

      if (extractedTopic.direction) {
        const validDirections = ['看多', '看空', '中性', '观望']
        if (!validDirections.includes(extractedTopic.direction)) {
          suggestions.push(`观点方向"${extractedTopic.direction}"不在标准选项中`)
          matchedFields.push({
            field: 'direction',
            expected: validDirections.join(', '),
            actual: extractedTopic.direction,
            similarity: 0
          })
          score -= 20
        } else {
          matchedFields.push({
            field: 'direction',
            expected: '标准观点方向',
            actual: extractedTopic.direction,
            similarity: 100
          })
          totalSimilarity += 100
        }
      }

      if (extractedTopic.confidence !== undefined) {
        if (extractedTopic.confidence < 0.5) {
          suggestions.push('观点信心较低，可能需要更多信息来确认')
          score -= 15
        }
        matchedFields.push({
          field: 'confidence',
          expected: '0.5-1.0',
          actual: String(extractedTopic.confidence),
          similarity: extractedTopic.confidence >= 0.5 ? 100 : 0
        })
        totalSimilarity += extractedTopic.confidence * 100
      }
    }

    const avgSimilarity = matchedFields.length > 0 ? totalSimilarity / matchedFields.length : 0
    score = Math.min(100, Math.max(0, score))

    return {
      isValid: score >= 70,
      confidence: avgSimilarity / 100,
      matchedFields,
      suggestions,
      score
    }
  }
}

export class TopicDetector {
  detectTopic(content: string): TopicDetectionResult {
    const stockKeywords = ['股票', '股价', '买入', '卖出', '持有', '涨跌', '上证', '深证', 'A股', '港股', '美股', '指数', '大盘', 'K线']
    const stockMatches = stockKeywords.filter(k => content.includes(k)).length

    if (stockMatches >= 2) {
      return {
        detected: true,
        topicId: 'stock',
        confidence: Math.min(stockMatches / stockKeywords.length * 2, 1)
      }
    }

    if (stockMatches >= 1) {
      return {
        detected: true,
        topicId: 'stock',
        confidence: 0.4,
        suggestions: ['检测到股票相关关键词，建议确认是否记录股票投资笔记']
      }
    }

    return {
      detected: false,
      confidence: 0,
      suggestions: ['未检测到特定主题内容']
    }
  }
}

registerTopic(STOCK_TOPIC_CONFIG)
