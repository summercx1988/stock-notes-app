import React, { useState } from 'react'
import { Button, Select, Badge, Space, Segmented, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { AppstoreOutlined, CloudOutlined, DownOutlined, LaptopOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'
import type { AppModule } from '../stores/app'
import RecordingControl from './RecordingControl'
import SettingsModal from './SettingsModal'
import DataTransferModal, { type TransferMode } from './DataTransferModal'

const Header: React.FC = () => {
  const { aiMode, aiHealth, activeModule, setAIMode, setActiveModule } = useAppStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'text-ai' | 'asr' | 'note-style' | 'watchlist'>('text-ai')
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferMode, setTransferMode] = useState<TransferMode>('export-all')

  const toolMenuItems: MenuProps['items'] = [
    {
      key: 'settings',
      label: '偏好设置'
    },
    {
      type: 'divider'
    },
    {
      key: 'data',
      label: '笔记导入导出',
      children: [
        { key: 'export-current', label: '导出当前股票' },
        { key: 'export-all', label: '导出全部笔记' },
        { key: 'import-skip', label: '导入笔记（跳过重复）' },
        { key: 'import-replace', label: '导入笔记（覆盖重复）' }
      ]
    }
  ]

  const handleToolClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'settings') {
      setSettingsTab('text-ai')
      setSettingsOpen(true)
      return
    }

    if (
      key === 'export-current' ||
      key === 'export-all' ||
      key === 'import-skip' ||
      key === 'import-replace'
    ) {
      setTransferMode(key as TransferMode)
      setTransferOpen(true)
    }
  }

  return (
    <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 bg-white/95 backdrop-blur drag-region">
      <div className="flex items-center gap-4 no-drag min-w-0">
        <h1 className="text-base md:text-lg font-semibold m-0 text-slate-800 whitespace-nowrap">📈 盯盘笔记</h1>

        <Segmented
          value={activeModule}
          onChange={(value) => setActiveModule(value as AppModule)}
          options={[
            { label: '盯盘笔记', value: 'notes' },
            { label: '事件时间轴', value: 'timeline' },
            { label: '复盘分析', value: 'review' }
          ]}
        />

        <Select
          value={aiMode.current}
          onChange={(value) => setAIMode({ current: value, forced: true })}
          style={{ width: 132 }}
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
        <Dropdown
          menu={{ items: toolMenuItems, onClick: handleToolClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button icon={<AppstoreOutlined />}>
            工具 <DownOutlined />
          </Button>
        </Dropdown>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsTab} />
      <DataTransferModal open={transferOpen} mode={transferMode} onClose={() => setTransferOpen(false)} />
    </div>
  )
}

export default Header
