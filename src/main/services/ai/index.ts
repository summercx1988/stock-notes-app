import type { 
  TranscribeResult, 
  OptimizeResult, 
  ViewpointResult, 
  HealthStatus,
  AIMode 
} from '../../../shared/types'
import { LocalAIAdapter } from './local-adapter'
import { CloudAIAdapter } from './cloud-adapter'
import { AIScheduler } from './scheduler'

export class AIService {
  private scheduler: AIScheduler
  private localAdapter: LocalAIAdapter
  private cloudAdapter: CloudAIAdapter
  
  constructor() {
    this.localAdapter = new LocalAIAdapter()
    this.cloudAdapter = new CloudAIAdapter()
    this.scheduler = new AIScheduler(this.localAdapter, this.cloudAdapter)
  }
  
  async initialize(): Promise<void> {
    await Promise.all([
      this.localAdapter.initialize(),
      this.cloudAdapter.initialize()
    ])
  }
  
  async transcribe(audioPath: string): Promise<TranscribeResult> {
    const adapter = await this.scheduler.selectService('transcribe')
    return adapter.transcribe(audioPath)
  }
  
  async optimizeText(text: string): Promise<OptimizeResult> {
    const adapter = await this.scheduler.selectService('optimizeText')
    return adapter.optimizeText(text)
  }
  
  async extractViewpoint(text: string): Promise<ViewpointResult> {
    const adapter = await this.scheduler.selectService('extractViewpoint')
    return adapter.extractViewpoint(text)
  }
  
  async summarize(text: string): Promise<string> {
    const adapter = await this.scheduler.selectService('summarize')
    return adapter.summarize(text)
  }
  
  getMode(): AIMode {
    return this.scheduler.getMode()
  }
  
  setMode(mode: 'local' | 'cloud' | 'auto'): void {
    this.scheduler.setMode(mode)
  }
  
  async getHealth(): Promise<{ local: HealthStatus; cloud: HealthStatus }> {
    const [local, cloud] = await Promise.all([
      this.localAdapter.getHealthStatus(),
      this.cloudAdapter.getHealthStatus()
    ])
    return { local, cloud }
  }
}
