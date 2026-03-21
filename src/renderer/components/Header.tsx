import React from 'react'
import { Button, Select, Badge, Space } from 'antd'
import { SettingOutlined, CloudOutlined, LaptopOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'
import RecordingControl from './RecordingControl'

const Header: React.FC = () => {
  const { aiMode, aiHealth, setAIMode } = useAppStore()

  return (
    <div className="h-12 px-4 flex items-center justify-between border-b border-gray-200 bg-white drag-region">
      <div className="flex items-center gap-4 no-drag">
        <h1 className="text-lg font-semibold m-0">📈 股票投资笔记</h1>

        <Select
          value={aiMode.current}
          onChange={(value) => setAIMode({ current: value, forced: true })}
          style={{ width: 120 }}
          options={[
            { value: 'local', label: '💻 本地模式' },
            { value: 'cloud', label: '☁️ 云端模式' },
            { value: 'auto', label: '🤖 智能模式' }
          ]}
        />

        <Space>
          {aiMode.current !== 'cloud' && (
            <Badge
              status={aiHealth?.local?.available ? 'success' : 'error'}
              text={<LaptopOutlined />}
            />
          )}
          {aiMode.current !== 'local' && (
            <Badge
              status={aiHealth?.cloud?.available ? 'success' : 'error'}
              text={<CloudOutlined />}
            />
          )}
        </Space>
      </div>

      <div className="flex items-center gap-2 no-drag">
        <RecordingControl />
        <Button icon={<SettingOutlined />}>
          设置
        </Button>
      </div>
    </div>
  )
}

export default Header
