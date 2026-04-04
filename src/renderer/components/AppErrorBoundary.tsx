import React from 'react'
import { Alert, Button, Space, Typography } from 'antd'

const { Paragraph, Text } = Typography

interface AppErrorBoundaryState {
  hasError: boolean
  message: string
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: ''
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || '渲染异常'
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] Renderer crashed:', error, errorInfo)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Space direction="vertical" size="large" className="w-full">
            <Alert
              type="error"
              showIcon
              message="界面加载失败"
              description="已拦截本次渲染异常，避免继续显示压缩后的源码片段。"
            />
            <div>
              <Text strong>错误信息</Text>
              <Paragraph className="mt-2 mb-0">{this.state.message || '未知错误'}</Paragraph>
            </div>
            <Button type="primary" onClick={this.handleReload}>
              重新加载页面
            </Button>
          </Space>
        </div>
      </div>
    )
  }
}

export default AppErrorBoundary
