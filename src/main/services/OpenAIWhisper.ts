import fs from 'fs'
import FormData from 'form-data'
import fetch from 'node-fetch'
import { appConfigService } from './app-config'
import { cleanTranscriptText } from '../../shared/text-normalizer'

interface WhisperConfig {
  apiKey: string
  apiBaseUrl: string
  model: string
}

export class OpenAIWhisperService {
  private config: WhisperConfig

  constructor() {
    this.config = {
      apiKey: process.env.MINIMAX_API_KEY || process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || '',
      apiBaseUrl: process.env.MINIMAX_BASE_URL || process.env.WHISPER_API_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1',
      model: process.env.WHISPER_MODEL || 'speech-01'
    }
  }

  async transcribe(audioPath: string): Promise<string | null> {
    const runtime = await this.getRuntimeConfig()

    if (!runtime.apiKey) {
      console.error('[OpenAIWhisper] No API key configured. Set MINIMAX_API_KEY or OPENAI_API_KEY environment variable')
      return null
    }

    try {
      console.log('[OpenAIWhisper] Transcribing:', audioPath)
      console.log('[OpenAIWhisper] Using API:', runtime.apiBaseUrl)
      console.log('[OpenAIWhisper] Using model:', runtime.model)
      
      const formData = new FormData()
      formData.append('file', fs.createReadStream(audioPath))
      formData.append('model', runtime.model)
      formData.append('language', runtime.language === 'zh-CN' ? 'zh' : runtime.language)

      const response = await fetch(`${runtime.apiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${runtime.apiKey}`,
          ...formData.getHeaders()
        },
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[OpenAIWhisper] API error:', response.status, errorText)
        return null
      }

      const result = await response.json() as { text?: string }
      const cleanedText = cleanTranscriptText(result.text || '')
      console.log('[OpenAIWhisper] Result:', cleanedText.substring(0, 100))
      return cleanedText || null
    } catch (error) {
      console.error('[OpenAIWhisper] Error:', error)
      return null
    }
  }

  private async getRuntimeConfig(): Promise<WhisperConfig & { language: 'zh-CN' | 'zh' }> {
    const settings = await appConfigService.getAll()
    return {
      apiKey: settings.cloudASR.apiKey || this.config.apiKey,
      apiBaseUrl: settings.cloudASR.baseUrl || this.config.apiBaseUrl,
      model: settings.cloudASR.model || this.config.model,
      language: settings.cloudASR.language || 'zh-CN'
    }
  }
}

export const openAIWhisperService = new OpenAIWhisperService()
