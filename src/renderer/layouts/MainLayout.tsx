import React, { useEffect, useRef, useState } from 'react'
import { Layout } from 'antd'
import { useAppStore } from '../stores/app'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import StockNoteView from '../components/StockNoteView'
import StockTimelineView from '../components/StockTimelineView'
import TimelineExplorerView from '../components/TimelineExplorerView'
import ReviewAnalysisView from '../components/ReviewAnalysisView'

const { Content } = Layout
const SIDEBAR_WIDTH_KEY = 'ui.sidebar.width'
const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 520

const MainLayout: React.FC = () => {
  const { activeModule } = useAppStore()
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
              {activeModule === 'timeline' && <StockTimelineView />}
              {activeModule === 'explorer' && <TimelineExplorerView />}
              {activeModule === 'review' && <ReviewAnalysisView />}
            </Content>
          </Layout>
        </Layout>
      </div>
    </Layout>
  )
}

export default MainLayout
