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
    <Layout className="h-screen">
      <Header />
      <Layout>
        <Sider width={240} className="bg-white border-r border-gray-200">
          <Sidebar />
        </Sider>
        <Content className="overflow-hidden">
          {activeModule === 'notes' && <StockNoteView />}
          {activeModule === 'timeline' && <StockTimelineView />}
          {activeModule === 'review' && <ReviewAnalysisView />}
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
