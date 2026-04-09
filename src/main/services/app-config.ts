import fs from 'fs/promises'
import path from 'path'
import type { UserSettings } from '../../shared/types'
import { normalizeNoteCategoryConfigs } from '../../shared/note-categories'
import { createDefaultUserSettings } from '../../shared/default-user-settings'
import { getDataPath } from './data-paths'
import { appLogger } from './app-logger'

const getSettingsPath = (): string => getDataPath('config', 'settings.json')

const DEFAULT_SETTINGS: UserSettings = createDefaultUserSettings()
const LEGACY_CLOUD_ASR_KEY = 'cloudASR'

const stripLegacyCloudASR = (settings: Record<string, unknown>): void => {
  if (LEGACY_CLOUD_ASR_KEY in settings) {
    delete settings[LEGACY_CLOUD_ASR_KEY]
  }
}

const normalizeDefaultDirection = (value?: string): string => {
  if (!value) return '未知'
  if (value === '中性') return '震荡'
  return value
}

const toInteger = (value: unknown, fallback: number): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(n)
}

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

const normalizeReminderTime = (value: unknown, fallback: string): string => {
  const text = String(value || '').trim()
  const matched = text.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!matched) return fallback
  const hour = Math.max(0, Math.min(23, toInteger(matched[1], 9)))
  const minute = Math.max(0, Math.min(59, toInteger(matched[2], 0)))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const normalizeDailyReviewSettings = (settings: UserSettings): void => {
  const base = DEFAULT_SETTINGS.dailyReview
  const current = settings.dailyReview || base
  const includeSections = current.reminder?.includeSections || base.reminder.includeSections

  settings.dailyReview = {
    enabled: toBoolean(current.enabled, base.enabled),
    analysisLookbackDays: Math.max(1, Math.min(7, toInteger(current.analysisLookbackDays, base.analysisLookbackDays))),
    analysisMaxItems: Math.max(20, Math.min(300, toInteger(current.analysisMaxItems, base.analysisMaxItems))),
    reminder: {
      enabled: toBoolean(current.reminder?.enabled, base.reminder.enabled),
      time: normalizeReminderTime(current.reminder?.time, base.reminder.time),
      weekdaysOnly: toBoolean(current.reminder?.weekdaysOnly, base.reminder.weekdaysOnly),
      autoGeneratePreMarket: toBoolean(current.reminder?.autoGeneratePreMarket, base.reminder.autoGeneratePreMarket),
      includeSections: {
        yesterdaySummary: toBoolean(includeSections.yesterdaySummary, base.reminder.includeSections.yesterdaySummary),
        pendingItems: toBoolean(includeSections.pendingItems, base.reminder.includeSections.pendingItems),
        keyLevels: toBoolean(includeSections.keyLevels, base.reminder.includeSections.keyLevels),
        watchlist: toBoolean(includeSections.watchlist, base.reminder.includeSections.watchlist),
        riskReminders: toBoolean(includeSections.riskReminders, base.reminder.includeSections.riskReminders)
      }
    }
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
    if (key === LEGACY_CLOUD_ASR_KEY || key.startsWith(`${LEGACY_CLOUD_ASR_KEY}.`)) {
      throw new Error('云端 ASR 配置项已移除')
    }
    const settings = await this.ensureLoaded()
    this.setByPath(settings as unknown as Record<string, unknown>, key, value)
    stripLegacyCloudASR(settings as unknown as Record<string, unknown>)
    settings.notes.categoryConfigs = normalizeNoteCategoryConfigs(settings.notes.categoryConfigs)
    settings.notes.defaultDirection = normalizeDefaultDirection(settings.notes.defaultDirection)
    normalizeDailyReviewSettings(settings)
    await this.persist(settings)
    appLogger.info('AppConfig', 'Config key updated', { key })
    return this.clone(settings)
  }

  async update(partial: Partial<UserSettings>): Promise<UserSettings> {
    const settings = await this.ensureLoaded()
    const sanitizedPatch = { ...(partial as Record<string, unknown>) }
    stripLegacyCloudASR(sanitizedPatch)
    const merged = this.deepMerge(
      settings as unknown as Record<string, unknown>,
      sanitizedPatch
    ) as unknown as UserSettings
    stripLegacyCloudASR(merged as unknown as Record<string, unknown>)
    merged.notes.categoryConfigs = normalizeNoteCategoryConfigs(merged.notes.categoryConfigs)
    merged.notes.defaultDirection = normalizeDefaultDirection(merged.notes.defaultDirection)
    normalizeDailyReviewSettings(merged)
    await this.persist(merged)
    appLogger.info('AppConfig', 'Config updated by partial patch', {
      topLevelKeys: Object.keys(partial || {})
    })
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
      const content = await fs.readFile(getSettingsPath(), 'utf-8')
      const parsed = JSON.parse(content) as Record<string, unknown>
      stripLegacyCloudASR(parsed)
      const merged = this.deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        parsed
      ) as unknown as UserSettings
      stripLegacyCloudASR(merged as unknown as Record<string, unknown>)
      merged.notes.categoryConfigs = normalizeNoteCategoryConfigs(merged.notes.categoryConfigs)
      merged.notes.defaultDirection = normalizeDefaultDirection(merged.notes.defaultDirection)
      normalizeDailyReviewSettings(merged)
      appLogger.debug('AppConfig', 'Config loaded from disk')
      return merged
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.error('[AppConfig] Load failed:', error?.message || String(error))
        appLogger.warn('AppConfig', 'Failed to load config from disk, fallback to defaults', { error })
      }
      await this.persist(DEFAULT_SETTINGS)
      const cloned = this.clone(DEFAULT_SETTINGS)
      cloned.notes.categoryConfigs = normalizeNoteCategoryConfigs(cloned.notes.categoryConfigs)
      cloned.notes.defaultDirection = normalizeDefaultDirection(cloned.notes.defaultDirection)
      normalizeDailyReviewSettings(cloned)
      return cloned
    }
  }

  private async persist(settings: UserSettings): Promise<void> {
    const settingsPath = getSettingsPath()
    stripLegacyCloudASR(settings as unknown as Record<string, unknown>)
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
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
