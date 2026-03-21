import type { IAIService, TranscribeResult, OptimizeResult, ViewpointResult, HealthStatus } from '../../../shared/types'

export class LocalAIAdapter implements IAIService {
  readonly provider = 'local'
  readonly mode = 'local' as const
  
  async initialize(): Promise<void> {
    // Local adapter initialization
  }
  
  async transcribe(_audioPath: string): Promise<TranscribeResult> {
    return {
      text: '本地语音识别暂未实现，请使用云端模式',
      confidence: 0,
      processingTime: 0
    }
  }
  
  async optimizeText(text: string): Promise<OptimizeResult> {
    return {
      original: text,
      optimized: text,
      changes: []
    }
  }
  
  async extractViewpoint(_text: string): Promise<ViewpointResult> {
    return {
      direction: '中性',
      confidence: 0.5,
      timeHorizon: '中线',
      reasoning: '本地模型暂未实现',
      keyFactors: []
    }
  }
  
  async summarize(text: string): Promise<string> {
    return text.slice(0, 100)
  }
  
  async isAvailable(): Promise<boolean> {
    return false
  }
  
  async getHealthStatus(): Promise<HealthStatus> {
    return {
      available: false,
      error: '本地模型未配置',
      lastChecked: new Date()
    }
  }
}
