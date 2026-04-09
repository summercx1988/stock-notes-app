import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, message, Modal, Steps, Divider, Card, Tag, DatePicker, Select, Input, AutoComplete } from 'antd'
import { SaveOutlined, LoadingOutlined, CheckCircleOutlined, EditOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { NoteCategory, NoteCategoryConfig, OperationTag, UserSettings, Viewpoint } from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, getCategoryConfig, getEnabledOptions, normalizeNoteCategoryConfigs } from '../../shared/note-categories'
import { cleanTranscriptText, normalizeNoteContent } from '../../shared/text-normalizer'
import { createDefaultUserSettings } from '../../shared/default-user-settings'

const { Step } = Steps
const { TextArea } = Input

interface AIExtractResult {
  stock?: {
    code: string
    name: string
    confidence: number
  }
  note: {
    keyPoints: string[]
    sentiment?: '看多' | '看空' | '震荡' | '未知' | string
    timeHorizon?: string
    operationTag?: OperationTag | string
  }
  timestamp: {
    type: 'absolute' | 'relative' | 'none'
    value?: string
    originalText?: string
  }
  optimizedText: string
  originalText: string
}

type ProcessingState = 'idle' | 'analyzing' | 'completed'
type StockSelectOption = { label: string; value: string; name: string }

const DEFAULT_SETTINGS: UserSettings = createDefaultUserSettings()

const isMissingHandlerError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes('No handler registered')

const RecordingControl: React.FC = () => {
  const { setStockNote, setLoading, setCurrentStock } = useAppStore()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [processingState, setProcessingState] = useState<ProcessingState>('idle')
  const [manualInputText, setManualInputText] = useState<string>('')
  const [extractResult, setExtractResult] = useState<AIExtractResult | null>(null)
  const [editableNoteContent, setEditableNoteContent] = useState<string>('')
  const [selectedStockCode, setSelectedStockCode] = useState<string>('')
  const [selectedStockName, setSelectedStockName] = useState<string>('')
  const [stockSearchKeyword, setStockSearchKeyword] = useState<string>('')
  const [stockSearchOptions, setStockSearchOptions] = useState<StockSelectOption[]>([])
  const [stockSearching, setStockSearching] = useState(false)
  const [noteEventTime, setNoteEventTime] = useState<Dayjs | null>(dayjs())
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('看盘预测')
  const [noteDirection, setNoteDirection] = useState<Viewpoint['direction']>('未知')
  const [noteOperationTag, setNoteOperationTag] = useState<OperationTag>('无')
  const [settings, setSettings] = useState<UserSettings | null>(null)

  const categoryConfigs: NoteCategoryConfig[] = normalizeNoteCategoryConfigs(
    settings?.notes?.categoryConfigs || DEFAULT_NOTE_CATEGORY_CONFIGS
  )
  const activeCategoryConfig = getCategoryConfig(categoryConfigs, noteCategory)
  const noteCategoryOptions = categoryConfigs
    .filter((item) => item.enabled !== false)
    .map((item) => ({ label: item.label, value: item.code }))
  const noteDirectionOptions = getEnabledOptions(activeCategoryConfig?.fields.viewpoint.options || [])
    .map((item) => ({ label: item.label, value: item.code }))
  const noteOperationOptions = getEnabledOptions(activeCategoryConfig?.fields.operationTag.options || [])
    .map((item) => ({ label: item.label, value: item.code }))

  const stockSearchTimerRef = useRef<NodeJS.Timeout | null>(null)

  const mapAISentimentToDirection = (sentiment?: string): Viewpoint['direction'] => {
    if (!sentiment) return '未知'
    if (sentiment.includes('看多') || sentiment === 'bullish') return '看多'
    if (sentiment.includes('看空') || sentiment === 'bearish') return '看空'
    if (sentiment.includes('震荡') || sentiment.includes('中性')) return '震荡'
    return '未知'
  }

  const normalizeDirectionAlias = (direction?: string): Viewpoint['direction'] => {
    if (direction === '中性') return '震荡'
    if (direction === '看多' || direction === '看空' || direction === '震荡' || direction === '未知') {
      return direction
    }
    return '未知'
  }

  const mapAIActionToOperationTag = (operationTag?: string): OperationTag => {
    if (!operationTag) return '无'
    if (operationTag.includes('买')) return '买入'
    if (operationTag.includes('卖')) return '卖出'
    return '无'
  }

  const loadUserPreferences = useCallback(async () => {
    try {
      const config = await window.api.config.getAll()
      const normalizedConfig: UserSettings = {
        ...config,
        notes: {
          ...config.notes,
          categoryConfigs: normalizeNoteCategoryConfigs(config?.notes?.categoryConfigs)
        }
      }
      setSettings(normalizedConfig)
      const enabledCategoryCodes = normalizedConfig.notes.categoryConfigs
        .filter((item) => item.enabled !== false)
        .map((item) => item.code)
      const preferredCategory = enabledCategoryCodes.includes(normalizedConfig.notes.defaultCategory)
        ? normalizedConfig.notes.defaultCategory
        : (enabledCategoryCodes[0] || '看盘预测')
      setNoteCategory(preferredCategory)
      setNoteDirection(normalizeDirectionAlias(normalizedConfig.notes.defaultDirection))
    } catch (error) {
      if (isMissingHandlerError(error)) {
        const fallback = {
          ...DEFAULT_SETTINGS,
          notes: {
            ...DEFAULT_SETTINGS.notes,
            categoryConfigs: normalizeNoteCategoryConfigs(DEFAULT_SETTINGS.notes.categoryConfigs)
          }
        }
        setSettings(fallback)
        setNoteCategory(fallback.notes.defaultCategory)
        setNoteDirection(normalizeDirectionAlias(DEFAULT_SETTINGS.notes.defaultDirection))
        console.warn('[RecordingControl] Missing config IPC handlers, fallback to defaults.')
        return
      }
      console.error('[RecordingControl] Failed to load user preferences:', error)
    }
  }, [])

  const resetState = useCallback(() => {
    setCurrentStep(0)
    setProcessingState('idle')
    setManualInputText('')
    setExtractResult(null)
    setEditableNoteContent('')
    setSelectedStockCode('')
    setSelectedStockName('')
    setStockSearchKeyword('')
    setStockSearchOptions([])
    setStockSearching(false)
    setNoteEventTime(dayjs())
    const normalizedCategories = normalizeNoteCategoryConfigs(settings?.notes?.categoryConfigs || DEFAULT_NOTE_CATEGORY_CONFIGS)
    const enabledCodes = normalizedCategories.filter((item) => item.enabled !== false).map((item) => item.code)
    const preferredCategory = settings?.notes.defaultCategory && enabledCodes.includes(settings.notes.defaultCategory)
      ? settings.notes.defaultCategory
      : (enabledCodes[0] || '看盘预测')
    setNoteCategory(preferredCategory)
    setNoteDirection(normalizeDirectionAlias(settings?.notes.defaultDirection))
    setNoteOperationTag('无')

    if (stockSearchTimerRef.current) {
      clearTimeout(stockSearchTimerRef.current)
      stockSearchTimerRef.current = null
    }
  }, [settings])

  useEffect(() => {
    void loadUserPreferences()
  }, [loadUserPreferences])

  useEffect(() => {
    const directionCodes = noteDirectionOptions.map((item) => item.value)
    if (directionCodes.length > 0 && !directionCodes.includes(noteDirection)) {
      setNoteDirection(directionCodes[0] as Viewpoint['direction'])
    }
    const operationCodes = noteOperationOptions.map((item) => item.value)
    if (operationCodes.length > 0 && !operationCodes.includes(noteOperationTag)) {
      setNoteOperationTag(operationCodes[0])
    }
  }, [noteCategory, noteDirectionOptions, noteOperationOptions, noteDirection, noteOperationTag])

  const searchStockOptions = useCallback(async (keyword: string, limit = 12) => {
    const q = keyword.trim()
    if (!q) {
      setStockSearchOptions([])
      setStockSearching(false)
      return []
    }

    setStockSearching(true)
    try {
      const results = await window.api.stock.search(q, limit)
      const options: StockSelectOption[] = results.map((result: any) => ({
        value: result.stock.code,
        name: result.stock.name,
        label: `${result.stock.name}${result.stock.code}`
      }))
      setStockSearchOptions(options)
      return results
    } catch (error) {
      console.error('[RecordingControl] Stock search failed:', error)
      setStockSearchOptions([])
      return []
    } finally {
      setStockSearching(false)
    }
  }, [])

  const resolveStockByKeyword = useCallback(async (keyword: string, normalizeKeyword = false) => {
    const q = keyword.trim()
    if (!q) {
      setSelectedStockCode('')
      setSelectedStockName('')
      setStockSearchOptions([])
      setStockSearching(false)
      return
    }

    const normalizedCode = q.replace(/\D/g, '').slice(0, 6)
    if (/^\d{6}$/.test(q)) {
      setStockSearching(true)
      try {
        const stockInfo = await window.api.stock.getByCode(normalizedCode)
        if (stockInfo?.name) {
          setSelectedStockCode(normalizedCode)
          setSelectedStockName(stockInfo.name)
          if (normalizeKeyword) {
            setStockSearchKeyword(`${stockInfo.name}${normalizedCode}`)
          }
        } else {
          setSelectedStockCode(normalizedCode)
          setSelectedStockName(normalizedCode)
        }
      } catch (error) {
        console.error('[RecordingControl] getByCode failed:', error)
        setSelectedStockCode(normalizedCode)
        setSelectedStockName(normalizedCode)
      } finally {
        setStockSearching(false)
      }
      return
    }

    try {
      const results = await searchStockOptions(q, 8)
      const matched = results[0]?.stock
      if (matched) {
        setSelectedStockCode(matched.code)
        setSelectedStockName(matched.name)
        if (normalizeKeyword) {
          setStockSearchKeyword(`${matched.name}${matched.code}`)
        }
      } else {
        setSelectedStockCode('')
        setSelectedStockName(q)
      }
    } catch (error) {
      console.error('[RecordingControl] resolveStockByKeyword failed:', error)
      setSelectedStockCode('')
      setSelectedStockName(q)
    }
  }, [searchStockOptions])

  const scheduleStockSearch = useCallback((keyword: string) => {
    if (stockSearchTimerRef.current) {
      clearTimeout(stockSearchTimerRef.current)
    }
    stockSearchTimerRef.current = setTimeout(() => {
      void searchStockOptions(keyword)
    }, 220)
  }, [searchStockOptions])

  const handleAnalyze = useCallback(async (textToAnalyze: string) => {
    const normalizedInput = cleanTranscriptText(textToAnalyze)
    if (!normalizedInput.trim()) {
      message.warning('没有可解析的文本内容')
      return
    }

    setProcessingState('analyzing')
    setCurrentStep(1)
    message.info('正在快速匹配股票与标签...')

    try {
      const result = await window.api.ai.extractFast(normalizedInput)
      const optimizedContent = normalizeNoteContent(result.optimizedText || normalizedInput)
      setEditableNoteContent(optimizedContent || normalizedInput)

      let resolvedStock = result.stock
      if (!resolvedStock) {
        const fallbackMatch = await window.api.stock.match(optimizedContent || normalizedInput)
        if (fallbackMatch?.stock) {
          resolvedStock = {
            code: fallbackMatch.stock.code,
            name: fallbackMatch.stock.name,
            confidence: Math.min(0.95, Math.max(0.6, fallbackMatch.score / 100))
          }
        }
      }

      setExtractResult({
        ...result,
        stock: resolvedStock
      })
      setProcessingState('completed')
      setCurrentStep(2)
      setNoteDirection(mapAISentimentToDirection(result.note?.sentiment))
      const resolvedOperationTag = mapAIActionToOperationTag(result.note?.operationTag)
      setNoteOperationTag(resolvedOperationTag)

      if (resolvedStock) {
        message.success(`处理完成: ${resolvedStock.name}${resolvedStock.code}`)
        setSelectedStockCode(resolvedStock.code)
        setSelectedStockName(resolvedStock.name)
        setStockSearchKeyword(`${resolvedStock.name}${resolvedStock.code}`)
      } else {
        message.warning('未识别到股票，请手动选择')
      }

      const extractedTime = result.timestamp?.type === 'absolute' && result.timestamp?.value
        ? dayjs(result.timestamp.value)
        : null
      setNoteEventTime(extractedTime && extractedTime.isValid() ? extractedTime : dayjs())

    } catch (error: any) {
      console.error('[RecordingControl] Analysis failed:', error)
      message.error('处理失败: ' + error.message)
      setProcessingState('idle')
      setCurrentStep(0)
    }
  }, [])

  const handleAnalyzeManualInput = useCallback(async () => {
    const normalizedInput = cleanTranscriptText(manualInputText)
    if (!normalizedInput.trim()) {
      message.warning('请先输入要解析的文本')
      return
    }
    await handleAnalyze(normalizedInput)
  }, [handleAnalyze, manualInputText])

  const handleOpenModal = async () => {
    await loadUserPreferences()
    resetState()
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    resetState()
  }

  const handleSaveNote = async () => {
    if (!extractResult) return

    const normalizeStockCode = (value?: string) => String(value || '').replace(/\D/g, '').slice(0, 6)
    let stockCode = normalizeStockCode(selectedStockCode) || normalizeStockCode(extractResult.stock?.code)
    if (!stockCode) {
      try {
        const sourceText = [
          stockSearchKeyword,
          selectedStockName,
          manualInputText,
          editableNoteContent,
          extractResult.optimizedText,
          extractResult.originalText
        ]
          .filter(Boolean)
          .join('\n')
        const matched = await window.api.stock.match(sourceText)
        const matchedCode = normalizeStockCode(matched?.stock?.code)
        if (matchedCode) {
          stockCode = matchedCode
          setSelectedStockCode(matchedCode)
          if (matched?.stock?.name) {
            setSelectedStockName(matched.stock.name)
            setStockSearchKeyword(`${matched.stock.name}${matchedCode}`)
          } else {
            setStockSearchKeyword(matchedCode)
          }
        }
      } catch (error) {
        console.warn('[RecordingControl] stock.match fallback failed during save:', error)
      }
    }

    if (!stockCode || stockCode.length !== 6) {
      message.warning('请先选择或输入6位股票代码')
      return
    }

    const finalContent = normalizeNoteContent(editableNoteContent || extractResult.optimizedText || extractResult.originalText)
    if (!finalContent.trim()) {
      message.warning('笔记正文不能为空')
      return
    }

    setLoading(true)

    try {
      const horizonOptions = getEnabledOptions(activeCategoryConfig?.fields.timeHorizon.options || [])
      const preferredHorizon = settings?.notes.defaultTimeHorizon || '短线'
      const resolvedHorizon = horizonOptions.find((item) => item.code === preferredHorizon)?.code
        || horizonOptions[0]?.code
        || preferredHorizon
      const viewpoint: Viewpoint = {
        direction: noteDirection,
        confidence: noteDirection === '未知' ? 0 : noteDirection === '震荡' ? 0.6 : 0.7,
        timeHorizon: resolvedHorizon
      }
      const stockInfo = await window.api.stock.getByCode(stockCode)
      const resolvedStockName = selectedStockName || extractResult.stock?.name || stockInfo?.name || stockCode

      await window.api.notes.addEntry(stockCode, {
        content: finalContent,
        eventTime: (noteEventTime || dayjs()).toISOString(),
        category: noteCategory,
        operationTag: noteOperationTag,
        viewpoint,
        inputType: 'manual'
      })

      const updatedNote = await window.api.notes.getStockNote(stockCode)
      if (updatedNote) {
        setStockNote(stockCode, updatedNote)
      }

      setCurrentStock(stockCode, resolvedStockName)

      message.success('笔记已保存')
      setIsModalOpen(false)
      resetState()

    } catch (error: any) {
      console.error('[RecordingControl] Save failed:', {
        error,
        selectedStockCode,
        extractStockCode: extractResult.stock?.code,
        noteCategory,
        noteOperationTag
      })
      message.error('保存失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const getProcessingStateTag = () => {
    switch (processingState) {
      case 'analyzing':
        return <Tag color="cyan" icon={<LoadingOutlined />}>处理中</Tag>
      case 'completed':
        return <Tag color="green" icon={<CheckCircleOutlined />}>完成</Tag>
      default:
        return <Tag>就绪</Tag>
    }
  }

  return (
    <>
      <Button
        type="primary"
        icon={<EditOutlined />}
        onClick={handleOpenModal}
      >
        录入
      </Button>

      <Modal
        title="📝 快速录入"
        open={isModalOpen}
        onCancel={handleCloseModal}
        footer={null}
        width={800}
        maskClosable={false}
      >
        <div className="py-4">
          <Steps current={currentStep} size="small" className="mb-6">
            <Step title="输入" description="文本内容" />
            <Step title="处理" description="纠错和匹配" />
            <Step title="保存" description="笔记" />
          </Steps>

          <Divider />

          <div className="mb-4 flex items-center justify-end">
            {getProcessingStateTag()}
          </div>

          {currentStep === 0 && (
            <div className="space-y-4">
              <Card className="border border-blue-100 bg-blue-50/40">
                <div className="space-y-3">
                  <h4 className="font-medium m-0">输入待解析文本</h4>
                  <TextArea
                    value={manualInputText}
                    onChange={(event) => setManualInputText(event.target.value)}
                    autoSize={{ minRows: 8, maxRows: 16 }}
                    placeholder='粘贴你的盘中观点、语音转写结果或临时笔记，然后点击"开始解析"。'
                  />
                  <div className="flex justify-end">
                    <Button type="primary" icon={<EditOutlined />} onClick={() => { void handleAnalyzeManualInput() }}>
                      开始解析
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {currentStep === 1 && processingState === 'analyzing' && (
            <div className="text-center py-8">
              <LoadingOutlined className="text-5xl text-cyan-500 mb-4" />
              <div className="text-lg">正在快速匹配股票与标签...</div>
            </div>
          )}

          {currentStep === 2 && extractResult && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">输入原文</h4>
                <div className="text-gray-700">{manualInputText}</div>
                {!!extractResult.note?.sentiment && (
                  <div className="mt-2">
                    <Tag color="purple">AI观点: {extractResult.note.sentiment}</Tag>
                    <Tag color={mapAIActionToOperationTag(extractResult.note?.operationTag) === '无' ? 'default' : 'gold'}>
                      AI操作打标: {mapAIActionToOperationTag(extractResult.note?.operationTag)}
                    </Tag>
                  </div>
                )}
              </div>

              <div className="p-4 bg-amber-50 rounded-lg">
                <h4 className="font-medium mb-2">笔记正文（可编辑，默认简体）</h4>
                <TextArea
                  value={editableNoteContent}
                  onChange={(event) => setEditableNoteContent(event.target.value)}
                  autoSize={{ minRows: 5, maxRows: 10 }}
                  placeholder="请确认或编辑最终保存的笔记内容"
                />
              </div>

              {extractResult.stock && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium mb-2">
                    识别股票: {extractResult.stock.name} ({extractResult.stock.code})
                    <Tag color="blue" className="ml-2">{(extractResult.stock.confidence * 100).toFixed(0)}%</Tag>
                  </h4>
                </div>
              )}

              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-3">记录配置</h4>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <AutoComplete
                    value={stockSearchKeyword}
                    options={stockSearchOptions.map((item) => ({
                      value: item.value,
                      label: item.label,
                      name: item.name
                    }))}
                    style={{ width: 260 }}
                    placeholder="输入股票名称或代码（全量库模糊匹配）"
                    filterOption={false}
                    allowClear
                    onSearch={(value) => {
                      scheduleStockSearch(String(value || ''))
                    }}
                    onChange={(value) => {
                      const raw = String(value || '')
                      setStockSearchKeyword(raw)
                      if (!raw.trim()) {
                        if (stockSearchTimerRef.current) {
                          clearTimeout(stockSearchTimerRef.current)
                          stockSearchTimerRef.current = null
                        }
                        setSelectedStockCode('')
                        setSelectedStockName('')
                        setStockSearchOptions([])
                        setStockSearching(false)
                        return
                      }
                      setSelectedStockCode('')
                      setSelectedStockName(raw.trim())
                      scheduleStockSearch(raw)
                    }}
                    onSelect={(value, option) => {
                      const code = String(value || '').replace(/\D/g, '').slice(0, 6)
                      const picked = option as { name?: string; label?: string }
                      if (!code) return

                      setSelectedStockCode(code)
                      if (picked?.name) {
                        setSelectedStockName(picked.name)
                      } else {
                        setSelectedStockName(code)
                      }

                      if (typeof picked?.label === 'string') {
                        setStockSearchKeyword(picked.label)
                      } else {
                        setStockSearchKeyword(code)
                      }
                    }}
                    onInputKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      if (stockSearchTimerRef.current) {
                        clearTimeout(stockSearchTimerRef.current)
                        stockSearchTimerRef.current = null
                      }
                      void resolveStockByKeyword(stockSearchKeyword, true)
                    }}
                    onBlur={() => {
                      if (stockSearchTimerRef.current) {
                        clearTimeout(stockSearchTimerRef.current)
                        stockSearchTimerRef.current = null
                      }
                      void resolveStockByKeyword(stockSearchKeyword, true)
                    }}
                    status={!stockSearching && stockSearchKeyword.trim() && !selectedStockCode ? 'warning' : undefined}
                    notFoundContent={stockSearching ? '搜索中...' : '未找到匹配股票'}
                  />
                  {selectedStockCode ? (
                    <Tag color="blue">已匹配: {selectedStockName || selectedStockCode} ({selectedStockCode})</Tag>
                  ) : (
                    stockSearchKeyword.trim() && !stockSearching
                      ? <Tag color="orange">未匹配到股票代码</Tag>
                      : null
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={noteCategory}
                    onChange={(value) => setNoteCategory(value)}
                    style={{ width: 140 }}
                    size="small"
                    options={noteCategoryOptions}
                  />
                  <Select
                    value={noteDirection}
                    onChange={(value) => setNoteDirection(value)}
                    style={{ width: 120 }}
                    size="small"
                    disabled={!activeCategoryConfig?.fields.viewpoint.enabled}
                    options={noteDirectionOptions}
                  />
                  <Select
                    value={noteOperationTag}
                    onChange={(value) => setNoteOperationTag(value)}
                    style={{ width: 120 }}
                    size="small"
                    disabled={!activeCategoryConfig?.fields.operationTag.enabled}
                    options={noteOperationOptions}
                  />
                  <DatePicker
                    value={noteEventTime}
                    onChange={(value) => setNoteEventTime(value)}
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    placeholder="事件时间（分钟）"
                    size="small"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button onClick={() => { setCurrentStep(0); resetState(); }}>
                  重新输入
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveNote}>
                  保存笔记
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

export default RecordingControl
