import React, { useEffect, useRef, useState } from 'react'
import { Layout, message } from 'antd'
import { useAppStore } from '../stores/app'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import StockNoteView from '../components/StockNoteView'
import TimelineExplorerView from '../components/TimelineExplorerView'
import ReviewAnalysisView from '../components/ReviewAnalysisView'
import DailyReviewView from '../components/DailyReviewView'
import PreMarketReminderModal from '../components/daily-review/PreMarketReminderModal'
import type {
  DailyReviewReminderIncludeSections,
  DailyReviewReminderPayload,
  TimeEntry,
  UserSettings
} from '../../shared/types'

const { Content } = Layout
const SIDEBAR_WIDTH_KEY = 'ui.sidebar.width'
const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 520
const DEFAULT_REMINDER_SECTIONS: DailyReviewReminderIncludeSections = {
  yesterdaySummary: true,
  pendingItems: true,
  keyLevels: true,
  watchlist: true,
  riskReminders: true
}

const DEFAULT_REMINDER_CONFIG = {
  enabled: true,
  time: '09:00',
  weekdaysOnly: true,
  autoGeneratePreMarket: true
}

const normalizeReminderSections = (
  value?: Partial<DailyReviewReminderIncludeSections> | null
): DailyReviewReminderIncludeSections => ({
  yesterdaySummary: Boolean(value?.yesterdaySummary ?? DEFAULT_REMINDER_SECTIONS.yesterdaySummary),
  pendingItems: Boolean(value?.pendingItems ?? DEFAULT_REMINDER_SECTIONS.pendingItems),
  keyLevels: Boolean(value?.keyLevels ?? DEFAULT_REMINDER_SECTIONS.keyLevels),
  watchlist: Boolean(value?.watchlist ?? DEFAULT_REMINDER_SECTIONS.watchlist),
  riskReminders: Boolean(value?.riskReminders ?? DEFAULT_REMINDER_SECTIONS.riskReminders)
})

const normalizeReminderConfig = (
  value?: UserSettings['dailyReview'] | null
): {
  config: typeof DEFAULT_REMINDER_CONFIG
  sections: DailyReviewReminderIncludeSections
} => ({
  config: {
    enabled: Boolean(value?.reminder?.enabled ?? DEFAULT_REMINDER_CONFIG.enabled),
    time: String(value?.reminder?.time || DEFAULT_REMINDER_CONFIG.time),
    weekdaysOnly: Boolean(value?.reminder?.weekdaysOnly ?? DEFAULT_REMINDER_CONFIG.weekdaysOnly),
    autoGeneratePreMarket: Boolean(
      value?.reminder?.autoGeneratePreMarket ?? DEFAULT_REMINDER_CONFIG.autoGeneratePreMarket
    )
  },
  sections: normalizeReminderSections(value?.reminder?.includeSections || null)
})

const MainLayout: React.FC = () => {
  const { activeModule, setActiveModule } = useAppStore()
  const showSidebar = activeModule !== 'explorer'
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
      const parsed = raw ? Number(raw) : 280
      if (Number.isNaN(parsed)) return 280
      return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed))
    } catch {
      return 280
    }
  })
  const [resizing, setResizing] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [reminderEntry, setReminderEntry] = useState<TimeEntry | null>(null)
  const [reminderSections, setReminderSections] = useState<DailyReviewReminderIncludeSections>(DEFAULT_REMINDER_SECTIONS)
  const [reminderConfig, setReminderConfig] = useState(DEFAULT_REMINDER_CONFIG)
  const [markingReminderRead, setMarkingReminderRead] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)

  const shouldShowReminderNow = (timeText: string, weekdaysOnly: boolean) => {
    const now = new Date()
    if (weekdaysOnly) {
      const day = now.getDay()
      if (day === 0 || day === 6) return false
    }

    const [hourText, minuteText] = String(timeText || '09:00').split(':')
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const normalizedHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 9
    const normalizedMinute = Number.isFinite(minute) ? Math.max(0, Math.min(59, Math.floor(minute))) : 0
    const minutes = now.getHours() * 60 + now.getMinutes()
    return minutes >= normalizedHour * 60 + normalizedMinute
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
    } catch {
      // ignore persistence failures
    }
  }, [sidebarWidth])

  useEffect(() => {
    if (!resizing) return

    const onMouseMove = (event: MouseEvent) => {
      if (!layoutRef.current) return
      const rect = layoutRef.current.getBoundingClientRect()
      const next = event.clientX - rect.left
      const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next))
      setSidebarWidth(clamped)
    }

    const onMouseUp = () => setResizing(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [resizing])

  useEffect(() => {
    let cancelled = false
    const loadReminderConfig = async () => {
      try {
        const dailyReview = await window.api.config.get('dailyReview') as UserSettings['dailyReview'] | undefined
        if (cancelled) return
        const normalized = normalizeReminderConfig(dailyReview)
        setReminderConfig(normalized.config)
        setReminderSections(normalized.sections)
      } catch (error) {
        console.error('[MainLayout] Failed to load reminder settings:', error)
        if (cancelled) return
        setReminderConfig(DEFAULT_REMINDER_CONFIG)
        setReminderSections(DEFAULT_REMINDER_SECTIONS)
      }
    }

    void loadReminderConfig()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.dailyReview.onReminder((payload: DailyReviewReminderPayload) => {
      const entry = payload?.entry as TimeEntry | undefined
      if (!entry) return
      setReminderEntry(entry)
      setReminderSections(normalizeReminderSections(payload?.includeSections))
      setReminderOpen(true)
    })
    return () => { unsubscribe() }
  }, [])

  useEffect(() => {
    if (!reminderConfig.enabled) return
    if (!shouldShowReminderNow(reminderConfig.time, reminderConfig.weekdaysOnly)) return

    let cancelled = false
    const checkReminder = async () => {
      try {
        let pending = await window.api.dailyReview.getPending()
        if ((!pending?.success || !pending.data) && reminderConfig.autoGeneratePreMarket) {
          await window.api.dailyReview.generatePreMarket()
          pending = await window.api.dailyReview.getPending()
        }
        if (cancelled) return
        if (pending?.success && pending.data) {
          setReminderEntry(pending.data as TimeEntry)
          setReminderOpen(true)
        }
      } catch (error) {
        console.error('[MainLayout] Failed to check daily review reminder:', error)
      }
    }

    void checkReminder()
    return () => {
      cancelled = true
    }
  }, [reminderConfig.autoGeneratePreMarket, reminderConfig.enabled, reminderConfig.time, reminderConfig.weekdaysOnly])

  const handleMarkReminderRead = async (entryId: string) => {
    setMarkingReminderRead(true)
    try {
      await window.api.dailyReview.markAsRead(entryId)
      message.success('已标记为已读')
      setReminderOpen(false)
      setReminderEntry(null)
    } catch (error: any) {
      message.error(`标记失败: ${error.message}`)
    } finally {
      setMarkingReminderRead(false)
    }
  }

  return (
    <Layout className="h-screen bg-slate-100">
      <div className="h-full p-3 md:p-4">
        <Layout className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Header />
          <Layout hasSider className="bg-transparent h-full" ref={layoutRef}>
            {showSidebar ? (
              <div
                style={{ width: sidebarWidth }}
                className="h-full flex-none border-r border-slate-200 bg-slate-50/60"
              >
                <Sidebar />
              </div>
            ) : null}
            {showSidebar ? (
              <div
                className={`w-1 h-full bg-transparent hover:bg-blue-200/70 transition-colors ${resizing ? 'bg-blue-300/80' : ''}`}
                onMouseDown={() => setResizing(true)}
                title="拖拽调整侧栏宽度"
              />
            ) : null}
            <Content className="min-w-0 overflow-hidden bg-white">
              {activeModule === 'notes' && <StockNoteView />}
              {activeModule === 'explorer' && <TimelineExplorerView />}
              {activeModule === 'review' && <ReviewAnalysisView />}
              {activeModule === 'daily-review' && <DailyReviewView />}
            </Content>
          </Layout>
        </Layout>
      </div>
      <PreMarketReminderModal
        open={reminderOpen}
        entry={reminderEntry}
        includeSections={reminderSections}
        marking={markingReminderRead}
        onClose={() => setReminderOpen(false)}
        onMarkRead={handleMarkReminderRead}
        onOpenDailyReview={() => {
          setReminderOpen(false)
          setActiveModule('daily-review')
        }}
      />
    </Layout>
  )
}

export default MainLayout
