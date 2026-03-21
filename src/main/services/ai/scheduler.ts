import type { IAIService, AIMode } from '../../../shared/types'
import { LocalAIAdapter } from './local-adapter'
import { CloudAIAdapter } from './cloud-adapter'

type ServiceType = 'transcribe' | 'optimizeText' | 'extractViewpoint' | 'summarize'

export class AIScheduler {
  private localAdapter: LocalAIAdapter
  private cloudAdapter: CloudAIAdapter
  private mode: AIMode = {
    current: 'cloud',
    forced: false
  }
  
  constructor(localAdapter: LocalAIAdapter, cloudAdapter: CloudAIAdapter) {
    this.localAdapter = localAdapter
    this.cloudAdapter = cloudAdapter
  }
  
  async selectService(_type: ServiceType): Promise<IAIService> {
    if (this.mode.forced) {
      return this.mode.current === 'local' ? this.localAdapter : this.cloudAdapter
    }
    
    return this.cloudAdapter
  }
  
  getMode(): AIMode {
    return { ...this.mode }
  }
  
  setMode(mode: 'local' | 'cloud' | 'auto'): void {
    if (mode === 'auto') {
      this.mode = { current: 'cloud', forced: false }
    } else {
      this.mode = { current: mode, forced: true }
    }
  }
}
