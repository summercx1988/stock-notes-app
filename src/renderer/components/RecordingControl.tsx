import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, message, Modal, Steps, Divider, Upload, Card, Tag, Progress, DatePicker, Select, Input, AutoComplete } from 'antd'
import { AudioOutlined, SaveOutlined, UploadOutlined, LoadingOutlined, CheckCircleOutlined, CloudOutlined, LaptopOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { NoteCategory, NoteCategoryConfig, OperationTag, UserSettings, Viewpoint, VoiceServiceStatus } from '../../shared/types'
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

type TranscribeEngine = 'local' | 'cloud'
type RecordingState = 'idle' | 'connecting' | 'recording' | 'stopping' | 'transcribing' | 'analyzing' | 'completed'
type StockSelectOption = { label: string; value: string; name: string }

const DEFAULT_SETTINGS: UserSettings = createDefaultUserSettings()

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
  const [stockSearchKeyword, setStockSearchKeyword] = useState<string>('')
  const [stockSearchOptions, setStockSearchOptions] = useState<StockSelectOption[]>([])
  const [stockSearching, setStockSearching] = useState(false)
  const [transcribeProgress, setTranscribeProgress] = useState(0)
  const [noteEventTime, setNoteEventTime] = useState<Dayjs | null>(dayjs())
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('看盘预测')
  const [noteDirection, setNoteDirection] = useState<Viewpoint['direction']>('未知')
  const [noteOperationTag, setNoteOperationTag] = useState<OperationTag>('无')
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoiceServiceStatus | null>(null)

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

  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const stockSearchTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioSavedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const disconnectHandledRef = useRef(false)
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

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const clearAudioSavedTimeout = useCallback(() => {
    if (audioSavedTimeoutRef.current) {
      clearTimeout(audioSavedTimeoutRef.current)
      audioSavedTimeoutRef.current = null
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
    setStockSearchKeyword('')
    setStockSearchOptions([])
    setStockSearching(false)
    setTranscribeProgress(0)
    setNoteEventTime(dayjs())
    const normalizedCategories = normalizeNoteCategoryConfigs(settings?.notes?.categoryConfigs || DEFAULT_NOTE_CATEGORY_CONFIGS)
    const enabledCodes = normalizedCategories.filter((item) => item.enabled !== false).map((item) => item.code)
    const preferredCategory = settings?.notes.defaultCategory && enabledCodes.includes(settings.notes.defaultCategory)
      ? settings.notes.defaultCategory
      : (enabledCodes[0] || '看盘预测')
    setNoteCategory(preferredCategory)
    setNoteDirection(normalizeDirectionAlias(settings?.notes.defaultDirection))
    setNoteOperationTag('无')
    setVoiceStatus(null)
    disconnectHandledRef.current = false

    clearRecordingTimer()
    clearAudioSavedTimeout()

    if (stockSearchTimerRef.current) {
      clearTimeout(stockSearchTimerRef.current)
      stockSearchTimerRef.current = null
    }
  }, [clearAudioSavedTimeout, clearRecordingTimer, settings])

  useEffect(() => {
    void loadUserPreferences()
  }, [loadUserPreferences])

  useEffect(() => {
    if (!cloudASRReady && transcribeEngine === 'cloud') {
      setTranscribeEngine('local')
    }
  }, [cloudASRReady, transcribeEngine])

  useEffect(() => {
    if (!isModalOpen || transcribeEngine !== 'local') return

    const unsubscribeStatus = window.api.voice.onStatus((status) => {
      setVoiceStatus(status)

      const isActivePhase = ['connecting', 'recording', 'stopping', 'transcribing'].includes(recordingState)
      if (!isActivePhase) {
        if (status.isConnected) {
          disconnectHandledRef.current = false
        }
        return
      }

      if (!status.isConnected && !disconnectHandledRef.current) {
        disconnectHandledRef.current = true
        clearRecordingTimer()
        clearAudioSavedTimeout()
        setRecordingState('idle')
        setCurrentStep(0)
        message.error(status.lastError || '录音连接已中断，请重新录音')
        return
      }

      if (status.isConnected) {
        disconnectHandledRef.current = false
      }
    })

    return () => {
      unsubscribeStatus()
    }
  }, [clearAudioSavedTimeout, clearRecordingTimer, isModalOpen, recordingState, transcribeEngine])

  useEffect(() => {
    if (!isModalOpen || transcribeEngine !== 'local') return
    if (!['connecting', 'recording', 'stopping', 'transcribing'].includes(recordingState)) return

    const timer = setInterval(() => {
      void window.api.voice.status()
        .then((status) => {
          setVoiceStatus(status)
          if (!status.isConnected && !disconnectHandledRef.current) {
            disconnectHandledRef.current = true
            clearRecordingTimer()
            clearAudioSavedTimeout()
            setRecordingState('idle')
            setCurrentStep(0)
            message.error(status.lastError || '录音连接已中断，请重新录音')
          }
          if (status.isConnected) {
            disconnectHandledRef.current = false
          }
        })
        .catch((error) => {
          console.warn('[RecordingControl] voice.status polling failed:', error)
        })
    }, 1500)

    return () => clearInterval(timer)
  }, [isModalOpen, recordingState, transcribeEngine])

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
      message.warning('没有转写内容可供处理')
      return
    }

    setRecordingState('analyzing')
    setCurrentStep(3)
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
      setRecordingState('completed')
      setCurrentStep(4)
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
      setRecordingState('transcribing')
      setCurrentStep(2)
    }
  }, [])

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
      clearAudioSavedTimeout()
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
      clearRecordingTimer()
      clearAudioSavedTimeout()
      message.error('语音服务错误: ' + error)
      setRecordingState('idle')
      setCurrentStep(0)
    })

    return () => {
      unsubscribeTranscript()
      unsubscribeAudioSaved()
      unsubscribeError()
    }
  }, [clearAudioSavedTimeout, clearRecordingTimer, handleAnalyze, isModalOpen, recordingDuration, transcribeAudio])

  const checkVoiceServiceStatus = async () => {
    try {
      const status = await window.api.voice.status()
      setVoiceStatus(status)
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
        const latestStatus = await checkVoiceServiceStatus()
        setVoiceStatus(latestStatus)
        message.success('语音服务已启动')
      }

      const effectiveStatus = await checkVoiceServiceStatus()
      if (effectiveStatus?.isRecording) {
        setRecordingState('recording')
        setCurrentStep(1)
        setRecordingDuration(Math.max(0, Math.floor(effectiveStatus.duration || 0)))
        clearRecordingTimer()
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1)
        }, 1000)
        message.info('检测到已有录音会话，已恢复录音状态')
      }
    } catch (error: any) {
      console.error('[RecordingControl] Failed to start voice service:', error)
      message.error('启动语音服务失败: ' + error.message)
    }
  }

  const handleCloseModal = () => {
    if (recordingState === 'recording') {
      void stopRecording()
    }
    setIsModalOpen(false)
    resetState()
  }

  const startRecording = async () => {
    if (recordingState === 'connecting' || recordingState === 'recording' || recordingState === 'stopping') {
      return
    }

    try {
      clearAudioSavedTimeout()
      disconnectHandledRef.current = false
      setRecordingState('connecting')

      const latestStatus = await checkVoiceServiceStatus()
      if (latestStatus?.isRecording) {
        setRecordingState('recording')
        setCurrentStep(1)
        setRecordingDuration(Math.max(0, Math.floor(latestStatus.duration || 0)))
        clearRecordingTimer()
        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1)
        }, 1000)
        message.info('当前已有录音进行中')
        return
      }

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
      clearRecordingTimer()
      clearAudioSavedTimeout()
      setRecordingState('stopping')
      setCurrentStep(2)

      const result = await window.api.voice.stopRecording()
      if (!result?.success) {
        throw new Error(result?.error || '停止录音失败')
      }

      audioSavedTimeoutRef.current = setTimeout(() => {
        setRecordingState('idle')
        setCurrentStep(0)
        message.error('停止录音后未收到音频保存结果，可能是录音连接中断，请重新录音')
      }, 8000)

      message.info('录音已停止，正在保存音频...')
    } catch (error: any) {
      console.error('[RecordingControl] Stop recording failed:', error)
      message.error('停止录音失败: ' + error.message)
      setRecordingState('idle')
      setCurrentStep(0)
    }
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
          editableNoteContent,
          extractResult.optimizedText,
          extractResult.originalText,
          transcribedText
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
      case 'stopping':
        return <Tag color="orange" icon={<LoadingOutlined />}>保存音频中</Tag>
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
                      disabled={recordingState === 'connecting' || recordingState === 'recording' || recordingState === 'stopping'}
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

          {currentStep === 2 && recordingState === 'stopping' && (
            <div className="text-center py-8">
              <LoadingOutlined className="text-5xl text-orange-500 mb-4" />
              <div className="text-lg mb-4">正在结束录音并保存音频...</div>
              <div className="text-gray-500 text-sm">
                {voiceStatus?.isConnected === false ? '检测到录音连接异常，正在等待结果...' : '请稍候，随后会自动进入转写'}
              </div>
            </div>
          )}

          {currentStep === 3 && recordingState === 'analyzing' && (
            <div className="text-center py-8">
              <LoadingOutlined className="text-5xl text-cyan-500 mb-4" />
              <div className="text-lg">正在快速匹配股票与标签...</div>
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
