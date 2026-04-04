import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Divider, Form, Input, InputNumber, Modal, Select, Space, Tabs, Tag, Typography, message } from 'antd'
import type { NoteCategoryConfig, UserSettings } from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, normalizeNoteCategoryConfigs } from '../../shared/note-categories'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  initialTab?: 'text-ai' | 'asr' | 'category-schema' | 'watchlist' | 'daily-review' | 'feishu'
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
  },
  dailyReview: {
    enabled: true,
    analysisLookbackDays: 3,
    analysisMaxItems: 120,
    reminder: {
      enabled: true,
      time: '09:00',
      weekdaysOnly: true,
      autoGeneratePreMarket: true,
      includeSections: {
        yesterdaySummary: true,
        pendingItems: true,
        keyLevels: true,
        watchlist: true,
        riskReminders: true
      }
    }
  },
  feishu: {
    enabled: true,
    appId: 'cli_a9496c7813a1dbc8',
    appSecret: '1CF9rURs8T1KD65oEvJzYbZktfeVzwLB',
    encryptKey: '',
    verificationToken: ''
  }
}

type SettingsTab = 'text-ai' | 'asr' | 'category-schema' | 'watchlist' | 'daily-review' | 'feishu'

const isMissingHandlerError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes('No handler registered')

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose, initialTab = 'text-ai' }) => {
  const [form] = Form.useForm<UserSettings>()
  const [loading, setLoading] = useState(false)
  const [watchlistInput, setWatchlistInput] = useState('')
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([])
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [categoryConfigs, setCategoryConfigs] = useState<NoteCategoryConfig[]>(DEFAULT_NOTE_CATEGORY_CONFIGS)

  const watchlistHint = useMemo(() => {
    if (watchlist.length === 0) return '当前没有自选股，ASR 将按全库匹配。'
    const unknownCount = watchlist.filter((item) => !item.inDatabase).length
    if (unknownCount > 0) {
      return `已导入 ${watchlist.length} 个代码，其中 ${unknownCount} 个不在本地股票库。`
    }
    return `已导入 ${watchlist.length} 个代码，ASR 会优先匹配这些股票。`
  }, [watchlist])

  const mergeSettingsWithDefaults = (raw: UserSettings): UserSettings => {
    const normalizedCategories = normalizeNoteCategoryConfigs(raw?.notes?.categoryConfigs)
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      notes: {
        ...DEFAULT_SETTINGS.notes,
        ...raw?.notes,
        categoryConfigs: normalizedCategories
      },
      dailyReview: {
        ...DEFAULT_SETTINGS.dailyReview,
        ...raw?.dailyReview,
        reminder: {
          ...DEFAULT_SETTINGS.dailyReview.reminder,
          ...raw?.dailyReview?.reminder,
          includeSections: {
            ...DEFAULT_SETTINGS.dailyReview.reminder.includeSections,
            ...raw?.dailyReview?.reminder?.includeSections
          }
        }
      },
      feishu: {
        ...DEFAULT_SETTINGS.feishu,
        ...raw?.feishu
      }
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [settings, watchlistStocks] = await Promise.all([
        window.api.config.getAll(),
        window.api.watchlist.get()
      ])
      const nextSettings = mergeSettingsWithDefaults(settings as UserSettings)
      form.setFieldsValue(nextSettings)
      setCategoryConfigs(nextSettings.notes.categoryConfigs)
      setWatchlist(watchlistStocks || [])
    } catch (error: any) {
      if (isMissingHandlerError(error)) {
        const fallbackSettings = mergeSettingsWithDefaults(DEFAULT_SETTINGS)
        form.setFieldsValue(fallbackSettings)
        setCategoryConfigs(fallbackSettings.notes.categoryConfigs)
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

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const normalizedCategories = normalizeNoteCategoryConfigs(categoryConfigs)
      const nextSettings: UserSettings = {
        ...DEFAULT_SETTINGS,
        ...values,
        notes: {
          ...DEFAULT_SETTINGS.notes,
          ...values.notes,
          defaultCategory: '看盘预测',
          defaultDirection: '未知',
          defaultTimeHorizon: '短线',
          style: '轻量',
          categoryConfigs: normalizedCategories
        },
        dailyReview: {
          ...DEFAULT_SETTINGS.dailyReview,
          ...values.dailyReview,
          reminder: {
            ...DEFAULT_SETTINGS.dailyReview.reminder,
            ...values.dailyReview?.reminder,
            includeSections: {
              ...DEFAULT_SETTINGS.dailyReview.reminder.includeSections,
              ...values.dailyReview?.reminder?.includeSections
            }
          }
        },
        feishu: {
          ...DEFAULT_SETTINGS.feishu,
          ...values.feishu
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
          onChange={(key) => setActiveTab(key as SettingsTab)}
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
              key: 'category-schema',
              label: '类别Schema',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    className="mb-3"
                    message="当前版本简化为固定双类别：看盘预测 + 普通笔记。操盘动作请用“操作打标（买入/卖出）”记录。"
                  />
                  <div className="max-h-[320px] overflow-auto pr-1">
                    <Space direction="vertical" size="middle" className="w-full">
                      {categoryConfigs.map((category, index) => (
                        <div key={`${category.code}-${index}`} className="border border-gray-200 rounded p-3 bg-gray-50">
                          <div className="flex items-center gap-2 mb-2">
                            <Tag color={category.reviewEligible ? 'magenta' : 'default'}>
                              {category.reviewEligible ? '复盘类别' : '普通类别'}
                            </Tag>
                            <Typography.Text strong>{category.label}</Typography.Text>
                            <Typography.Text type="secondary">({category.code})</Typography.Text>
                          </div>
                          <div className="text-xs text-gray-500">
                            观点字段: {category.fields.viewpoint.enabled ? '开启' : '关闭'} | 操作打标: {category.fields.operationTag.enabled ? '开启' : '关闭'} | 周期字段: {category.fields.timeHorizon.enabled ? '开启' : '关闭'}
                          </div>
                        </div>
                      ))}
                    </Space>
                  </div>
                  <Divider className="my-3" />
                  <Typography.Text type="secondary">
                    如需进一步扩展类别体系，我们后续可以在不影响主流程的前提下再分阶段开放。
                  </Typography.Text>
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
            },
            {
              key: 'daily-review',
              label: '每日复盘',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    className="mb-3"
                    message="用于控制每日复盘分析范围、次日提醒时间与提醒卡片展示内容。"
                  />
                  <Form.Item
                    label="启用每日复盘功能"
                    name={['dailyReview', 'enabled']}
                    valuePropName="checked"
                  >
                    <Checkbox>启用</Checkbox>
                  </Form.Item>

                  <Space className="w-full" size="large" align="start">
                    <Form.Item
                      label="分析窗口（天）"
                      name={['dailyReview', 'analysisLookbackDays']}
                      tooltip="默认 3，表示只分析最近 T-3 的笔记"
                    >
                      <InputNumber min={1} max={7} precision={0} />
                    </Form.Item>
                    <Form.Item
                      label="分析最多条数"
                      name={['dailyReview', 'analysisMaxItems']}
                      tooltip="限制送入 AI 的最大笔记条数，避免 prompt 过大"
                    >
                      <InputNumber min={20} max={300} step={10} precision={0} />
                    </Form.Item>
                  </Space>

                  <Divider className="my-3" />
                  <Typography.Text strong>次日提醒</Typography.Text>
                  <div className="mt-2">
                    <Form.Item
                      label="启用次日提醒"
                      name={['dailyReview', 'reminder', 'enabled']}
                      valuePropName="checked"
                    >
                      <Checkbox>启用</Checkbox>
                    </Form.Item>
                    <Space className="w-full" size="large" align="start">
                      <Form.Item
                        label="提醒时间"
                        name={['dailyReview', 'reminder', 'time']}
                        rules={[{ pattern: /^([01]?\d|2[0-3]):([0-5]\d)$/, message: '请输入 HH:mm，例如 09:00' }]}
                      >
                        <Input placeholder="09:00" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item
                        label="仅工作日提醒"
                        name={['dailyReview', 'reminder', 'weekdaysOnly']}
                        valuePropName="checked"
                      >
                        <Checkbox>仅工作日</Checkbox>
                      </Form.Item>
                      <Form.Item
                        label="无盘前卡片时自动生成"
                        name={['dailyReview', 'reminder', 'autoGeneratePreMarket']}
                        valuePropName="checked"
                      >
                        <Checkbox>自动生成</Checkbox>
                      </Form.Item>
                    </Space>
                  </div>

                  <Divider className="my-3" />
                  <Typography.Text strong>提醒卡片内容（可勾选）</Typography.Text>
                  <div className="mt-2 grid grid-cols-2 gap-y-2">
                    <Form.Item name={['dailyReview', 'reminder', 'includeSections', 'yesterdaySummary']} valuePropName="checked" className="mb-0">
                      <Checkbox>昨日概要</Checkbox>
                    </Form.Item>
                    <Form.Item name={['dailyReview', 'reminder', 'includeSections', 'pendingItems']} valuePropName="checked" className="mb-0">
                      <Checkbox>待跟进事项</Checkbox>
                    </Form.Item>
                    <Form.Item name={['dailyReview', 'reminder', 'includeSections', 'keyLevels']} valuePropName="checked" className="mb-0">
                      <Checkbox>关键位</Checkbox>
                    </Form.Item>
                    <Form.Item name={['dailyReview', 'reminder', 'includeSections', 'watchlist']} valuePropName="checked" className="mb-0">
                      <Checkbox>观察列表</Checkbox>
                    </Form.Item>
                    <Form.Item name={['dailyReview', 'reminder', 'includeSections', 'riskReminders']} valuePropName="checked" className="mb-0">
                      <Checkbox>风险提醒</Checkbox>
                    </Form.Item>
                  </div>
                </>
              )
            },
            {
              key: 'feishu',
              label: '飞书机器人',
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    className="mb-3"
                    message={
                      <span>
                        配置飞书机器人后，可通过飞书对话远程录入笔记。
                        <a href="https://open.feishu.cn/document/home/introduction-to-feishu-open-platform/" target="_blank" rel="noopener noreferrer"> 查看配置教程</a>
                      </span>
                    }
                  />
                  <Form.Item label="App ID" name={['feishu', 'appId']}>
                    <Input placeholder="cli_xxxxxxxxxx" />
                  </Form.Item>
                  <Form.Item label="App Secret" name={['feishu', 'appSecret']}>
                    <Input.Password placeholder="应用密钥" />
                  </Form.Item>
                  <Divider />
                  <Typography.Text type="secondary">
                    配置步骤：<br />
                    1. 在飞书开放平台创建企业自建应用<br />
                    2. 获取 App ID 和 Secret<br />
                    3. 配置事件订阅（WebSocket 模式），添加 im.message.receive_v1 事件<br />
                    4. 发布应用版本
                  </Typography.Text>
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
