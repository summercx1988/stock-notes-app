import React, { useEffect, useRef, useState } from 'react'
import { Layout, message } from 'antd'
import { useAppStore } from '../stores/app'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import StockNoteView from '../components/StockNoteView'
import TimelineExplorerView from '../components/TimelineExplorerView'
import ViewpointTrackingView from '../components/ViewpointTrackingView'
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

const normalizeReminderSections = (
  value?: Partial<DailyReviewReminderIncludeSections> | null
): DailyReviewReminderIncludeSections => ({
  yesterdaySummary: Boolean(value?.yesterdaySummary ?? DEFAULT_REMINDER_SECTIONS.yesterdaySummary),
  pendingItems: Boolean(value?.pendingItems ?? DEFAULT_REMINDER_SECTIONS.pendingItems),
  keyLevels: Boolean(value?.keyLevels ?? DEFAULT_REMINDER_SECTIONS.keyLevels),
  watchlist: Boolean(value?.watchlist ?? DEFAULT_REMINDER_SECTIONS.watchlist),
  riskReminders: Boolean(value?.riskReminders ?? DEFAULT_REMINDER_SECTIONS.riskReminders)
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
  const [markingReminderRead, setMarkingReminderRead] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)

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
        setReminderSections(normalizeReminderSections(dailyReview?.reminder?.includeSections || null))
      } catch (error) {
        console.error('[MainLayout] Failed to load reminder settings:', error)
        if (cancelled) return
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
              {activeModule === 'viewpoint-tracking' && <ViewpointTrackingView />}
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
