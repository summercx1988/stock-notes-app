import fs from 'fs'
import FormData from 'form-data'
import fetch from 'node-fetch'
import { appConfigService } from './app-config'
import { cleanTranscriptText } from '../../shared/text-normalizer'

interface ASRConfig {
  apiKey: string
  apiBaseUrl: string
  model: string
}

const DOUBAO_BASE_URL = 'https://openspeech.bytedance.com/api/v1/vc'
const DOUBAO_MAX_POLL_MS = 120_000
const DOUBAO_POLL_INTERVAL_MS = 2_000

function isDoubaoASR(baseUrl: string): boolean {
  return baseUrl.includes('openspeech.bytedance.com')
}

export class OpenAIWhisperService {
  private config: ASRConfig

  constructor() {
    this.config = {
      apiKey: process.env.DOUBAO_ASR_TOKEN || process.env.MINIMAX_API_KEY || process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY || '',
      apiBaseUrl: process.env.DOUBAO_ASR_BASE_URL || process.env.MINIMAX_BASE_URL || process.env.WHISPER_API_BASE_URL || process.env.OPENAI_BASE_URL || DOUBAO_BASE_URL,
      model: process.env.WHISPER_MODEL || ''
    }
  }

  async transcribe(audioPath: string): Promise<string | null> {
    const runtime = await this.getRuntimeConfig()

    if (!runtime.apiKey) {
      console.error('[ASR] No API key configured.')
      return null
    }

    try {
      console.log('[ASR] Transcribing:', audioPath)
      console.log('[ASR] Using API:', runtime.apiBaseUrl)

      if (isDoubaoASR(runtime.apiBaseUrl)) {
        return await this.transcribeWithDoubao(audioPath, runtime)
      }
      return await this.transcribeWithOpenAI(audioPath, runtime)
    } catch (error) {
      console.error('[ASR] Error:', error)
      return null
    }
  }

  private async transcribeWithOpenAI(audioPath: string, runtime: ASRConfig & { language: string }): Promise<string | null> {
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
      console.error('[ASR] OpenAI-compat API error:', response.status, errorText)
      return null
    }

    const result = await response.json() as { text?: string }
    const cleanedText = cleanTranscriptText(result.text || '')
    console.log('[ASR] Result:', cleanedText.substring(0, 100))
    return cleanedText || null
  }

  private async transcribeWithDoubao(audioPath: string, runtime: ASRConfig & { language: string }): Promise<string | null> {
    const audioBuffer = fs.readFileSync(audioPath)
    const ext = audioPath.split('.').pop()?.toLowerCase() || 'wav'
    const contentType = ext === 'mp3' ? 'audio/mp3' : ext === 'ogg' ? 'audio/ogg' : 'audio/wav'

    console.log('[ASR] Submitting to Doubao ASR (file size:', audioBuffer.length, 'bytes)')

    const submitUrl = `${runtime.apiBaseUrl}/submit`
    const submitResponse = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer; ${runtime.apiKey}`
      },
      body: audioBuffer
    })

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text()
      console.error('[ASR] Doubao submit error:', submitResponse.status, errorText)
      return null
    }

    const submitResult = await submitResponse.json() as { code?: string | number; message?: string; id?: string }

    if (String(submitResult.code) !== '0') {
      console.error('[ASR] Doubao submit failed:', submitResult.message)
      return null
    }

    const jobId = submitResult.id
    console.log('[ASR] Doubao job submitted:', jobId)

    const queryUrl = `${runtime.apiBaseUrl}/query`
    const startTime = Date.now()

    while (Date.now() - startTime < DOUBAO_MAX_POLL_MS) {
      await this.sleep(DOUBAO_POLL_INTERVAL_MS)

      const queryResponse = await fetch(queryUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer; ${runtime.apiKey}`
        }
      })

      if (!queryResponse.ok) {
        console.error('[ASR] Doubao query error:', queryResponse.status)
        continue
      }

      const queryResult = await queryResponse.json() as {
        code?: string | number
        message?: string
        utterances?: Array<{ text: string }>
      }

      if (String(queryResult.code) !== '0' && String(queryResult.code) !== '1000') {
        console.error('[ASR] Doubao query failed:', queryResult.message)
        return null
      }

      if (queryResult.utterances && queryResult.utterances.length > 0) {
        const fullText = queryResult.utterances.map(u => u.text).join('')
        const cleanedText = cleanTranscriptText(fullText)
        console.log('[ASR] Doubao result:', cleanedText.substring(0, 100))
        return cleanedText || null
      }
    }

    console.error('[ASR] Doubao ASR timed out after', DOUBAO_MAX_POLL_MS, 'ms')
    return null
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async getRuntimeConfig(): Promise<ASRConfig & { language: string }> {
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
