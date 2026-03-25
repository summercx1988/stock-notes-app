import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Divider, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, Typography, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { NoteCategoryConfig, UserSettings } from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, getEnabledOptions, normalizeNoteCategoryConfigs } from '../../shared/note-categories'

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

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose, initialTab = 'text-ai' }) => {
  const [form] = Form.useForm<UserSettings>()
  const watchedDefaultCategory = Form.useWatch(['notes', 'defaultCategory'], form)
  const [loading, setLoading] = useState(false)
  const [watchlistInput, setWatchlistInput] = useState('')
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([])
  const [activeTab, setActiveTab] = useState<'text-ai' | 'asr' | 'note-style' | 'category-schema' | 'watchlist'>(initialTab)
  const [categoryConfigs, setCategoryConfigs] = useState<NoteCategoryConfig[]>(DEFAULT_NOTE_CATEGORY_CONFIGS)

  const watchlistHint = useMemo(() => {
    if (watchlist.length === 0) return '当前没有自选股，ASR 将按全库匹配。'
    const unknownCount = watchlist.filter((item) => !item.inDatabase).length
    if (unknownCount > 0) {
      return `已导入 ${watchlist.length} 个代码，其中 ${unknownCount} 个不在本地股票库。`
    }
    return `已导入 ${watchlist.length} 个代码，ASR 会优先匹配这些股票。`
  }, [watchlist])

  const categoryOptions = useMemo(
    () => categoryConfigs
      .filter((item) => item.enabled !== false)
      .map((item) => ({ label: item.label, value: item.code })),
    [categoryConfigs]
  )
  const defaultCategoryConfig = useMemo(
    () => normalizeNoteCategoryConfigs(categoryConfigs).find((item) => item.code === watchedDefaultCategory) || categoryConfigs[0],
    [categoryConfigs, watchedDefaultCategory]
  )
  const defaultDirectionOptions = useMemo(
    () => getEnabledOptions(defaultCategoryConfig?.fields.viewpoint.options || []).map((item) => ({ label: item.label, value: item.code })),
    [defaultCategoryConfig]
  )
  const defaultHorizonOptions = useMemo(
    () => getEnabledOptions(defaultCategoryConfig?.fields.timeHorizon.options || []).map((item) => ({ label: item.label, value: item.code })),
    [defaultCategoryConfig]
  )

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
      const values = await form.validateFields()
      const normalizedCategories = normalizeNoteCategoryConfigs(categoryConfigs)
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

  const updateCategoryConfig = (index: number, updater: (current: NoteCategoryConfig) => NoteCategoryConfig) => {
    setCategoryConfigs((prev) => prev.map((item, currentIndex) => (currentIndex === index ? updater(item) : item)))
  }

  const parseOptionsInput = (input: string) => {
    return input
      .split(/[\n,，]/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((token, index) => {
        const separator = token.includes('|') ? '|' : (token.includes(':') ? ':' : null)
        const [rawCode, rawLabel] = separator ? token.split(separator) : [token, token]
        const code = String(rawCode || '').trim()
        const label = String(rawLabel || rawCode || '').trim()
        return {
          code,
          label: label || code,
          enabled: true,
          order: index + 1
        }
      })
      .filter((item) => item.code.length > 0)
  }

  const optionsToInput = (category: NoteCategoryConfig, field: 'viewpoint' | 'operationTag' | 'timeHorizon') =>
    getEnabledOptions(category.fields[field].options)
      .map((item) => (item.label && item.label !== item.code ? `${item.code}:${item.label}` : item.code))
      .join(', ')

  const optionsHintText = '支持“代码”或“代码:显示名”，如：bullish:看多, bearish:看空'

  const handleAddCategory = () => {
    const existingCodes = new Set(categoryConfigs.map((item) => item.code))
    let suffix = 1
    let code = `自定义类别${suffix}`
    while (existingCodes.has(code)) {
      suffix += 1
      code = `自定义类别${suffix}`
    }
    setCategoryConfigs((prev) => [
      ...prev,
      {
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
    ])
  }

  const handleRemoveCategory = (index: number) => {
    setCategoryConfigs((prev) => {
      const target = prev[index]
      if (target?.builtIn) return prev
      return prev.filter((_, currentIndex) => currentIndex !== index)
    })
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
                    message="各类别独立维护字段与枚举。复盘只解析 reviewEligible=true 的类别（默认仅看盘预测）。"
                  />
                  <div className="mb-3">
                    <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddCategory}>
                      新增类别
                    </Button>
                  </div>
                  <div className="max-h-[420px] overflow-auto pr-1">
                    <Space direction="vertical" size="middle" className="w-full">
                      {categoryConfigs.map((category, index) => (
                        <div key={`${category.code}-${index}`} className="border border-gray-200 rounded p-3">
                          <div className="flex items-center justify-between mb-2">
                            <Space>
                              <Tag color={category.builtIn ? 'blue' : 'default'}>{category.builtIn ? '内置' : '自定义'}</Tag>
                              <Tag color={category.reviewEligible ? 'magenta' : 'default'}>
                                {category.reviewEligible ? '参与复盘' : '不参与复盘'}
                              </Tag>
                            </Space>
                            <Button
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => handleRemoveCategory(index)}
                              disabled={category.builtIn}
                            >
                              删除
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Typography.Text type="secondary">类别代码（存储值）</Typography.Text>
                              <Input
                                value={category.code}
                                disabled={category.builtIn}
                                onChange={(event) => {
                                  const nextCode = event.target.value.trim()
                                  updateCategoryConfig(index, (current) => ({
                                    ...current,
                                    code: nextCode || current.code
                                  }))
                                }}
                              />
                            </div>
                            <div>
                              <Typography.Text type="secondary">类别名称（展示值）</Typography.Text>
                              <Input
                                value={category.label}
                                onChange={(event) => {
                                  const nextLabel = event.target.value.trim()
                                  updateCategoryConfig(index, (current) => ({
                                    ...current,
                                    label: nextLabel || current.label
                                  }))
                                }}
                              />
                            </div>
                          </div>

                          <div className="mt-3 flex items-center gap-6">
                            <div className="flex items-center gap-2">
                              <Typography.Text type="secondary">启用</Typography.Text>
                              <Switch
                                checked={category.enabled !== false}
                                onChange={(checked) => updateCategoryConfig(index, (current) => ({ ...current, enabled: checked }))}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Typography.Text type="secondary">参与复盘</Typography.Text>
                              <Switch
                                checked={category.reviewEligible}
                                onChange={(checked) => updateCategoryConfig(index, (current) => ({ ...current, reviewEligible: checked }))}
                              />
                            </div>
                          </div>

                          <Divider className="my-3" />

                          <div className="grid grid-cols-1 gap-3">
                            <div>
                              <div className="mb-1 flex items-center gap-2">
                                <Typography.Text type="secondary">观点枚举（逗号分隔）</Typography.Text>
                                <Switch
                                  checked={category.fields.viewpoint.enabled}
                                  size="small"
                                  onChange={(checked) => updateCategoryConfig(index, (current) => ({
                                    ...current,
                                    fields: {
                                      ...current.fields,
                                      viewpoint: {
                                        ...current.fields.viewpoint,
                                        enabled: checked
                                      }
                                    }
                                  }))}
                                />
                              </div>
                              <Input.TextArea
                                value={optionsToInput(category, 'viewpoint')}
                                autoSize={{ minRows: 1, maxRows: 3 }}
                                onChange={(event) => updateCategoryConfig(index, (current) => ({
                                  ...current,
                                  fields: {
                                    ...current.fields,
                                    viewpoint: {
                                      ...current.fields.viewpoint,
                                      options: parseOptionsInput(event.target.value)
                                    }
                                  }
                                }))}
                              />
                              <div className="mt-1 text-xs text-gray-400">{optionsHintText}</div>
                            </div>
                            <div>
                              <div className="mb-1 flex items-center gap-2">
                                <Typography.Text type="secondary">操作枚举（逗号分隔）</Typography.Text>
                                <Switch
                                  checked={category.fields.operationTag.enabled}
                                  size="small"
                                  onChange={(checked) => updateCategoryConfig(index, (current) => ({
                                    ...current,
                                    fields: {
                                      ...current.fields,
                                      operationTag: {
                                        ...current.fields.operationTag,
                                        enabled: checked
                                      }
                                    }
                                  }))}
                                />
                              </div>
                              <Input.TextArea
                                value={optionsToInput(category, 'operationTag')}
                                autoSize={{ minRows: 1, maxRows: 3 }}
                                onChange={(event) => updateCategoryConfig(index, (current) => ({
                                  ...current,
                                  fields: {
                                    ...current.fields,
                                    operationTag: {
                                      ...current.fields.operationTag,
                                      options: parseOptionsInput(event.target.value)
                                    }
                                  }
                                }))}
                              />
                            </div>
                            <div>
                              <div className="mb-1 flex items-center gap-2">
                                <Typography.Text type="secondary">周期枚举（逗号分隔）</Typography.Text>
                                <Switch
                                  checked={category.fields.timeHorizon.enabled}
                                  size="small"
                                  onChange={(checked) => updateCategoryConfig(index, (current) => ({
                                    ...current,
                                    fields: {
                                      ...current.fields,
                                      timeHorizon: {
                                        ...current.fields.timeHorizon,
                                        enabled: checked
                                      }
                                    }
                                  }))}
                                />
                              </div>
                              <Input.TextArea
                                value={optionsToInput(category, 'timeHorizon')}
                                autoSize={{ minRows: 1, maxRows: 3 }}
                                onChange={(event) => updateCategoryConfig(index, (current) => ({
                                  ...current,
                                  fields: {
                                    ...current.fields,
                                    timeHorizon: {
                                      ...current.fields.timeHorizon,
                                      options: parseOptionsInput(event.target.value)
                                    }
                                  }
                                }))}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </Space>
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
