import type { UserSettings } from './types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS } from './note-categories'

export const DEFAULT_TEXT_ANALYSIS_SETTINGS: UserSettings['textAnalysis'] = {
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  model: 'glm5.0',
  apiKey: ''
}

export const createDefaultUserSettings = (): UserSettings => ({
  textAnalysis: { ...DEFAULT_TEXT_ANALYSIS_SETTINGS },
  notes: {
    defaultCategory: '看盘预测',
    defaultDirection: '未知',
    defaultTimeHorizon: '短线',
    style: '轻量',
    categoryConfigs: DEFAULT_NOTE_CATEGORY_CONFIGS
  },
  dailyReview: {
    enabled: true,
    analysisLookbackDays: 3,
    analysisMaxItems: 120,
    reminder: {
      enabled: true,
      time: '09:00',
      weekdaysOnly: true,
      autoGeneratePreMarket: true,
      includeSections: {
        yesterdaySummary: true,
        pendingItems: true,
        keyLevels: true,
        watchlist: true,
        riskReminders: true
      }
    }
  },
  feishu: {
    enabled: false,
    appId: '',
    appSecret: '',
    encryptKey: '',
    verificationToken: ''
  }
})
