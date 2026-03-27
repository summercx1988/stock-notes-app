import { spawn, ChildProcess } from 'child_process'
import WebSocket from 'ws'
import EventEmitter from 'events'
import path from 'path'
import fs from 'fs'
import { app, BrowserWindow } from 'electron'
import { createTraceId, logPipelineEvent } from './pipeline-logger'
import { cleanTranscriptText } from '../../shared/text-normalizer'
import { resolveProjectRoot } from './data-paths'
import type { VoiceServiceStatus } from '../../shared/types'

interface ServerMessage {
  type: 'transcript' | 'audio_saved' | 'error' | 'pong' | 'status'
  text?: string
  isFinal?: boolean
  audioPath?: string
  errorMessage?: string
  status?: {
    isRecording: boolean
    duration: number
    memoryUsage: number
  }
}

interface ClientMessage {
  type: 'start' | 'stop' | 'ping' | 'transcribe_file'
  audioPath?: string
}

export class VoiceTranscriberClient extends EventEmitter {
  private process: ChildProcess | null = null
  private ws: WebSocket | null = null
  private isConnected: boolean = false
  private servicePath: string
  private port: number
  private mainWindow: BrowserWindow | null = null
  private currentServerStatus: ServerMessage['status'] = {
    isRecording: false,
    duration: 0,
    memoryUsage: 0
  }
  private recordingSessionActive: boolean = false
  private lastError?: string

  constructor(port: number = 8765) {
    super()
    this.port = port
    
    const isDev = !app.isPackaged
    if (isDev) {
      this.servicePath = this.resolveDevServicePath()
    } else {
      this.servicePath = path.join(
        path.dirname(app.getAppPath()),
        'voice-transcriber-service'
      )
    }
    console.log('[VoiceClient] Service path:', this.servicePath)
  }

  private resolveDevServicePath(): string {
    const projectRoot = resolveProjectRoot()
    const rootCandidates = [projectRoot, process.cwd(), path.resolve(process.cwd(), '..')].filter(Boolean) as string[]
    const candidates: string[] = []
    for (const root of rootCandidates) {
      candidates.push(path.join(root, 'voice-transcriber-service/voice-transcriber-service'))
      candidates.push(path.join(root, 'voice-transcriber-service/.build/debug/voice-transcriber-service'))
      candidates.push(path.join(root, 'voice-transcriber-service/.build/release/voice-transcriber-service'))
    }

    const uniqueCandidates = Array.from(new Set(candidates))
    const matched = uniqueCandidates.find((candidate) => fs.existsSync(candidate))
    return matched || uniqueCandidates[0] || path.join(process.cwd(), 'voice-transcriber-service/voice-transcriber-service')
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  async start(): Promise<void> {
    if (this.isSocketOpen()) {
      return
    }

    try {
      await this.connectWebSocket(800)
      return
    } catch {
      // No existing service is accepting connections, continue to spawn below.
    }

    if (!this.process) {
      await this.startService()
    }

    if (!this.isSocketOpen()) {
      await this.connectWebSocket()
    }
  }

  private async startService(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[VoiceClient] Starting service:', this.servicePath)
      
      this.process = spawn(this.servicePath, [], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      this.process.stdout?.on('data', (data) => {
        const output = data.toString()
        console.log('[VoiceService]', output.trim())
      })

      this.process.stderr?.on('data', (data) => {
        console.error('[VoiceService Error]', data.toString())
      })

      this.process.on('error', (error) => {
        console.error('[VoiceClient] Process error:', error)
        reject(error)
      })

      this.process.on('exit', (code) => {
        console.log('[VoiceClient] Process exited:', code)
        this.process = null
        this.isConnected = false
      })

      setTimeout(resolve, 2000)
    })
  }

  private async connectWebSocket(timeoutMs: number = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://localhost:${this.port}`
      console.log('[VoiceClient] Connecting to:', url)

      if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
        try {
          this.ws.removeAllListeners()
          this.ws.close()
        } catch {
          // ignore stale socket cleanup failure
        }
      }

      const ws = new WebSocket(url)
      this.ws = ws
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          ws.terminate()
        } catch {
          // ignore
        }
        reject(new Error('连接语音服务超时'))
      }, timeoutMs)

      ws.on('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        console.log('[VoiceClient] WebSocket connected')
        this.isConnected = true
        this.lastError = undefined
        this.publishStatus()
        resolve()
      })

      ws.on('message', (data) => {
        try {
          const message: ServerMessage = JSON.parse(data.toString())
          this.handleMessage(message)
        } catch (error) {
          console.error('[VoiceClient] Parse error:', error)
        }
      })

      ws.on('error', (error) => {
        console.error('[VoiceClient] WebSocket error:', error)
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(error)
        }
      })

      ws.on('close', () => {
        console.log('[VoiceClient] WebSocket closed')
        this.isConnected = false
        if (this.ws === ws) {
          this.ws = null
        }
        if (this.recordingSessionActive || this.currentServerStatus?.isRecording) {
          this.recordingSessionActive = false
          this.currentServerStatus = {
            isRecording: false,
            duration: 0,
            memoryUsage: this.currentServerStatus?.memoryUsage || 0
          }
          this.lastError = '录音连接已中断，请重新录音'
          this.emitVoiceError(this.lastError)
        }
        this.publishStatus()
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error('语音服务连接已关闭'))
        }
      })
    })
  }

  private handleMessage(message: ServerMessage): void {
    console.log('[VoiceClient] Message received:', message.type, message)
    
    switch (message.type) {
      case 'transcript':
        {
          const cleaned = this.cleanTranscriptText(message.text)
          console.log('[VoiceClient] Emitting transcript:', cleaned, message.isFinal)
          this.emit('transcript', cleaned, message.isFinal)
          this.sendToRenderer('voice:transcript', cleaned, message.isFinal)
        }
        break
      case 'audio_saved':
        console.log('[VoiceClient] Emitting audio_saved:', message.audioPath)
        this.recordingSessionActive = false
        this.currentServerStatus = {
          isRecording: false,
          duration: this.currentServerStatus?.duration || 0,
          memoryUsage: this.currentServerStatus?.memoryUsage || 0
        }
        this.lastError = undefined
        this.emit('audio_saved', message.audioPath)
        this.sendToRenderer('voice:audio_saved', message.audioPath)
        this.publishStatus()
        break
      case 'error':
        console.log('[VoiceClient] Emitting error:', message.errorMessage)
        this.lastError = message.errorMessage
        this.emitVoiceError(message.errorMessage)
        this.publishStatus()
        break
      case 'status':
        console.log('[VoiceClient] Emitting status:', message.status)
        this.currentServerStatus = {
          isRecording: Boolean(message.status?.isRecording),
          duration: message.status?.duration || 0,
          memoryUsage: message.status?.memoryUsage || 0
        }
        this.recordingSessionActive = Boolean(message.status?.isRecording)
        this.emit('status', this.getStatus())
        this.publishStatus()
        break
      case 'pong':
        break
    }
  }

  private sendToRenderer(channel: string, ...args: any[]) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args)
    }
  }

  private isSocketOpen(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN && this.isConnected)
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.isSocketOpen()) {
      this.ws.send(JSON.stringify(message))
    } else {
      throw new Error('语音服务未连接')
    }
  }

  async startRecording(): Promise<void> {
    console.log('[VoiceClient] Starting recording')
    if (!this.isSocketOpen()) {
      await this.start()
    }
    this.lastError = undefined
    this.recordingSessionActive = true
    this.send({ type: 'start' })
    this.publishStatus()
  }

  async stopRecording(): Promise<void> {
    console.log('[VoiceClient] Stopping recording')
    if (!this.isSocketOpen()) {
      if (this.recordingSessionActive || this.currentServerStatus?.isRecording) {
        throw new Error('录音连接已中断，音频可能未完整保存，请重新录音')
      }
      console.warn('[VoiceClient] stopRecording skipped: socket is not connected')
      return
    }
    this.send({ type: 'stop' })
  }

  async transcribeFile(audioPath: string): Promise<string> {
    console.log('[VoiceClient] Transcribing file:', audioPath)
    const traceId = createTraceId('asr')
    const startedAt = Date.now()
    logPipelineEvent({
      traceId,
      stage: 'asr',
      status: 'start',
      message: path.basename(audioPath)
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        logPipelineEvent({
          traceId,
          stage: 'asr',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'ASR_TIMEOUT'
        })
        reject(new Error('语音转写超时'))
      }, 120000)

      const cleanup = () => {
        clearTimeout(timeout)
        this.off('transcript', handleTranscript)
        this.off('error', handleError)
      }

      const handleTranscript = (text?: string, isFinal?: boolean) => {
        if (!isFinal) {
          return
        }

        cleanup()
        logPipelineEvent({
          traceId,
          stage: 'asr',
          status: 'success',
          durationMs: Date.now() - startedAt
        })
        resolve(text || '')
      }

      const handleError = (error?: string) => {
        cleanup()
        logPipelineEvent({
          traceId,
          stage: 'asr',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'ASR_STREAM_ERROR',
          message: error
        })
        reject(new Error(error || '语音转写失败'))
      }

      this.on('transcript', handleTranscript)
      this.on('error', handleError)

      try {
        this.send({ type: 'transcribe_file', audioPath })
      } catch (error) {
        cleanup()
        logPipelineEvent({
          traceId,
          stage: 'asr',
          status: 'error',
          durationMs: Date.now() - startedAt,
          errorCode: 'ASR_SEND_FAILED',
          message: error instanceof Error ? error.message : String(error)
        })
        reject(error)
      }
    })
  }

  ping(): void {
    if (!this.isSocketOpen()) return
    this.send({ type: 'ping' })
  }

  async stop(): Promise<void> {
    console.log('[VoiceClient] Stopping client')
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    if (this.process) {
      this.process.kill('SIGTERM')
      
      await new Promise<void>((resolve) => {
        this.process?.on('exit', () => resolve())
        setTimeout(resolve, 3000)
      })
      
      this.process = null
    }
    
    this.isConnected = false
    this.recordingSessionActive = false
    this.currentServerStatus = {
      isRecording: false,
      duration: 0,
      memoryUsage: 0
    }
    this.publishStatus()
  }

  getStatus(): VoiceServiceStatus {
    return {
      isConnected: this.isSocketOpen(),
      isRunning: this.process !== null || this.isSocketOpen(),
      isRecording: Boolean(this.currentServerStatus?.isRecording || this.recordingSessionActive),
      duration: this.currentServerStatus?.duration || 0,
      memoryUsage: this.currentServerStatus?.memoryUsage || 0,
      lastError: this.lastError
    }
  }

  private publishStatus(): void {
    const status = this.getStatus()
    this.sendToRenderer('voice:status', status)
  }

  private emitVoiceError(error?: string): void {
    if (!error) return
    if (this.listenerCount('error') > 0) {
      this.emit('error', error)
    }
    this.sendToRenderer('voice:error', error)
  }

  private cleanTranscriptText(text?: string): string {
    if (!text) return ''
    return cleanTranscriptText(text)
  }
}

export const voiceTranscriberClient = new VoiceTranscriberClient()
