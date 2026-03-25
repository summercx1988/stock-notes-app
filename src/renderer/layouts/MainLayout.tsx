import React from 'react'
import { Layout } from 'antd'
import { useAppStore } from '../stores/app'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import StockNoteView from '../components/StockNoteView'
import StockTimelineView from '../components/StockTimelineView'
import ReviewAnalysisView from '../components/ReviewAnalysisView'

const { Sider, Content } = Layout

const MainLayout: React.FC = () => {
  const { activeModule } = useAppStore()

  return (
    <Layout className="h-screen bg-slate-100">
      <div className="h-full p-3 md:p-4">
        <Layout className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Header />
          <Layout className="bg-transparent">
            <Sider
              width={280}
              theme="light"
              className="border-r border-slate-200 bg-slate-50/60"
            >
              <Sidebar />
            </Sider>
            <Content className="overflow-hidden bg-white">
              {activeModule === 'notes' && <StockNoteView />}
              {activeModule === 'timeline' && <StockTimelineView />}
              {activeModule === 'review' && <ReviewAnalysisView />}
            </Content>
          </Layout>
        </Layout>
      </div>
    </Layout>
  )
}

export default MainLayout
