import React, { useState, useEffect, useCallback } from 'react'
import { Button, Segmented, Dropdown, Switch, Badge, Tooltip, message } from 'antd'
import type { MenuProps } from 'antd'
import { AppstoreOutlined, DownOutlined, CloudSyncOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'
import type { AppModule } from '../stores/app'
import RecordingControl from './RecordingControl'
import SettingsModal from './SettingsModal'
import DataTransferModal, { type TransferMode } from './DataTransferModal'
import type { FeishuStatus } from '../../shared/types'

const Header: React.FC = () => {
  const { activeModule, setActiveModule } = useAppStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'text-ai' | 'asr' | 'category-schema' | 'watchlist' | 'daily-review' | 'feishu'>('text-ai')
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferMode, setTransferMode] = useState<TransferMode>('export-all')
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatus>({ enabled: false, connected: false })

  useEffect(() => {
    window.api.feishu.getStatus().then(setFeishuStatus)
    const unsubscribe = window.api.feishu.onStatusChanged(setFeishuStatus)
    return () => { unsubscribe() }
  }, [])

  const handleFeishuToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      const config = await window.api.config.get('feishu')
      if (!config?.appId || !config?.appSecret) {
        message.warning('请先在设置中配置飞书机器人')
        setSettingsTab('feishu')
        setSettingsOpen(true)
        return
      }
    }
    await window.api.feishu.setEnabled(checked)
    message.success(checked ? '远程录入已开启' : '远程录入已关闭')
  }, [])

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
            { label: '事件日历', value: 'explorer' },
            { label: '复盘分析', value: 'review' },
            { label: '每日复盘', value: 'daily-review' }
          ]}
        />
      </div>

      <div className="flex items-center gap-2 no-drag">
        <Tooltip title={feishuStatus.enabled ? '远程录入已开启' : '远程录入已关闭'}>
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-gray-50 hover:bg-gray-100 transition-colors">
            <Badge status={feishuStatus.connected ? 'success' : 'default'} />
            <CloudSyncOutlined className={feishuStatus.enabled ? 'text-blue-500' : 'text-gray-400'} />
            <Switch
              size="small"
              checked={feishuStatus.enabled}
              onChange={handleFeishuToggle}
            />
            <span className="text-xs text-gray-600">远程录入</span>
          </div>
        </Tooltip>
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
