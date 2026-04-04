import React from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useAppStore } from './stores/app'
import MainLayout from './layouts/MainLayout'
import AppErrorBoundary from './components/AppErrorBoundary'
import './App.css'

const App: React.FC = () => {
  const { darkMode } = useAppStore()
  
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          borderRadius: 6,
        },
      }}
    >
      <AppErrorBoundary>
        <MainLayout />
      </AppErrorBoundary>
    </ConfigProvider>
  )
}

export default App
