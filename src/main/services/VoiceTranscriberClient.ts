import { spawn, ChildProcess } from 'child_process'
import WebSocket from 'ws'
import EventEmitter from 'events'
import path from 'path'
import fs from 'fs'
import { app, BrowserWindow } from 'electron'

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
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private servicePath: string
  private port: number
  private mainWindow: BrowserWindow | null = null

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
    const candidates = [
      path.join(process.cwd(), 'voice-transcriber-service/voice-transcriber-service'),
      path.join(process.cwd(), 'voice-transcriber-service/.build/debug/voice-transcriber-service'),
      path.join(process.cwd(), 'voice-transcriber-service/.build/release/voice-transcriber-service'),
      path.join(process.cwd(), '../voice-transcriber-service/voice-transcriber-service'),
      path.join(process.cwd(), '../voice-transcriber-service/.build/debug/voice-transcriber-service'),
      path.join(process.cwd(), '../voice-transcriber-service/.build/release/voice-transcriber-service')
    ]

    const matched = candidates.find((candidate) => fs.existsSync(candidate))
    return matched || candidates[0]
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  async start(): Promise<void> {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (!this.process) {
      await this.startService()
    }

    if (!this.isConnected) {
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

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://localhost:${this.port}`
      console.log('[VoiceClient] Connecting to:', url)
      
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        console.log('[VoiceClient] WebSocket connected')
        this.isConnected = true
        this.reconnectAttempts = 0
        resolve()
      })

      this.ws.on('message', (data) => {
        try {
          const message: ServerMessage = JSON.parse(data.toString())
          this.handleMessage(message)
        } catch (error) {
          console.error('[VoiceClient] Parse error:', error)
        }
      })

      this.ws.on('error', (error) => {
        console.error('[VoiceClient] WebSocket error:', error)
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          setTimeout(() => this.connectWebSocket(), 1000)
        } else {
          reject(error)
        }
      })

      this.ws.on('close', () => {
        console.log('[VoiceClient] WebSocket closed')
        this.isConnected = false
      })
    })
  }

  private handleMessage(message: ServerMessage): void {
    console.log('[VoiceClient] Message received:', message.type, message)
    
    switch (message.type) {
      case 'transcript':
        console.log('[VoiceClient] Emitting transcript:', message.text, message.isFinal)
        this.emit('transcript', message.text, message.isFinal)
        this.sendToRenderer('voice:transcript', message.text, message.isFinal)
        break
      case 'audio_saved':
        console.log('[VoiceClient] Emitting audio_saved:', message.audioPath)
        this.emit('audio_saved', message.audioPath)
        this.sendToRenderer('voice:audio_saved', message.audioPath)
        break
      case 'error':
        console.log('[VoiceClient] Emitting error:', message.errorMessage)
        this.emit('error', message.errorMessage)
        this.sendToRenderer('voice:error', message.errorMessage)
        break
      case 'status':
        console.log('[VoiceClient] Emitting status:', message.status)
        this.emit('status', message.status)
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

  private send(message: ClientMessage): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message))
    } else {
      throw new Error('语音服务未连接')
    }
  }

  startRecording(): void {
    console.log('[VoiceClient] Starting recording')
    this.send({ type: 'start' })
  }

  stopRecording(): void {
    console.log('[VoiceClient] Stopping recording')
    this.send({ type: 'stop' })
  }

  async transcribeFile(audioPath: string): Promise<string> {
    console.log('[VoiceClient] Transcribing file:', audioPath)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
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
        resolve(text || '')
      }

      const handleError = (error?: string) => {
        cleanup()
        reject(new Error(error || '语音转写失败'))
      }

      this.on('transcript', handleTranscript)
      this.on('error', handleError)

      try {
        this.send({ type: 'transcribe_file', audioPath })
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  ping(): void {
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
  }

  getStatus(): { isConnected: boolean; isRunning: boolean } {
    return {
      isConnected: this.isConnected,
      isRunning: this.process !== null
    }
  }
}

export const voiceTranscriberClient = new VoiceTranscriberClient()
