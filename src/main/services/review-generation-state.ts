import fs from 'fs/promises'
import path from 'path'
import { getDataPath } from './data-paths'
import { appLogger } from './app-logger'

export interface DailyReviewGenerationState {
  notesLastUpdatedAt: string | null
  dailySummaryLastGeneratedAt: string | null
  dailySummaryLastGeneratedFromUpdatedAt: string | null
  preMarketReminderLastTriggeredDate: string | null
}

const DEFAULT_STATE: DailyReviewGenerationState = {
  notesLastUpdatedAt: null,
  dailySummaryLastGeneratedAt: null,
  dailySummaryLastGeneratedFromUpdatedAt: null,
  preMarketReminderLastTriggeredDate: null
}

class ReviewGenerationStateService {
  private cache: DailyReviewGenerationState | null = null
  private loadPromise: Promise<DailyReviewGenerationState> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  async getState(): Promise<DailyReviewGenerationState> {
    return this.clone(await this.ensureLoaded())
  }

  async markNotesUpdated(at: Date = new Date()): Promise<DailyReviewGenerationState> {
    const state = await this.ensureLoaded()
    state.notesLastUpdatedAt = at.toISOString()
    await this.persistQueued(state)
    return this.clone(state)
  }

  async markDailySummaryGenerated(
    sourceUpdatedAt: string | null,
    generatedAt: Date = new Date()
  ): Promise<DailyReviewGenerationState> {
    const state = await this.ensureLoaded()
    state.dailySummaryLastGeneratedAt = generatedAt.toISOString()
    state.dailySummaryLastGeneratedFromUpdatedAt = sourceUpdatedAt || null
    await this.persistQueued(state)
    return this.clone(state)
  }

  async markPreMarketReminderTriggered(dateText: string): Promise<DailyReviewGenerationState> {
    const state = await this.ensureLoaded()
    state.preMarketReminderLastTriggeredDate = String(dateText || '').trim() || null
    await this.persistQueued(state)
    return this.clone(state)
  }

  hasPendingChanges(state: DailyReviewGenerationState): boolean {
    const notesUpdatedAt = this.safeTime(state.notesLastUpdatedAt)
    if (!notesUpdatedAt) return true
    const lastGeneratedFromUpdatedAt = this.safeTime(state.dailySummaryLastGeneratedFromUpdatedAt)
    if (!lastGeneratedFromUpdatedAt) return true
    return notesUpdatedAt > lastGeneratedFromUpdatedAt
  }

  private async ensureLoaded(): Promise<DailyReviewGenerationState> {
    if (this.cache) return this.cache
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this.loadFromDisk()
    const loaded = await this.loadPromise
    this.cache = loaded
    this.loadPromise = null
    return loaded
  }

  private async loadFromDisk(): Promise<DailyReviewGenerationState> {
    const filePath = this.getFilePath()
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content) as Partial<DailyReviewGenerationState>
      return {
        notesLastUpdatedAt: parsed.notesLastUpdatedAt || null,
        dailySummaryLastGeneratedAt: parsed.dailySummaryLastGeneratedAt || null,
        dailySummaryLastGeneratedFromUpdatedAt: parsed.dailySummaryLastGeneratedFromUpdatedAt || null,
        preMarketReminderLastTriggeredDate: parsed.preMarketReminderLastTriggeredDate || null
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        appLogger.warn('ReviewGenerationState', 'Failed to load state, fallback defaults', { error })
      }
      return { ...DEFAULT_STATE }
    }
  }

  private async persistQueued(state: DailyReviewGenerationState): Promise<void> {
    this.cache = state
    this.writeQueue = this.writeQueue
      .then(async () => {
        const filePath = this.getFilePath()
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
      })
      .catch((error) => {
        appLogger.error('ReviewGenerationState', 'Failed to persist state', { error })
      })
    await this.writeQueue
  }

  private getFilePath(): string {
    return getDataPath('runtime', 'review-generation-state.json')
  }

  private safeTime(value: string | null): number {
    if (!value) return 0
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
  }
}

export const reviewGenerationStateService = new ReviewGenerationStateService()
