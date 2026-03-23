import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, message, Modal, Input, Steps, Divider, Upload, Card, Tag, Progress } from 'antd'
import { AudioOutlined, SaveOutlined, UploadOutlined, LoadingOutlined, CheckCircleOutlined, CloudOutlined, LaptopOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'

const { TextArea } = Input
const { Step } = Steps

interface AIExtractResult {
  stock?: {
    code: string
    name: string
    confidence: number
  }
  note: {
    keyPoints: string[]
    sentiment?: string
    timeHorizon?: string
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
  const [selectedStockCode, setSelectedStockCode] = useState<string>('')
  const [transcribeProgress, setTranscribeProgress] = useState(0)

  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const resetState = useCallback(() => {
    setCurrentStep(0)
    setRecordingState('idle')
    setRecordingDuration(0)
    setAudioPath('')
    setTranscribedText('')
    setExtractResult(null)
    setSelectedStockCode('')
    setTranscribeProgress(0)

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const handleAnalyze = useCallback(async (textToAnalyze: string) => {
    if (!textToAnalyze.trim()) {
      message.warning('没有转写内容可供处理')
      return
    }

    setRecordingState('analyzing')
    setCurrentStep(3)
    message.info('正在纠错并匹配股票...')

    try {
      const result = await window.api.ai.extract(textToAnalyze)

      setExtractResult(result)
      setRecordingState('completed')
      setCurrentStep(4)

      if (result.stock) {
        message.success(`处理完成: ${result.stock.name} (${result.stock.code})`)
        setSelectedStockCode(result.stock.code)
      } else {
        message.warning('未识别到股票，请手动选择')
      }

    } catch (error: any) {
      console.error('[RecordingControl] Analysis failed:', error)
      message.error('处理失败: ' + error.message)
      setRecordingState('transcribing')
      setCurrentStep(2)
    }
  }, [])

  useEffect(() => {
    if (!isModalOpen) return

    const unsubscribeTranscript = window.api.voice.onTranscript((text, isFinal) => {
      console.log('[RecordingControl] Transcript received:', text, 'isFinal:', isFinal)
      setTranscribedText(text)
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
        const result = await window.api.voice.transcribeFile(path)

        clearInterval(progressInterval)
        setTranscribeProgress(100)

        const finalText = result?.success ? result.text?.trim() ?? '' : ''

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
  }, [isModalOpen, handleAnalyze, recordingDuration])

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
    setIsModalOpen(true)
    resetState()

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

    setLoading(true)

    try {
      await window.api.notes.addEntry(stockCode, {
        content: extractResult.optimizedText || extractResult.originalText,
        audioFile: audioPath,
        audioDuration: recordingDuration
      })

      const updatedNote = await window.api.notes.getStockNote(stockCode)
      if (updatedNote) {
        setStockNote(stockCode, updatedNote)
      }

      const stockInfo = await window.api.stock.getByCode(stockCode)
      setCurrentStock(stockCode, stockInfo?.name || stockCode)

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
      const result = await window.api.voice.transcribeFile(file.path)
      if (result.success && result.text) {
        setTranscribedText(result.text)
        handleAnalyze(result.text)
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
                    message.warning('云端 ASR 服务暂不可用')
                  }}
                  disabled
                >
                  云端 ASR (暂不可用)
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
                <h4 className="font-medium mb-2">转写结果</h4>
                <div className="text-gray-700">{transcribedText}</div>
              </div>

              {extractResult.stock && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-medium mb-2">
                    识别股票: {extractResult.stock.name} ({extractResult.stock.code})
                    <Tag color="blue" className="ml-2">{(extractResult.stock.confidence * 100).toFixed(0)}%</Tag>
                  </h4>
                </div>
              )}

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
