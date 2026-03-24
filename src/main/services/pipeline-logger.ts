export type PipelineStage = 'asr' | 'extract' | 'match' | 'save' | 'timeline' | 'review'
export type PipelineStatus = 'start' | 'success' | 'error'

export interface PipelineLogEvent {
  traceId: string
  stage: PipelineStage
  status: PipelineStatus
  stockCode?: string
  category?: string
  durationMs?: number
  errorCode?: string
  message?: string
  extra?: Record<string, unknown>
}

export function createTraceId(prefix: string = 'trace'): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

export function logPipelineEvent(event: PipelineLogEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    trace_id: event.traceId,
    stage: event.stage,
    status: event.status,
    stock_code: event.stockCode,
    category: event.category,
    duration_ms: event.durationMs,
    error_code: event.errorCode,
    message: event.message,
    ...event.extra
  }
  console.log('[Pipeline]', JSON.stringify(payload))
}

