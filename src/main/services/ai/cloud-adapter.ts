import type { IAIService, TranscribeResult, OptimizeResult, ViewpointResult, HealthStatus } from '../../../shared/types'
import fs from 'fs/promises'
import path from 'path'

export class CloudAIAdapter implements IAIService {
  readonly provider = 'openai'
  readonly mode = 'cloud' as const

  private apiKey: string
  private baseUrl: string = 'https://api.openai.com/v1'
  private chatModel: string = 'gpt-4o-mini'

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || ''
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      console.warn('OpenAI API Key not configured')
    }
  }

  async transcribe(audioPath: string): Promise<TranscribeResult> {
    const startTime = Date.now()
    
    try {
      const audioBuffer = await fs.readFile(audioPath)
      const formData = new FormData()
      
      const audioBlob = new Blob([audioBuffer], { type: 'audio/webm' })
      formData.append('file', audioBlob, path.basename(audioPath))
      formData.append('model', 'whisper-1')
      formData.append('language', 'zh')

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Whisper API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      
      return {
        text: data.text || '',
        confidence: 0.9,
        processingTime: Date.now() - startTime
      }
    } catch (error: any) {
      console.error('[CloudAIAdapter] Transcribe failed:', error)
      throw error
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
    const prompt = `请为以下投资笔记生成一个简洁的摘要（不超过100字）：

${text}

摘要：`

    return this.chat(prompt)
  }

  async isAvailable(): Promise<boolean> {
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
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.chatModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices[0].message.content
  }
}
