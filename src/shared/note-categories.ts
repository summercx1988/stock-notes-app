import type { EnumOptionConfig, NoteCategoryConfig } from './types'

const toOption = (code: string, label: string, order: number): EnumOptionConfig => ({
  code,
  label,
  enabled: true,
  order
})

export const DEFAULT_NOTE_CATEGORY_CONFIGS: NoteCategoryConfig[] = [
  {
    code: '看盘预测',
    label: '看盘预测',
    enabled: true,
    reviewEligible: true,
    builtIn: true,
    fields: {
      viewpoint: {
        enabled: true,
        options: [
          toOption('看多', '看多', 1),
          toOption('看空', '看空', 2),
          toOption('中性', '中性', 3),
          toOption('未知', '未知', 4)
        ]
      },
      operationTag: {
        enabled: true,
        options: [
          toOption('无', '无', 1),
          toOption('买入', '买入', 2),
          toOption('卖出', '卖出', 3)
        ]
      },
      timeHorizon: {
        enabled: true,
        options: [
          toOption('短线', '短线', 1),
          toOption('中线', '中线', 2),
          toOption('长线', '长线', 3)
        ]
      }
    }
  },
  {
    code: '普通笔记',
    label: '普通笔记',
    enabled: true,
    reviewEligible: false,
    builtIn: true,
    fields: {
      viewpoint: {
        enabled: false,
        options: [
          toOption('未知', '未知', 1)
        ]
      },
      operationTag: {
        enabled: false,
        options: [
          toOption('无', '无', 1)
        ]
      },
      timeHorizon: {
        enabled: false,
        options: [
          toOption('短线', '短线', 1)
        ]
      }
    }
  }
]

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const normalizeNoteCategoryConfigs = (configs?: NoteCategoryConfig[]): NoteCategoryConfig[] => {
  const input = Array.isArray(configs) ? configs : []
  const mapByCode = new Map<string, NoteCategoryConfig>()
  for (const item of input) {
    const code = String(item?.code || '').trim()
    if (!code) continue
    mapByCode.set(code, item)
  }
  return DEFAULT_NOTE_CATEGORY_CONFIGS.map((builtin) => {
    const incoming = mapByCode.get(builtin.code)
    return {
      ...clone(builtin),
      enabled: incoming?.enabled !== false
    }
  })
}

export const getCategoryConfig = (configs: NoteCategoryConfig[], code?: string): NoteCategoryConfig | null => {
  if (!Array.isArray(configs) || configs.length === 0) return null
  if (code) {
    const byCode = configs.find((item) => item.code === code)
    if (byCode) return byCode
  }
  return configs.find((item) => item.enabled) || configs[0]
}

export const getEnabledOptions = (options: EnumOptionConfig[]): EnumOptionConfig[] =>
  (options || []).filter((item) => item.enabled !== false).sort((left, right) => left.order - right.order)
