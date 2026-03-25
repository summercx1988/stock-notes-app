import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, message, Modal, Steps, Divider, Upload, Card, Tag, Progress, DatePicker, Select, Input } from 'antd'
import { AudioOutlined, SaveOutlined, UploadOutlined, LoadingOutlined, CheckCircleOutlined, CloudOutlined, LaptopOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { NoteCategory, OperationTag, UserSettings, Viewpoint } from '../../shared/types'
import { cleanTranscriptText, normalizeNoteContent } from '../../shared/text-normalizer'

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

type TranscribeEngine = 'local' | 'cloud'
type RecordingState = 'idle' | 'connecting' | 'recording' | 'transcribing' | 'analyzing' | 'completed'
type StockSelectOption = { label: string; value: string; name: string }
const NOTE_CATEGORY_OPTIONS: Array<{ label: NoteCategory; value: NoteCategory }> = [
  { label: '看盘预测', value: '看盘预测' },
  { label: '操盘打标', value: '操盘打标' },
  { label: '交易札记', value: '交易札记' },
  { label: '备忘', value: '备忘' },
  { label: '资讯备忘', value: '资讯备忘' }
]

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
    style: '轻量'
  }
}

const isMissingHandlerError = (error: unknown) =>
  String((error as { message?: string })?.message || error).includes('No handler registered')

const RecordingControl: React.FC = () => {
  const { setStockNote, setLoading, setCurrentStock } = useAppStore()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [transcribeEngine, setTranscribeEngine] = useState<TranscribeEngine>('local')
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [audioPath, setAudioPath] = useState<string>('')
  const [transcribedText, setTranscribedText] = useState<string>('')
  const [extractResult, setExtractResult] = useState<AIExtractResult | null>(null)
  const [editableNoteContent, setEditableNoteContent] = useState<string>('')
  const [selectedStockCode, setSelectedStockCode] = useState<string>('')
  const [selectedStockName, setSelectedStockName] = useState<string>('')
  const [stockSearchOptions, setStockSearchOptions] = useState<StockSelectOption[]>([])
  const [watchlistOptions, setWatchlistOptions] = useState<StockSelectOption[]>([])
  const [stockSearching, setStockSearching] = useState(false)
  const [transcribeProgress, setTranscribeProgress] = useState(0)
  const [noteEventTime, setNoteEventTime] = useState<Dayjs | null>(dayjs())
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('看盘预测')
  const [noteDirection, setNoteDirection] = useState<Viewpoint['direction']>('未知')
  const [noteOperationTag, setNoteOperationTag] = useState<OperationTag>('无')
  const [settings, setSettings] = useState<UserSettings | null>(null)

  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const stockSearchTimerRef = useRef<NodeJS.Timeout | null>(null)
  const cloudASRReady = Boolean(settings?.cloudASR?.apiKey && settings?.cloudASR?.baseUrl)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const mapAISentimentToDirection = (sentiment?: string): Viewpoint['direction'] => {
    if (!sentiment) return '未知'
    if (sentiment.includes('看多') || sentiment === 'bullish') return '看多'
    if (sentiment.includes('看空') || sentiment === 'bearish') return '看空'
    if (sentiment.includes('震荡') || sentiment.includes('中性')) return '中性'
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
      const [config, watchlist] = await Promise.all([
        window.api.config.getAll(),
        window.api.watchlist.get()
      ])
      setSettings(config)
      setNoteCategory(config.notes.defaultCategory || '看盘预测')
      setNoteDirection(config.notes.defaultDirection || '未知')

      const options: StockSelectOption[] = (watchlist || []).map((stock: any) => ({
        value: stock.code,
        name: stock.name,
        label: `${stock.name}${stock.code}`
      }))
      setWatchlistOptions(options)
      setStockSearchOptions(options)
    } catch (error) {
      if (isMissingHandlerError(error)) {
        setSettings(DEFAULT_SETTINGS)
        setNoteCategory(DEFAULT_SETTINGS.notes.defaultCategory)
        setNoteDirection(DEFAULT_SETTINGS.notes.defaultDirection)
        setWatchlistOptions([])
        setStockSearchOptions([])
        console.warn('[RecordingControl] Missing config/watchlist IPC handlers, fallback to defaults.')
        return
      }
      console.error('[RecordingControl] Failed to load user preferences:', error)
    }
  }, [])

  const resetState = useCallback(() => {
    setCurrentStep(0)
    setRecordingState('idle')
    setRecordingDuration(0)
    setAudioPath('')
    setTranscribedText('')
    setExtractResult(null)
    setEditableNoteContent('')
    setSelectedStockCode('')
    setSelectedStockName('')
    setStockSearchOptions((prev) => (prev.length > 0 ? prev : watchlistOptions))
    setTranscribeProgress(0)
    setNoteEventTime(dayjs())
    setNoteCategory(settings?.notes.defaultCategory || '看盘预测')
    setNoteDirection(settings?.notes.defaultDirection || '未知')
    setNoteOperationTag('无')

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }

    if (stockSearchTimerRef.current) {
      clearTimeout(stockSearchTimerRef.current)
      stockSearchTimerRef.current = null
    }
  }, [settings?.notes.defaultCategory, settings?.notes.defaultDirection, watchlistOptions])

  useEffect(() => {
    void loadUserPreferences()
  }, [loadUserPreferences])

  useEffect(() => {
    if (!cloudASRReady && transcribeEngine === 'cloud') {
      setTranscribeEngine('local')
    }
  }, [cloudASRReady, transcribeEngine])

  const handleStockSearch = useCallback((query: string) => {
    if (stockSearchTimerRef.current) {
      clearTimeout(stockSearchTimerRef.current)
    }

    stockSearchTimerRef.current = setTimeout(async () => {
      const q = query.trim()
      if (!q) {
        setStockSearchOptions(() => {
          const selected = watchlistOptions.find((item) => item.value === selectedStockCode)
          if (selected) {
            return watchlistOptions
          }
          if (!selectedStockCode) {
            return watchlistOptions
          }
          return [
            ...watchlistOptions,
            { value: selectedStockCode, name: selectedStockName || selectedStockCode, label: `${selectedStockName || selectedStockCode}${selectedStockCode}` }
          ]
        })
        setStockSearching(false)
        return
      }

      if (/^\d{6}$/.test(q)) {
        setSelectedStockCode(q)
        setSelectedStockName(q)
        setStockSearchOptions((prev) => {
          const existing = prev.find((item) => item.value === q)
          if (existing) return prev
          return [...prev, { value: q, name: q, label: `股票代码 ${q}` }]
        })
      }

      setStockSearching(true)
      try {
        const results = await window.api.stock.search(q, 15)
        const options: StockSelectOption[] = results.map((result: any) => ({
          value: result.stock.code,
          name: result.stock.name,
          label: `${result.stock.name}${result.stock.code}`
        }))
        setStockSearchOptions((prev) => {
          const map = new Map<string, StockSelectOption>()
          watchlistOptions.forEach((item) => map.set(item.value, item))
          prev.forEach((item) => map.set(item.value, item))
          options.forEach((item) => map.set(item.value, item))
          return Array.from(map.values()).sort((left, right) => {
            const leftWatch = watchlistOptions.some((item) => item.value === left.value)
            const rightWatch = watchlistOptions.some((item) => item.value === right.value)
            if (leftWatch === rightWatch) return 0
            return leftWatch ? -1 : 1
          })
        })
      } catch (error) {
        console.error('[RecordingControl] Stock search failed:', error)
      } finally {
        setStockSearching(false)
      }
    }, 220)
  }, [selectedStockCode, selectedStockName, watchlistOptions])

  const handleAnalyze = useCallback(async (textToAnalyze: string) => {
    const normalizedInput = cleanTranscriptText(textToAnalyze)
    if (!normalizedInput.trim()) {
      message.warning('没有转写内容可供处理')
      return
    }

    setRecordingState('analyzing')
    setCurrentStep(3)
    message.info('正在纠错并匹配股票...')

    try {
      const result = await window.api.ai.extract(normalizedInput)
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
      setRecordingState('completed')
      setCurrentStep(4)
      setNoteDirection(mapAISentimentToDirection(result.note?.sentiment))
      const resolvedOperationTag = mapAIActionToOperationTag(result.note?.operationTag)
      setNoteOperationTag(resolvedOperationTag)
      if (resolvedOperationTag !== '无') {
        setNoteCategory((current) => (current === '看盘预测' ? '操盘打标' : current))
      }

      if (resolvedStock) {
        message.success(`处理完成: ${resolvedStock.name}${resolvedStock.code}`)
        setSelectedStockCode(resolvedStock.code)
        setSelectedStockName(resolvedStock.name)
        setStockSearchOptions((prev) => {
          const merged = new Map<string, StockSelectOption>()
          watchlistOptions.forEach((item) => merged.set(item.value, item))
          prev.forEach((item) => merged.set(item.value, item))
          merged.set(resolvedStock.code, {
            value: resolvedStock.code,
            name: resolvedStock.name,
            label: `${resolvedStock.name}${resolvedStock.code}`
          })
          return Array.from(merged.values())
        })
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
      setRecordingState('transcribing')
      setCurrentStep(2)
    }
  }, [watchlistOptions])

  const transcribeAudio = useCallback(async (path: string) => {
    if (transcribeEngine === 'cloud') {
      return window.api.voice.transcribeWithCloud(path)
    }
    return window.api.voice.transcribeFile(path)
  }, [transcribeEngine])

  useEffect(() => {
    if (!isModalOpen) return

    const unsubscribeTranscript = window.api.voice.onTranscript((text, isFinal) => {
      const cleaned = cleanTranscriptText(text)
      console.log('[RecordingControl] Transcript received:', cleaned, 'isFinal:', isFinal)
      setTranscribedText(cleaned)
      setTranscribeProgress(100)
    })

    const unsubscribeAudioSaved = window.api.voice.onAudioSaved(async (path) => {
      console.log('[RecordingControl] Audio saved:', path)
      setAudioPath(path)

      message.success({
        content: (
          <div>
            <div style={{ fontWeight: 'bold' }}>✅ 音频已保存</div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
              时长: {formatDuration(recordingDuration)}
            </div>
          </div>
        ),
        duration: 3
      })

      setRecordingState('transcribing')
      setCurrentStep(2)
      setTranscribeProgress(0)

      const progressInterval = setInterval(() => {
        setTranscribeProgress(prev => Math.min(prev + 10, 90))
      }, 500)

      try {
        const result = await transcribeAudio(path)

        clearInterval(progressInterval)
        setTranscribeProgress(100)

        const finalText = result?.success ? cleanTranscriptText(result.text?.trim() ?? '') : ''

        if (finalText) {
          setTranscribedText(finalText)
          handleAnalyze(finalText)
        } else {
          message.warning(result?.error || '转写结果为空，请重新录音')
          setRecordingState('idle')
          setCurrentStep(1)
        }
      } catch (error: any) {
        clearInterval(progressInterval)
        console.error('[RecordingControl] Transcribe failed:', error)
        message.error('转写失败: ' + error.message)
        setRecordingState('idle')
        setCurrentStep(1)
      }
    })

    const unsubscribeError = window.api.voice.onError((error) => {
      console.error('[RecordingControl] Error:', error)
      message.error('语音服务错误: ' + error)
      setRecordingState('idle')
    })

    return () => {
      unsubscribeTranscript()
      unsubscribeAudioSaved()
      unsubscribeError()
    }
  }, [isModalOpen, handleAnalyze, recordingDuration, transcribeAudio])

  const checkVoiceServiceStatus = async () => {
    try {
      const status = await window.api.voice.status()
      return status
    } catch (error) {
      console.error('[RecordingControl] Status check failed:', error)
      return null
    }
  }

  const handleOpenModal = async () => {
    await loadUserPreferences()
    resetState()
    setIsModalOpen(true)

    try {
      const status = await checkVoiceServiceStatus()
      if (!status?.isRunning || !status?.isConnected) {
        message.info('正在启动语音服务...')
        const result = await window.api.voice.start()
        if (!result?.success) {
          throw new Error(result?.error || '语音服务启动失败')
        }
        message.success('语音服务已启动')
      }
    } catch (error: any) {
      console.error('[RecordingControl] Failed to start voice service:', error)
      message.error('启动语音服务失败: ' + error.message)
    }
  }

  const handleCloseModal = () => {
    if (recordingState === 'recording') {
      stopRecording()
    }
    setIsModalOpen(false)
    resetState()
  }

  const startRecording = async () => {
    try {
      setRecordingState('connecting')
      const result = await window.api.voice.startRecording()
      if (!result?.success) {
        throw new Error(result?.error || '启动录音失败')
      }

      setRecordingState('recording')
      setCurrentStep(1)

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)

      message.success('开始录音')
    } catch (error: any) {
      console.error('[RecordingControl] Start recording failed:', error)
      message.error('启动录音失败: ' + error.message)
      setRecordingState('idle')
    }
  }

  const stopRecording = async () => {
    try {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }

      const result = await window.api.voice.stopRecording()
      if (!result?.success) {
        throw new Error(result?.error || '停止录音失败')
      }

      message.info('录音已停止，正在保存...')
    } catch (error: any) {
      console.error('[RecordingControl] Stop recording failed:', error)
      message.error('停止录音失败: ' + error.message)
      setRecordingState('idle')
    }
  }

  const handleSaveNote = async () => {
    if (!extractResult) return

    const stockCode = selectedStockCode || extractResult.stock?.code
    if (!stockCode) {
      message.warning('请选择股票')
      return
    }

    const finalContent = normalizeNoteContent(editableNoteContent || extractResult.optimizedText || extractResult.originalText)
    if (!finalContent.trim()) {
      message.warning('笔记正文不能为空')
      return
    }

    setLoading(true)

    try {
      const viewpoint: Viewpoint = {
        direction: noteDirection,
        confidence: noteDirection === '未知' ? 0 : noteDirection === '中性' ? 0.6 : 0.7,
        timeHorizon: settings?.notes.defaultTimeHorizon || '短线'
      }
      const stockInfo = await window.api.stock.getByCode(stockCode)
      const resolvedStockName = selectedStockName || extractResult.stock?.name || stockInfo?.name || stockCode

      await window.api.notes.addEntry(stockCode, {
        content: finalContent,
        eventTime: (noteEventTime || dayjs()).toISOString(),
        category: noteCategory,
        operationTag: noteOperationTag,
        viewpoint,
        inputType: 'voice',
        audioFile: audioPath,
        audioDuration: recordingDuration
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
      message.error('保存失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleUploadAudio = async (file: File) => {
    const validTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/m4a', 'audio/aac']
    if (!validTypes.includes(file.type) && !file.name.match(/\.(wav|mp3|m4a|aac)$/i)) {
      message.error('请上传 WAV/MP3/M4A/AAC 格式的音频文件')
      return false
    }

    setRecordingState('transcribing')
    setCurrentStep(2)
    setTranscribeProgress(0)

    try {
      const result = await transcribeAudio(file.path)
      if (result.success && result.text) {
        const cleaned = cleanTranscriptText(result.text)
        setTranscribedText(cleaned)
        handleAnalyze(cleaned)
      } else {
        throw new Error(result.error || '转写结果为空')
      }
    } catch (error: any) {
      message.error('转写失败: ' + error.message)
      setRecordingState('idle')
      setCurrentStep(0)
    }

    return false
  }

  const getRecordingStateTag = () => {
    switch (recordingState) {
      case 'connecting':
        return <Tag color="blue" icon={<LoadingOutlined />}>连接中</Tag>
      case 'recording':
        return <Tag color="red" icon={<AudioOutlined />}>录音中</Tag>
      case 'transcribing':
        return <Tag color="purple" icon={<LoadingOutlined />}>转写中</Tag>
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
        icon={<AudioOutlined />}
        onClick={handleOpenModal}
      >
        录音
      </Button>

      <Modal
        title="📝 语音录入"
        open={isModalOpen}
        onCancel={handleCloseModal}
        footer={null}
        width={800}
        maskClosable={false}
      >
        <div className="py-4">
          <Steps current={currentStep} size="small" className="mb-6">
            <Step title="录音" description="录制音频" />
            <Step title="转写" description="Whisper" />
            <Step title="处理" description="纠错和匹配" />
            <Step title="保存" description="笔记" />
          </Steps>

          <Divider />

          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-gray-600">转写引擎:</span>
              <div className="flex gap-2">
                <Button
                  type={transcribeEngine === 'local' ? 'primary' : 'default'}
                  icon={<LaptopOutlined />}
                  onClick={() => setTranscribeEngine('local')}
                >
                  本地 Whisper
                </Button>
                <Button
                  type={transcribeEngine === 'cloud' ? 'primary' : 'default'}
                  icon={<CloudOutlined />}
                  onClick={() => {
                    if (!cloudASRReady) {
                      message.warning('请先在设置中配置云端 ASR 的 API 地址和 Key')
                      return
                    }
                    setTranscribeEngine('cloud')
                  }}
                  disabled={!cloudASRReady}
                >
                  云端 ASR
                </Button>
              </div>
            </div>
            {getRecordingStateTag()}
          </div>

          {currentStep === 0 && (
            <div className="space-y-6">
              <div className="flex justify-center gap-4">
                <Card className="w-80 text-center">
                  <div className="py-8">
                    <AudioOutlined className="text-5xl text-blue-500 mb-4" />
                    <h4 className="font-bold text-lg mb-2">开始录音</h4>
                    <p className="text-gray-500 text-sm mb-4">点击下方按钮开始录制</p>
                    <Button
                      type="primary"
                      size="large"
                      icon={<AudioOutlined />}
                      onClick={startRecording}
                    >
                      开始录音
                    </Button>
                  </div>
                </Card>
              </div>

              <Divider plain>或者</Divider>

              <div className="flex justify-center">
                <Upload
                  accept=".wav,.mp3,.m4a,.aac"
                  beforeUpload={handleUploadAudio}
                  showUploadList={false}
                >
                  <Button icon={<UploadOutlined />} size="large">
                    上传音频文件
                  </Button>
                </Upload>
              </div>
            </div>
          )}

          {currentStep === 1 && recordingState === 'recording' && (
            <div className="text-center py-8">
              <div className="mb-6">
                <div className="text-6xl font-mono text-blue-500 mb-2">
                  {formatDuration(recordingDuration)}
                </div>
                <div className="text-gray-500">录音中...</div>
              </div>

              <Button
                type="primary"
                danger
                size="large"
                onClick={stopRecording}
              >
                停止录音
              </Button>
            </div>
          )}

          {currentStep === 2 && recordingState === 'transcribing' && (
            <div className="text-center py-8">
              <LoadingOutlined className="text-5xl text-purple-500 mb-4" />
              <div className="text-lg mb-4">正在转写音频...</div>
              <Progress percent={transcribeProgress} status="active" style={{ maxWidth: 300, margin: '0 auto' }} />
            </div>
          )}

          {currentStep === 3 && recordingState === 'analyzing' && (
            <div className="text-center py-8">
              <LoadingOutlined className="text-5xl text-cyan-500 mb-4" />
              <div className="text-lg">正在纠错并匹配股票...</div>
            </div>
          )}

          {currentStep === 4 && extractResult && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">ASR 原文</h4>
                <div className="text-gray-700">{transcribedText}</div>
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
                  <Select
                    showSearch
                    value={selectedStockCode || undefined}
                    onSearch={handleStockSearch}
                    filterOption={false}
                    loading={stockSearching}
                    style={{ width: 260 }}
                    placeholder="输入股票名称或代码"
                    options={stockSearchOptions}
                    onChange={(value, option) => {
                      const picked = option as { name?: string; label?: string }
                      setSelectedStockCode(value)
                      if (picked?.name) {
                        setSelectedStockName(picked.name)
                      } else if (typeof picked?.label === 'string') {
                        setSelectedStockName(picked.label)
                      } else {
                        setSelectedStockName(value)
                      }
                    }}
                    notFoundContent={stockSearching ? '搜索中...' : '未找到匹配股票'}
                  />
                  <Input
                    value={selectedStockCode}
                    placeholder="或手动输入6位代码"
                    style={{ width: 180 }}
                    maxLength={6}
                    onChange={(event) => {
                      const code = event.target.value.replace(/\D/g, '').slice(0, 6)
                      setSelectedStockCode(code)

                      if (!code) {
                        setSelectedStockName('')
                        return
                      }

                      if (code.length === 6) {
                        void window.api.stock.getByCode(code).then((stockInfo: any) => {
                          if (stockInfo?.name) {
                            setSelectedStockName(stockInfo.name)
                            setStockSearchOptions((prev) => {
                              const exists = prev.some((item) => item.value === code)
                              if (exists) return prev
                              return [...prev, {
                                value: code,
                                name: stockInfo.name,
                                label: `${stockInfo.name}${code}`
                              }]
                            })
                          } else {
                            setSelectedStockName(code)
                          }
                        }).catch((error) => {
                          console.error('[RecordingControl] getByCode failed:', error)
                          setSelectedStockName(code)
                        })
                      } else {
                        setSelectedStockName(code)
                      }
                    }}
                  />
                  {selectedStockCode && (
                    <Tag color="blue">已选: {selectedStockName || selectedStockCode}</Tag>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={noteCategory}
                    onChange={(value) => setNoteCategory(value)}
                    style={{ width: 140 }}
                    size="small"
                    options={NOTE_CATEGORY_OPTIONS}
                  />
                  <Select
                    value={noteDirection}
                    onChange={(value) => setNoteDirection(value)}
                    style={{ width: 120 }}
                    size="small"
                    options={[
                      { label: '未知', value: '未知' },
                      { label: '看多', value: '看多' },
                      { label: '看空', value: '看空' },
                      { label: '震荡/中性', value: '中性' }
                    ]}
                  />
                  <Select
                    value={noteOperationTag}
                    onChange={(value) => setNoteOperationTag(value)}
                    style={{ width: 120 }}
                    size="small"
                    options={[
                      { label: '操作打标: 无', value: '无' },
                      { label: '操作打标: 买入', value: '买入' },
                      { label: '操作打标: 卖出', value: '卖出' }
                    ]}
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
                  重新录音
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
