import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Divider, Form, Input, Modal, Select, Space, Tabs, Tag, Typography, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { NoteCategoryConfig, UserSettings } from '../../shared/types'
import {
  DEFAULT_NOTE_CATEGORY_CONFIGS,
  getEnabledOptions,
  isBuiltInCategoryCode,
  normalizeNoteCategoryConfigs
} from '../../shared/note-categories'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  initialTab?: 'text-ai' | 'asr' | 'note-style' | 'category-schema' | 'watchlist'
}

interface WatchlistStock {
  code: string
  name: string
  inDatabase: boolean
}

const DEFAULT_SETTINGS: UserSettings = {
  textAnalysis: {
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.7-highspeed',
    apiKey: ''
  },
  cloudASR: {
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'speech-01',
    apiKey: '',
    language: 'zh-CN'
  },
  notes: {
    defaultCategory: '看盘预测',
    defaultDirection: '未知',
    defaultTimeHorizon: '短线',
    style: '轻量',
    categoryConfigs: DEFAULT_NOTE_CATEGORY_CONFIGS
  }
}

const isMissingHandlerError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes('No handler registered')

const serializeCustomCategoryConfigs = (configs: NoteCategoryConfig[]) =>
  JSON.stringify(
    normalizeNoteCategoryConfigs(configs).filter((item) => !isBuiltInCategoryCode(item.code)),
    null,
    2
  )

const createCustomTemplate = (existingCodes: Set<string>): NoteCategoryConfig => {
  let suffix = 1
  let code = `自定义类别${suffix}`
  while (existingCodes.has(code)) {
    suffix += 1
    code = `自定义类别${suffix}`
  }
  return {
    code,
    label: code,
    enabled: true,
    reviewEligible: false,
    builtIn: false,
    fields: {
      viewpoint: { enabled: false, options: [{ code: '未知', label: '未知', enabled: true, order: 1 }] },
      operationTag: { enabled: false, options: [{ code: '无', label: '无', enabled: true, order: 1 }] },
      timeHorizon: { enabled: false, options: [{ code: '短线', label: '短线', enabled: true, order: 1 }] }
    }
  }
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose, initialTab = 'text-ai' }) => {
  const [form] = Form.useForm<UserSettings>()
  const watchedDefaultCategory = Form.useWatch(['notes', 'defaultCategory'], form)
  const [loading, setLoading] = useState(false)
  const [watchlistInput, setWatchlistInput] = useState('')
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([])
  const [activeTab, setActiveTab] = useState<'text-ai' | 'asr' | 'note-style' | 'category-schema' | 'watchlist'>(initialTab)
  const [categoryConfigs, setCategoryConfigs] = useState<NoteCategoryConfig[]>(DEFAULT_NOTE_CATEGORY_CONFIGS)
  const [customCategoryDraft, setCustomCategoryDraft] = useState('[]')
  const [customCategoryDraftError, setCustomCategoryDraftError] = useState<string | null>(null)

  const normalizedCategoryConfigs = useMemo(
    () => normalizeNoteCategoryConfigs(categoryConfigs),
    [categoryConfigs]
  )
  const builtInCategoryConfigs = useMemo(
    () => normalizedCategoryConfigs.filter((item) => isBuiltInCategoryCode(item.code)),
    [normalizedCategoryConfigs]
  )
  const customCategoryConfigs = useMemo(
    () => normalizedCategoryConfigs.filter((item) => !isBuiltInCategoryCode(item.code)),
    [normalizedCategoryConfigs]
  )

  const watchlistHint = useMemo(() => {
    if (watchlist.length === 0) return '当前没有自选股，ASR 将按全库匹配。'
    const unknownCount = watchlist.filter((item) => !item.inDatabase).length
    if (unknownCount > 0) {
      return `已导入 ${watchlist.length} 个代码，其中 ${unknownCount} 个不在本地股票库。`
    }
    return `已导入 ${watchlist.length} 个代码，ASR 会优先匹配这些股票。`
  }, [watchlist])

  const categoryOptions = useMemo(
    () => normalizedCategoryConfigs
      .filter((item) => item.enabled !== false)
      .map((item) => ({ label: item.label, value: item.code })),
    [normalizedCategoryConfigs]
  )
  const defaultCategoryConfig = useMemo(
    () => normalizedCategoryConfigs.find((item) => item.code === watchedDefaultCategory) || normalizedCategoryConfigs[0],
    [normalizedCategoryConfigs, watchedDefaultCategory]
  )
  const defaultDirectionOptions = useMemo(
    () => getEnabledOptions(defaultCategoryConfig?.fields.viewpoint.options || []).map((item) => ({ label: item.label, value: item.code })),
    [defaultCategoryConfig]
  )
  const defaultHorizonOptions = useMemo(
    () => getEnabledOptions(defaultCategoryConfig?.fields.timeHorizon.options || []).map((item) => ({ label: item.label, value: item.code })),
    [defaultCategoryConfig]
  )

  const parseCustomCategoryDraft = (draft: string): NoteCategoryConfig[] => {
    const text = draft.trim()
    if (!text) return []
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      throw new Error('JSON 必须是数组，例如: [{...}]')
    }
    const reserved = parsed.some((item: any) => isBuiltInCategoryCode(String(item?.code || '').trim()))
    if (reserved) {
      throw new Error('JSON 中不能包含内置类别 code（看盘预测、操盘打标）')
    }
    return normalizeNoteCategoryConfigs(parsed as NoteCategoryConfig[]).filter((item) => !isBuiltInCategoryCode(item.code))
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [settings, watchlistStocks] = await Promise.all([
        window.api.config.getAll(),
        window.api.watchlist.get()
      ])
      const normalizedCategories = normalizeNoteCategoryConfigs(settings?.notes?.categoryConfigs)
      const nextSettings: UserSettings = {
        ...settings,
        notes: {
          ...settings.notes,
          categoryConfigs: normalizedCategories
        }
      }
      form.setFieldsValue(nextSettings)
      setCategoryConfigs(normalizedCategories)
      setCustomCategoryDraft(serializeCustomCategoryConfigs(normalizedCategories))
      setCustomCategoryDraftError(null)
      setWatchlist(watchlistStocks || [])
    } catch (error: any) {
      if (isMissingHandlerError(error)) {
        const fallbackCategories = normalizeNoteCategoryConfigs(DEFAULT_SETTINGS.notes.categoryConfigs)
        form.setFieldsValue({
          ...DEFAULT_SETTINGS,
          notes: {
            ...DEFAULT_SETTINGS.notes,
            categoryConfigs: fallbackCategories
          }
        })
        setCategoryConfigs(fallbackCategories)
        setCustomCategoryDraft(serializeCustomCategoryConfigs(fallbackCategories))
        setCustomCategoryDraftError(null)
        setWatchlist([])
        message.warning('主进程配置模块未就绪，已使用默认设置。请重启应用后重试。')
        return
      }
      message.error(`加载设置失败: ${error?.message || String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    void loadData()
  }, [initialTab, open])

  useEffect(() => {
    const directionValues = new Set(defaultDirectionOptions.map((item) => item.value))
    const horizonValues = new Set(defaultHorizonOptions.map((item) => item.value))
    const currentDirection = form.getFieldValue(['notes', 'defaultDirection'])
    const currentHorizon = form.getFieldValue(['notes', 'defaultTimeHorizon'])
    if (defaultDirectionOptions.length > 0 && !directionValues.has(currentDirection)) {
      form.setFieldValue(['notes', 'defaultDirection'], defaultDirectionOptions[0].value)
    }
    if (defaultHorizonOptions.length > 0 && !horizonValues.has(currentHorizon)) {
      form.setFieldValue(['notes', 'defaultTimeHorizon'], defaultHorizonOptions[0].value)
    }
  }, [defaultDirectionOptions, defaultHorizonOptions, form, watchedDefaultCategory])

  const handleSave = async () => {
    try {
      let parsedCustomCategories: NoteCategoryConfig[] = []
      try {
        parsedCustomCategories = parseCustomCategoryDraft(customCategoryDraft)
        setCustomCategoryDraftError(null)
      } catch (error: any) {
        setActiveTab('category-schema')
        setCustomCategoryDraftError(error?.message || String(error))
        message.error(`类别 Schema 校验失败: ${error?.message || String(error)}`)
        return
      }

      const values = await form.validateFields()
      const normalizedCategories = normalizeNoteCategoryConfigs(parsedCustomCategories)
      const enabledCodes = new Set(
        normalizedCategories.filter((item) => item.enabled !== false).map((item) => item.code)
      )
      const defaultCategory = enabledCodes.has(values.notes.defaultCategory)
        ? values.notes.defaultCategory
        : (normalizedCategories.find((item) => item.enabled !== false)?.code || '看盘预测')
      const fallbackCategory = normalizedCategories.find((item) => item.code === defaultCategory) || normalizedCategories[0]
      const fallbackDirection = getEnabledOptions(fallbackCategory?.fields.viewpoint.options || [])[0]?.code || '未知'
      const fallbackHorizon = getEnabledOptions(fallbackCategory?.fields.timeHorizon.options || [])[0]?.code || '短线'
      const nextSettings: UserSettings = {
        ...values,
        notes: {
          ...values.notes,
          defaultCategory,
          defaultDirection: values.notes.defaultDirection || fallbackDirection,
          defaultTimeHorizon: values.notes.defaultTimeHorizon || fallbackHorizon,
          categoryConfigs: normalizedCategories
        }
      }
      setLoading(true)
      await window.api.config.update(nextSettings)
      setCategoryConfigs(normalizedCategories)
      setCustomCategoryDraft(serializeCustomCategoryConfigs(normalizedCategories))
      setCustomCategoryDraftError(null)
      message.success('设置已保存')
      onClose()
    } catch (error: any) {
      if (error?.errorFields) {
        return
      }
      message.error(`保存失败: ${error?.message || String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleImportWatchlist = async (mode: 'append' | 'replace') => {
    if (!watchlistInput.trim()) {
      message.warning('请先粘贴股票代码')
      return
    }
    try {
      setLoading(true)
      const result = await window.api.watchlist.import(watchlistInput, mode)
      await loadData()
      message.success(`导入完成：新增 ${result.importedCodes.length}，总计 ${result.totalCodes}`)
      if (result.invalidTokens.length > 0) {
        message.warning(`有 ${result.invalidTokens.length} 个无效项已忽略`)
      }
      setWatchlistInput('')
    } catch (error: any) {
      message.error(`导入失败: ${error?.message || String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleClearWatchlist = async () => {
    try {
      setLoading(true)
      await window.api.watchlist.clear()
      await loadData()
      message.success('自选股已清空')
    } catch (error: any) {
      message.error(`清空失败: ${error?.message || String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleFormatDraft = () => {
    try {
      const parsed = parseCustomCategoryDraft(customCategoryDraft)
      const merged = normalizeNoteCategoryConfigs(parsed)
      setCategoryConfigs(merged)
      setCustomCategoryDraft(JSON.stringify(parsed, null, 2))
      setCustomCategoryDraftError(null)
      message.success('类别 Schema 校验通过，已格式化')
    } catch (error: any) {
      setCustomCategoryDraftError(error?.message || String(error))
      message.error(`格式化失败: ${error?.message || String(error)}`)
    }
  }

  const handleResetDraft = () => {
    setCustomCategoryDraft(serializeCustomCategoryConfigs(categoryConfigs))
    setCustomCategoryDraftError(null)
  }

  const handleAddTemplate = () => {
    const existingCodes = new Set(normalizedCategoryConfigs.map((item) => item.code))
    const nextCustomCategories = [...customCategoryConfigs, createCustomTemplate(existingCodes)]
    const merged = normalizeNoteCategoryConfigs(nextCustomCategories)
    setCategoryConfigs(merged)
    setCustomCategoryDraft(JSON.stringify(nextCustomCategories, null, 2))
    setCustomCategoryDraftError(null)
  }

  const renderBuiltinSummary = (category: NoteCategoryConfig) => {
    const viewpoint = category.fields.viewpoint.options.map((item) => item.label).join(' / ')
    const operationTag = category.fields.operationTag.options.map((item) => item.label).join(' / ')
    const timeHorizon = category.fields.timeHorizon.options.map((item) => item.label).join(' / ')
    return (
      <div key={category.code} className="border border-gray-200 rounded p-3 bg-gray-50">
        <div className="flex items-center gap-2 mb-2">
          <Tag color="blue">内置</Tag>
          <Typography.Text strong>{category.label}</Typography.Text>
          <Typography.Text type="secondary">({category.code})</Typography.Text>
        </div>
        <div className="text-xs text-gray-600 space-y-1">
          <div>观点字段: {category.fields.viewpoint.enabled ? `开启（${viewpoint}）` : '关闭'}</div>
          <div>操作字段: {category.fields.operationTag.enabled ? `开启（${operationTag}）` : '关闭'}</div>
          <div>周期字段: {category.fields.timeHorizon.enabled ? `开启（${timeHorizon}）` : '关闭'}</div>
          <div>复盘参与: {category.reviewEligible ? '是' : '否'}</div>
        </div>
      </div>
    )
  }

  return (
    <Modal
      title="设置"
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={loading}
      width={860}
      okText="保存"
      cancelText="取消"
      maskClosable={false}
    >
      <Form form={form} layout="vertical">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'text-ai' | 'asr' | 'note-style' | 'category-schema' | 'watchlist')}
          items={[
            {
              key: 'text-ai',
              label: '文本分析 AI',
              children: (
                <>
                  <Form.Item label="API Base URL" name={['textAnalysis', 'baseUrl']} rules={[{ required: true, message: '请输入文本分析 API 地址' }]}>
                    <Input placeholder="https://api.minimaxi.com/v1" />
                  </Form.Item>
                  <Form.Item label="模型" name={['textAnalysis', 'model']} rules={[{ required: true, message: '请输入模型名称' }]}>
                    <Input placeholder="MiniMax-M2.7-highspeed" />
                  </Form.Item>
                  <Form.Item label="API Key" name={['textAnalysis', 'apiKey']}>
                    <Input.Password placeholder="可留空使用环境变量" />
                  </Form.Item>
                </>
              )
            },
            {
              key: 'asr',
              label: '云端 ASR',
              children: (
                <>
                  <Form.Item label="ASR API Base URL" name={['cloudASR', 'baseUrl']} rules={[{ required: true, message: '请输入云端 ASR 地址' }]}>
                    <Input placeholder="https://api.minimaxi.com/v1" />
                  </Form.Item>
                  <Form.Item label="ASR 模型" name={['cloudASR', 'model']} rules={[{ required: true, message: '请输入云端 ASR 模型' }]}>
                    <Input placeholder="speech-01" />
                  </Form.Item>
                  <Form.Item label="ASR API Key" name={['cloudASR', 'apiKey']}>
                    <Input.Password placeholder="可留空使用环境变量" />
                  </Form.Item>
                  <Form.Item label="语言" name={['cloudASR', 'language']}>
                    <Select
                      options={[
                        { label: '简体中文优先 (zh-CN)', value: 'zh-CN' },
                        { label: '中文 (zh)', value: 'zh' }
                      ]}
                    />
                  </Form.Item>
                </>
              )
            },
            {
              key: 'note-style',
              label: '笔记偏好',
              children: (
                <>
                  <Form.Item label="默认笔记类别" name={['notes', 'defaultCategory']}>
                    <Select options={categoryOptions} />
                  </Form.Item>
                  <Form.Item label="默认观点" name={['notes', 'defaultDirection']}>
                    <Select options={defaultDirectionOptions} />
                  </Form.Item>
                  <Form.Item label="默认周期" name={['notes', 'defaultTimeHorizon']}>
                    <Select options={defaultHorizonOptions} />
                  </Form.Item>
                  <Form.Item label="笔记风格" name={['notes', 'style']}>
                    <Select
                      options={[
                        { label: '轻量（推荐）', value: '轻量' },
                        { label: '结构化', value: '结构化' }
                      ]}
                    />
                  </Form.Item>
                </>
              )
            },
            {
              key: 'category-schema',
              label: '类别Schema',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    className="mb-3"
                    message="类别配置采用 JSON 草稿编辑。内置类别仅保留“看盘预测 / 操盘打标”，且锁定不可改。"
                  />
                  <div className="mb-2">
                    <Space wrap>
                      <Button icon={<PlusOutlined />} onClick={handleAddTemplate}>
                        新增自定义类别模板
                      </Button>
                      <Button onClick={handleFormatDraft}>校验并格式化 JSON</Button>
                      <Button onClick={handleResetDraft}>重置草稿</Button>
                    </Space>
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    仅编辑自定义类别数组（不要包含看盘预测、操盘打标）。
                  </div>
                  <Input.TextArea
                    value={customCategoryDraft}
                    onChange={(event) => {
                      setCustomCategoryDraft(event.target.value)
                      if (customCategoryDraftError) {
                        setCustomCategoryDraftError(null)
                      }
                    }}
                    autoSize={{ minRows: 10, maxRows: 18 }}
                    spellCheck={false}
                    placeholder={`[\n  {\n    "code": "交易札记",\n    "label": "交易札记",\n    "enabled": true,\n    "reviewEligible": false,\n    "fields": {\n      "viewpoint": { "enabled": false, "options": [{ "code": "未知", "label": "未知", "enabled": true, "order": 1 }] },\n      "operationTag": { "enabled": false, "options": [{ "code": "无", "label": "无", "enabled": true, "order": 1 }] },\n      "timeHorizon": { "enabled": false, "options": [{ "code": "短线", "label": "短线", "enabled": true, "order": 1 }] }\n    }\n  }\n]`}
                  />
                  {customCategoryDraftError ? (
                    <Alert
                      type="error"
                      showIcon
                      className="mt-2"
                      message={`JSON 校验失败：${customCategoryDraftError}`}
                    />
                  ) : (
                    <div className="mt-2 text-xs text-gray-500">
                      当前自定义类别数量：{customCategoryConfigs.length}
                    </div>
                  )}
                  <Divider className="my-3" />
                  <Typography.Text strong>内置类别（只读）</Typography.Text>
                  <div className="mt-2 space-y-2">
                    {builtInCategoryConfigs.map(renderBuiltinSummary)}
                  </div>
                </>
              )
            },
            {
              key: 'watchlist',
              label: '自选股导入',
              children: (
                <>
                  <Alert type="info" showIcon message={watchlistHint} className="mb-3" />
                  <Input.TextArea
                    value={watchlistInput}
                    onChange={(event) => setWatchlistInput(event.target.value)}
                    placeholder="粘贴股票代码，支持换行、逗号、空格分隔，例如：600519, 000001"
                    autoSize={{ minRows: 5, maxRows: 8 }}
                  />
                  <div className="mt-3 mb-3">
                    <Space>
                      <Button onClick={() => handleImportWatchlist('append')} loading={loading}>追加导入</Button>
                      <Button type="primary" onClick={() => handleImportWatchlist('replace')} loading={loading}>替换导入</Button>
                      <Button danger onClick={handleClearWatchlist} loading={loading}>清空</Button>
                    </Space>
                  </div>
                  <div className="max-h-40 overflow-auto border border-gray-200 rounded p-2">
                    {watchlist.length === 0 ? (
                      <div className="text-gray-400 text-sm">暂无自选股</div>
                    ) : (
                      <Space size={[8, 8]} wrap>
                        {watchlist.map((item) => (
                          <Tag key={item.code} color={item.inDatabase ? 'blue' : 'default'}>
                            {item.name} ({item.code})
                          </Tag>
                        ))}
                      </Space>
                    )}
                  </div>
                </>
              )
            }
          ]}
        />
      </Form>
    </Modal>
  )
}

export default SettingsModal
