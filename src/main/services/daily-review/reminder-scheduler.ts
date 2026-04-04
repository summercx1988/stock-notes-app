import { BrowserWindow } from 'electron'
import type { DailyReviewReminderIncludeSections, TimeEntry } from '../../../shared/types'
import type { DailyReviewService } from './index'
import { appLogger } from '../app-logger'

const CHECK_INTERVAL_MS = 30 * 1000

export class DailyReviewReminderScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastTriggeredDate: string | null = null

  constructor(private readonly dailyReviewService: DailyReviewService) {}

  start(): void {
    if (this.timer) return

    void this.checkAndNotify()
    this.timer = setInterval(() => {
      void this.checkAndNotify()
    }, CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async checkAndNotify(now: Date = new Date()): Promise<void> {
    const runtimeSettings = await this.dailyReviewService.getRuntimeSettings()
    if (!runtimeSettings.enabled || !runtimeSettings.reminder.enabled) return
    if (!this.isReminderWindow(now, runtimeSettings.reminder.time, runtimeSettings.reminder.weekdaysOnly)) {
      return
    }

    const dateText = this.toDateString(now)
    if (this.lastTriggeredDate === dateText) return

    let entry = await this.dailyReviewService.getPendingPreMarket()
    if (!entry) {
      if (!runtimeSettings.reminder.autoGeneratePreMarket) {
        return
      }
      try {
        entry = await this.dailyReviewService.generatePreMarketReview(now)
      } catch (error) {
        appLogger.warn('DailyReviewReminderScheduler', 'Failed to generate premarket review', { error })
        return
      }
    }

    if (!entry || entry.trackingStatus === '已读') return

    this.lastTriggeredDate = dateText
    this.notifyRenderer(entry, runtimeSettings.reminder.includeSections)
  }

  private notifyRenderer(entry: TimeEntry, includeSections: DailyReviewReminderIncludeSections): void {
    const payload = { entry, includeSections }
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('daily-review:reminder', payload)
    }
  }

  private isReminderWindow(now: Date, reminderTime: string, weekdaysOnly: boolean): boolean {
    const day = now.getDay()
    if (weekdaysOnly && (day === 0 || day === 6)) return false

    const minutes = now.getHours() * 60 + now.getMinutes()
    const [hourText, minuteText] = String(reminderTime || '09:00').split(':')
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const normalizedHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 9
    const normalizedMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.floor(minute))) : 0
    const target = normalizedHour * 60 + normalizedMinute
    return minutes >= target
  }

  private toDateString(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}
