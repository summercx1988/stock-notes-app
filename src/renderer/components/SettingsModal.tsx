import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Tabs, Tag, message } from 'antd'
import type { UserSettings } from '../../shared/types'

const NOTE_CATEGORY_OPTIONS = [
  { label: '看盘预测', value: '看盘预测' },
  { label: '交易札记', value: '交易札记' },
  { label: '备忘', value: '备忘' },
  { label: '资讯备忘', value: '资讯备忘' }
]

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  initialTab?: 'text-ai' | 'asr' | 'note-style' | 'watchlist'
}

interface WatchlistStock {
  code: string
  name: string
  inDatabase: boolean
}

const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose, initialTab = 'text-ai' }) => {
  const [form] = Form.useForm<UserSettings>()
  const [loading, setLoading] = useState(false)
  const [watchlistInput, setWatchlistInput] = useState('')
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([])
  const [activeTab, setActiveTab] = useState<'text-ai' | 'asr' | 'note-style' | 'watchlist'>(initialTab)

  const watchlistHint = useMemo(() => {
    if (watchlist.length === 0) return '当前没有自选股，ASR 将按全库匹配。'
    const unknownCount = watchlist.filter((item) => !item.inDatabase).length
    if (unknownCount > 0) {
      return `已导入 ${watchlist.length} 个代码，其中 ${unknownCount} 个不在本地股票库。`
    }
    return `已导入 ${watchlist.length} 个代码，ASR 会优先匹配这些股票。`
  }, [watchlist])

  const loadData = async () => {
    setLoading(true)
    try {
      const [settings, watchlistStocks] = await Promise.all([
        window.api.config.getAll(),
        window.api.watchlist.get()
      ])
      form.setFieldsValue(settings)
      setWatchlist(watchlistStocks || [])
    } catch (error: any) {
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
      setLoading(true)
      await window.api.config.update(values)
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
          onChange={(key) => setActiveTab(key as 'text-ai' | 'asr' | 'note-style' | 'watchlist')}
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
                    <Select options={NOTE_CATEGORY_OPTIONS} />
                  </Form.Item>
                  <Form.Item label="默认观点" name={['notes', 'defaultDirection']}>
                    <Select
                      options={[
                        { label: '未知', value: '未知' },
                        { label: '看多', value: '看多' },
                        { label: '看空', value: '看空' },
                        { label: '中性', value: '中性' }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="默认周期" name={['notes', 'defaultTimeHorizon']}>
                    <Select
                      options={[
                        { label: '短线', value: '短线' },
                        { label: '中线', value: '中线' },
                        { label: '长线', value: '长线' }
                      ]}
                    />
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
