import type { IAIService, TranscribeResult, OptimizeResult, ViewpointResult, HealthStatus } from '../../../shared/types'
import fs from 'fs/promises'
import path from 'path'
import { appConfigService } from '../app-config'
import { appLogger } from '../app-logger'
import { DEFAULT_CLOUD_ASR_SETTINGS, DEFAULT_TEXT_ANALYSIS_SETTINGS } from '../../../shared/default-user-settings'

export class CloudAIAdapter implements IAIService {
  readonly provider = 'openai'
  readonly mode = 'cloud' as const

  private apiKey: string
  private baseUrl: string
  private chatModel: string

  constructor() {
    this.baseUrl = DEFAULT_TEXT_ANALYSIS_SETTINGS.baseUrl
    this.chatModel = DEFAULT_TEXT_ANALYSIS_SETTINGS.model
    this.apiKey = DEFAULT_TEXT_ANALYSIS_SETTINGS.apiKey
  }

  async initialize(): Promise<void> {
    await this.refreshRuntimeConfig()
    if (!this.apiKey) {
      console.warn('[CloudAIAdapter] API Key not configured')
    }
    appLogger.info('CloudAIAdapter', 'Cloud adapter initialized', {
      baseUrl: this.baseUrl,
      chatModel: this.chatModel,
      hasApiKey: Boolean(this.apiKey)
    })
  }

  async transcribe(audioPath: string): Promise<TranscribeResult> {
    const startTime = Date.now()
    let runtimeBaseUrl = this.baseUrl
    
    try {
      const runtime = await this.getASRRuntimeConfig()
      runtimeBaseUrl = runtime.baseUrl
      if (!runtime.apiKey) {
        throw new Error('云端语音识别 API Key 未配置，请在设置中填写')
      }

      appLogger.info('CloudAIAdapter', 'ASR request started', {
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        audioFile: path.basename(audioPath)
      })

      const audioBuffer = await fs.readFile(audioPath)
      const formData = new FormData()
      
      const audioBlob = new Blob([audioBuffer], { type: 'audio/webm' })
      formData.append('file', audioBlob, path.basename(audioPath))
      formData.append('model', runtime.model || 'whisper-1')
      formData.append('language', 'zh')

      const response = await fetch(`${runtime.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtime.apiKey}`
        },
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        appLogger.warn('CloudAIAdapter', 'ASR request failed with non-2xx response', {
          baseUrl: runtime.baseUrl,
          status: response.status,
          responseBodyPreview: errorText.slice(0, 300)
        })
        throw new Error(`Whisper API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      appLogger.info('CloudAIAdapter', 'ASR request completed', {
        baseUrl: runtime.baseUrl,
        processingTimeMs: Date.now() - startTime,
        textChars: String(data?.text || '').length
      })
      
      return {
        text: data.text || '',
        confidence: 0.9,
        processingTime: Date.now() - startTime
      }
    } catch (error: any) {
      console.error('[CloudAIAdapter] Transcribe failed:', error)
      appLogger.error('CloudAIAdapter', 'ASR request threw exception', {
        baseUrl: runtimeBaseUrl,
        error
      })
      throw this.normalizeError(error, runtimeBaseUrl, '语音识别')
    }
  }

  async optimizeText(text: string): Promise<OptimizeResult> {
    const prompt = `请优化以下语音转文字内容，要求：
1. 去除"嗯"、"啊"等口语化表达
2. 修正语法错误和标点符号
3. 保持原文的投资逻辑和专业术语
4. 不要添加原文没有的内容

原文：
${text}

请直接输出优化后的文本：`

    const response = await this.chat(prompt)

    return {
      original: text,
      optimized: response,
      changes: []
    }
  }

  async extractViewpoint(text: string): Promise<ViewpointResult> {
    const prompt = `分析以下投资笔记，提取投资观点：

${text}

请以JSON格式返回：
{
  "direction": "看多/看空/未知",
  "confidence": 0.0-1.0,
  "timeHorizon": "短线/中线/长线",
  "reasoning": "判断理由",
  "keyFactors": ["因素1", "因素2"]
}`

    const response = await this.chat(prompt)
    try {
      return JSON.parse(response)
    } catch {
      return {
        direction: '未知',
        confidence: 0,
        timeHorizon: '短线',
        reasoning: response,
        keyFactors: []
      }
    }
  }

  async summarize(text: string): Promise<string> {
    return this.chat(text)
  }

  async isAvailable(): Promise<boolean> {
    await this.refreshRuntimeConfig()
    return !!this.apiKey
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const available = await this.isAvailable()
    return {
      available,
      lastChecked: new Date()
    }
  }

  private async chat(prompt: string): Promise<string> {
    const runtime = await this.getTextRuntimeConfig()
    if (!runtime.apiKey) {
      throw new Error('AI 文本分析 API Key 未配置，请在设置 > 偏好设置 > 文本分析中填写')
    }

    try {
      appLogger.debug('CloudAIAdapter', 'Text analysis request started', {
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        promptChars: prompt.length
      })

      const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtime.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: runtime.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        appLogger.warn('CloudAIAdapter', 'Text analysis request failed with non-2xx response', {
          baseUrl: runtime.baseUrl,
          model: runtime.model,
          status: response.status,
          responseBodyPreview: errorText.slice(0, 300)
        })
        throw new Error(`AI API 响应异常 (${response.status}) ${errorText}`)
      }

      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content || ''
      appLogger.debug('CloudAIAdapter', 'Text analysis request completed', {
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        responseChars: String(content).length
      })
      return content
    } catch (error: any) {
      appLogger.error('CloudAIAdapter', 'Text analysis request threw exception', {
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        error
      })
      throw this.normalizeError(error, runtime.baseUrl, '文本分析')
    }
  }

  private async refreshRuntimeConfig(): Promise<void> {
    try {
      const settings = await appConfigService.getAll()
      this.baseUrl = this.normalizeBaseUrl(
        settings?.textAnalysis?.baseUrl || this.baseUrl
      )
      this.chatModel = settings?.textAnalysis?.model || this.chatModel
      this.apiKey = settings?.textAnalysis?.apiKey || this.apiKey
    } catch (error) {
      console.warn('[CloudAIAdapter] Failed to load runtime config, fallback to saved defaults:', error)
      appLogger.warn('CloudAIAdapter', 'Failed to load runtime config, fallback to saved defaults', { error })
    }
  }

  private async getTextRuntimeConfig(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    await this.refreshRuntimeConfig()
    return {
      baseUrl: this.baseUrl,
      model: this.chatModel,
      apiKey: this.apiKey
    }
  }

  private async getASRRuntimeConfig(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    try {
      const settings = await appConfigService.getAll()
      return {
        baseUrl: this.normalizeBaseUrl(
          settings?.cloudASR?.baseUrl || DEFAULT_CLOUD_ASR_SETTINGS.baseUrl
        ),
        model: settings?.cloudASR?.model || DEFAULT_CLOUD_ASR_SETTINGS.model,
        apiKey: settings?.cloudASR?.apiKey || DEFAULT_CLOUD_ASR_SETTINGS.apiKey
      }
    } catch {
      return {
        baseUrl: this.normalizeBaseUrl(DEFAULT_CLOUD_ASR_SETTINGS.baseUrl),
        model: DEFAULT_CLOUD_ASR_SETTINGS.model,
        apiKey: DEFAULT_CLOUD_ASR_SETTINGS.apiKey
      }
    }
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return String(baseUrl || '').replace(/\/+$/, '')
  }

  private normalizeError(error: any, baseUrl: string, scene: string): Error {
    const rawMessage = String(error?.message || error || '').trim()
    if (rawMessage.toLowerCase().includes('fetch failed')) {
      appLogger.warn('CloudAIAdapter', 'Detected fetch failed error', {
        scene,
        baseUrl,
        rawMessage
      })
      return new Error(`${scene}请求失败：无法连接到服务地址 ${baseUrl}，请检查网络或在设置中更换 baseUrl`)
    }
    appLogger.warn('CloudAIAdapter', 'Normalized upstream error', {
      scene,
      baseUrl,
      rawMessage
    })
    return error instanceof Error ? error : new Error(rawMessage || `${scene}请求失败`)
  }
}
