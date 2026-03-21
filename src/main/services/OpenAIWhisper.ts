import fs from 'fs'
import FormData from 'form-data'
import fetch from 'node-fetch'

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
    if (!this.config.apiKey) {
      console.error('[OpenAIWhisper] No API key configured. Set MINIMAX_API_KEY or OPENAI_API_KEY environment variable')
      return null
    }

    try {
      console.log('[OpenAIWhisper] Transcribing:', audioPath)
      console.log('[OpenAIWhisper] Using API:', this.config.apiBaseUrl)
      console.log('[OpenAIWhisper] Using model:', this.config.model)
      
      const formData = new FormData()
      formData.append('file', fs.createReadStream(audioPath))
      formData.append('model', this.config.model)
      formData.append('language', 'zh')

      const response = await fetch(`${this.config.apiBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
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
      console.log('[OpenAIWhisper] Result:', result.text?.substring(0, 100))
      return result.text || null
    } catch (error) {
      console.error('[OpenAIWhisper] Error:', error)
      return null
    }
  }
}

export const openAIWhisperService = new OpenAIWhisperService()
