import type { EnumOptionConfig, NoteCategoryConfig } from './types'

const toOption = (code: string, label: string, order: number): EnumOptionConfig => ({
  code,
  label,
  enabled: true,
  order
})

const DEFAULT_VIEWPOINT_FALLBACK = toOption('未知', '未知', 1)
const DEFAULT_OPERATION_FALLBACK = toOption('无', '无', 1)
const DEFAULT_HORIZON_FALLBACK = toOption('短线', '短线', 1)

export const BUILTIN_CATEGORY_CODES = ['看盘预测', '操盘打标'] as const
const BUILTIN_CATEGORY_CODE_SET = new Set<string>(BUILTIN_CATEGORY_CODES)

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
    code: '操盘打标',
    label: '操盘打标',
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
        enabled: true,
        options: [
          toOption('无', '无', 1),
          toOption('买入', '买入', 2),
          toOption('卖出', '卖出', 3)
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

export const isBuiltInCategoryCode = (code?: string): boolean =>
  Boolean(code && BUILTIN_CATEGORY_CODE_SET.has(code))

const normalizeOptions = (options: EnumOptionConfig[] | undefined, fallback: EnumOptionConfig[]): EnumOptionConfig[] => {
  const source = Array.isArray(options) && options.length > 0 ? options : fallback
  const normalized = source
    .map((item, index) => ({
      code: String(item?.code || '').trim(),
      label: String(item?.label || item?.code || '').trim(),
      enabled: item?.enabled !== false,
      order: Number.isFinite(item?.order) ? Number(item.order) : index + 1
    }))
    .filter((item) => item.code.length > 0)
    .sort((left, right) => left.order - right.order)
  return normalized.filter((item, index, array) => array.findIndex((other) => other.code === item.code) === index)
}

const normalizeField = (params: {
  input: NoteCategoryConfig['fields']['viewpoint'] | NoteCategoryConfig['fields']['operationTag'] | NoteCategoryConfig['fields']['timeHorizon'] | undefined
  fallback: NoteCategoryConfig['fields']['viewpoint'] | NoteCategoryConfig['fields']['operationTag'] | NoteCategoryConfig['fields']['timeHorizon'] | undefined
  defaultOption: EnumOptionConfig
}) => {
  const { input, fallback, defaultOption } = params
  const enabled = input?.enabled ?? fallback?.enabled ?? false
  const options = normalizeOptions(input?.options, fallback?.options || [])
  return {
    enabled,
    options: options.length > 0 ? options : [clone(defaultOption)]
  }
}

export const normalizeNoteCategoryConfigs = (configs?: NoteCategoryConfig[]): NoteCategoryConfig[] => {
  const fallbackByCode = new Map(DEFAULT_NOTE_CATEGORY_CONFIGS.map((item) => [item.code, item]))
  const input = Array.isArray(configs) && configs.length > 0 ? configs : DEFAULT_NOTE_CATEGORY_CONFIGS

  const normalized = input
    .map((item) => {
      const code = String(item?.code || '').trim()
      if (!code) return null
      const fallback = fallbackByCode.get(code)
      if (fallback) {
        return clone(fallback)
      }
      return {
        code,
        label: String(item?.label || code).trim() || code,
        enabled: item?.enabled !== false,
        reviewEligible: Boolean(item?.reviewEligible),
        builtIn: false,
        fields: {
          viewpoint: normalizeField({
            input: item?.fields?.viewpoint,
            fallback: fallback?.fields.viewpoint,
            defaultOption: DEFAULT_VIEWPOINT_FALLBACK
          }),
          operationTag: normalizeField({
            input: item?.fields?.operationTag,
            fallback: fallback?.fields.operationTag,
            defaultOption: DEFAULT_OPERATION_FALLBACK
          }),
          timeHorizon: normalizeField({
            input: item?.fields?.timeHorizon,
            fallback: fallback?.fields.timeHorizon,
            defaultOption: DEFAULT_HORIZON_FALLBACK
          })
        }
      } as NoteCategoryConfig
    })
    .filter((item): item is NoteCategoryConfig => Boolean(item))
    .filter((item, index, array) => array.findIndex((other) => other.code === item.code) === index)

  for (const builtin of DEFAULT_NOTE_CATEGORY_CONFIGS) {
    if (!normalized.some((item) => item.code === builtin.code)) {
      normalized.push(clone(builtin))
    }
  }

  const builtins = DEFAULT_NOTE_CATEGORY_CONFIGS.map((builtin) =>
    normalized.find((item) => item.code === builtin.code) || clone(builtin)
  )
  const custom = normalized.filter((item) => !BUILTIN_CATEGORY_CODE_SET.has(item.code))
  return [...builtins, ...custom]
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
