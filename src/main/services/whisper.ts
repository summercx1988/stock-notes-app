import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { spawn } from 'child_process'

export interface TranscribeResult {
  text: string
  segments: Array<{
    start: string
    end: string
    speech: string
  }>
}

const PROJECT_ROOT = path.resolve(__dirname, '../../../..')
const WHISPER_CPP_PATH = path.join(PROJECT_ROOT, 'node_modules/whisper-node/lib/whisper.cpp')
const MODEL_PATH = path.join(WHISPER_CPP_PATH, 'models/ggml-medium.bin')
const MAIN_PATH = path.join(WHISPER_CPP_PATH, 'main')

export class WhisperService {
  private available: boolean | null = null

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available
    }

    try {
      await fs.access(MODEL_PATH)
      await fs.access(MAIN_PATH)
      this.available = true
      console.log('[WhisperService] Model and binary found')
      return true
    } catch (error) {
      console.log('[WhisperService] Model or binary not found:', error)
      this.available = false
      return false
    }
  }

  async transcribe(audioPath: string): Promise<TranscribeResult> {
    const isAvailable = await this.isAvailable()
    
    if (!isAvailable) {
      throw new Error('Whisper 模型未安装。请运行下载命令安装模型。')
    }

    // 转换为 WAV 格式（如果不是）
    const wavPath = await this.convertToWav(audioPath)

    try {
      console.log('[WhisperService] Starting transcription for:', wavPath)
      
      const args = [
        '-m', MODEL_PATH,
        '-f', wavPath,
        '-l', 'zh',
        '-ml', '1',
        '--output-txt'
      ]

      const result = await this.runWhisper(args)
      const text = this.parseWhisperOutput(result)
      
      console.log('[WhisperService] Transcription complete:', text.substring(0, 100))

      // 清理临时 WAV 文件
      if (wavPath !== audioPath) {
        await fs.unlink(wavPath).catch(() => {})
      }

      return {
        text,
        segments: []
      }
    } catch (error: any) {
      console.error('[WhisperService] Transcribe error:', error)
      
      // 清理临时文件
      if (wavPath !== audioPath) {
        await fs.unlink(wavPath).catch(() => {})
      }
      
      throw new Error(`转写失败: ${error.message}`)
    }
  }

  async transcribeBuffer(audioBuffer: Buffer): Promise<TranscribeResult> {
    const tempDir = os.tmpdir()
    const tempFile = path.join(tempDir, `whisper_${Date.now()}.webm`)
    
    try {
      await fs.writeFile(tempFile, audioBuffer)
      console.log('[WhisperService] Temp audio file created:', tempFile)
      
      const result = await this.transcribe(tempFile)
      
      await fs.unlink(tempFile).catch(() => {})
      
      return result
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {})
      throw error
    }
  }

  private runWhisper(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const whisper = spawn('./main', args, {
        cwd: WHISPER_CPP_PATH
      })

      let stdout = ''
      let stderr = ''

      whisper.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      whisper.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      whisper.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          reject(new Error(`Whisper failed with code ${code}: ${stderr}`))
        }
      })

      whisper.on('error', (error) => {
        reject(new Error(`Whisper spawn error: ${error.message}`))
      })
    })
  }

  private parseWhisperOutput(output: string): string {
    const lines = output.split('\n')
    const textParts: string[] = []
    
    for (const line of lines) {
      // 匹配时间戳格式的行
      const match = line.match(/\[\d+:\d+:\d+\.\d+\s*-->\s*\d+:\d+:\d+\.\d+\]\s*(.+)$/)
      if (match) {
        textParts.push(match[1].trim())
      }
    }
    
    return textParts.join('')
  }

  private async convertToWav(audioPath: string): Promise<string> {
    // 如果已经是 WAV 格式，直接返回
    if (audioPath.toLowerCase().endsWith('.wav')) {
      // 检查是否是 16kHz 单声道
      const info = await this.getAudioInfo(audioPath)
      if (info.sampleRate === 16000 && info.channels === 1) {
        return audioPath
      }
    }

    // 转换为 16kHz 单声道 WAV
    const wavPath = audioPath.replace(/\.[^.]+$/, '_converted.wav')
    
    return new Promise((resolve, reject) => {
      console.log('[WhisperService] Converting to 16kHz WAV:', audioPath)
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', audioPath,
        '-ar', '16000',      // 采样率 16kHz
        '-ac', '1',          // 单声道
        '-f', 'wav',         // WAV 格式
        '-acodec', 'pcm_s16le',  // 16-bit PCM
        '-y',                // 覆盖已存在文件
        wavPath
      ])

      let stderr = ''
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log('[WhisperService] WAV conversion complete')
          resolve(wavPath)
        } else {
          console.error('[WhisperService] FFmpeg error:', stderr)
          reject(new Error('音频格式转换失败'))
        }
      })

      ffmpeg.on('error', (error) => {
        console.error('[WhisperService] FFmpeg spawn error:', error)
        reject(new Error('ffmpeg 未安装'))
      })
    })
  }

  private async getAudioInfo(audioPath: string): Promise<{ sampleRate: number; channels: number }> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-i', audioPath,
        '-show_entries', 'stream=sample_rate,channels',
        '-v', 'quiet',
        '-of', 'csv=p=0'
      ])

      let output = ''
      ffprobe.stdout.on('data', (data) => {
        output += data.toString()
      })

      ffprobe.on('close', () => {
        const parts = output.trim().split(',')
        resolve({
          sampleRate: parseInt(parts[0]) || 44100,
          channels: parseInt(parts[1]) || 1
        })
      })

      ffprobe.on('error', () => {
        resolve({ sampleRate: 44100, channels: 1 })
      })
    })
  }
}

export const whisperService = new WhisperService()
