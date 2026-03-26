import fs from 'fs/promises'
import path from 'path'
import type { UserSettings } from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, normalizeNoteCategoryConfigs } from '../../shared/note-categories'
import { getDataPath } from './data-paths'

const SETTINGS_PATH = getDataPath('config', 'settings.json')

const DEFAULT_SETTINGS: UserSettings = {
  textAnalysis: {
    baseUrl: process.env.OPENAI_BASE_URL || process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
    model: process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed',
    apiKey: process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || ''
  },
  cloudASR: {
    baseUrl: process.env.WHISPER_API_BASE_URL || process.env.OPENAI_BASE_URL || process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
    model: process.env.WHISPER_MODEL || 'speech-01',
    apiKey: process.env.WHISPER_API_KEY || process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || '',
    language: 'zh-CN'
  },
  notes: {
    defaultCategory: '看盘预测',
    defaultDirection: '未知',
    defaultTimeHorizon: '短线',
    style: '轻量',
    categoryConfigs: DEFAULT_NOTE_CATEGORY_CONFIGS
  },
  feishu: {
    enabled: true,
    appId: 'cli_a9496c7813a1dbc8',
    appSecret: '1CF9rURs8T1KD65oEvJzYbZktfeVzwLB',
    encryptKey: '',
    verificationToken: ''
  }
}

class AppConfigService {
  private cache: UserSettings | null = null
  private loadingPromise: Promise<UserSettings> | null = null

  async getAll(): Promise<UserSettings> {
    const settings = await this.ensureLoaded()
    return this.clone(settings)
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const settings = await this.ensureLoaded()
    if (!key || !key.trim()) {
      return this.clone(settings) as T
    }
    return this.getByPath(settings as unknown as Record<string, unknown>, key) as T | undefined
  }

  async set(key: string, value: unknown): Promise<UserSettings> {
    if (!key || !key.trim()) {
      throw new Error('config key is required')
    }
    const settings = await this.ensureLoaded()
    this.setByPath(settings as unknown as Record<string, unknown>, key, value)
    settings.notes.categoryConfigs = normalizeNoteCategoryConfigs(settings.notes.categoryConfigs)
    await this.persist(settings)
    return this.clone(settings)
  }

  async update(partial: Partial<UserSettings>): Promise<UserSettings> {
    const settings = await this.ensureLoaded()
    const merged = this.deepMerge(
      settings as unknown as Record<string, unknown>,
      partial as unknown as Record<string, unknown>
    ) as unknown as UserSettings
    merged.notes.categoryConfigs = normalizeNoteCategoryConfigs(merged.notes.categoryConfigs)
    await this.persist(merged)
    return this.clone(merged)
  }

  private async ensureLoaded(): Promise<UserSettings> {
    if (this.cache) {
      return this.cache
    }
    if (this.loadingPromise) {
      return this.loadingPromise
    }
    this.loadingPromise = this.loadFromFile()
    const loaded = await this.loadingPromise
    this.cache = loaded
    this.loadingPromise = null
    return loaded
  }

  private async loadFromFile(): Promise<UserSettings> {
    try {
      const content = await fs.readFile(SETTINGS_PATH, 'utf-8')
      const parsed = JSON.parse(content) as Partial<UserSettings>
      const merged = this.deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        parsed as unknown as Record<string, unknown>
      ) as unknown as UserSettings
      merged.notes.categoryConfigs = normalizeNoteCategoryConfigs(merged.notes.categoryConfigs)
      return merged
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.error('[AppConfig] Load failed:', error?.message || String(error))
      }
      await this.persist(DEFAULT_SETTINGS)
      const cloned = this.clone(DEFAULT_SETTINGS)
      cloned.notes.categoryConfigs = normalizeNoteCategoryConfigs(cloned.notes.categoryConfigs)
      return cloned
    }
  }

  private async persist(settings: UserSettings): Promise<void> {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    this.cache = settings
  }

  private getByPath(target: Record<string, unknown>, key: string): unknown {
    return key.split('.').reduce<unknown>((value, segment) => {
      if (value && typeof value === 'object') {
        return (value as Record<string, unknown>)[segment]
      }
      return undefined
    }, target)
  }

  private setByPath(target: Record<string, unknown>, key: string, value: unknown): void {
    const segments = key.split('.').filter(Boolean)
    let current: Record<string, unknown> = target

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      const isLeaf = index === segments.length - 1
      if (isLeaf) {
        current[segment] = value
        return
      }
      const existing = current[segment]
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        current[segment] = {}
      }
      current = current[segment] as Record<string, unknown>
    }
  }

  private deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base }

    for (const [key, value] of Object.entries(patch || {})) {
      if (value === undefined) continue
      const baseValue = result[key]
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        baseValue &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue)
      ) {
        result[key] = this.deepMerge(baseValue as Record<string, unknown>, value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }

    return result
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }
}

export const appConfigService = new AppConfigService()
