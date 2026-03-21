import React from 'react'
import { Layout } from 'antd'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import StockNoteView from '../components/StockNoteView'

const { Sider, Content } = Layout

const MainLayout: React.FC = () => {
  return (
    <Layout className="h-screen">
      <Header />
      <Layout>
        <Sider width={240} className="bg-white border-r border-gray-200">
          <Sidebar />
        </Sider>
        <Content className="overflow-hidden">
          <StockNoteView />
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
