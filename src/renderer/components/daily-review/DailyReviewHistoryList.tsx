import React from 'react'
import { Button, Checkbox, Popconfirm, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { TimeEntry } from '../../../shared/types'
import type { ParsedCache } from './types'

const { Text } = Typography

interface DailyReviewHistoryListProps {
  entries: TimeEntry[]
  activeEntryId: string | null
  selectedEntryIds: string[]
  archivingEntryId: string | null
  getParsed: (entry: TimeEntry) => ParsedCache
  onToggleSelect: (entryId: string, checked: boolean) => void
  onSelectEntry: (entryId: string) => void
  onMarkRead: (entryId: string) => void
  onArchive: (entryId: string) => void
  onUnarchive: (entryId: string) => void
  onDelete: (entryId: string) => void
}

const resolveCategoryColor = (category: ParsedCache['resolvedCategory']): string => {
  if (category === '每日总结') return 'blue'
  if (category === '盘前复习') return 'green'
  if (category === '周回顾') return 'purple'
  return 'default'
}

const DailyReviewHistoryList: React.FC<DailyReviewHistoryListProps> = ({
  entries,
  activeEntryId,
  selectedEntryIds,
  archivingEntryId,
  getParsed,
  onToggleSelect,
  onSelectEntry,
  onMarkRead,
  onArchive,
  onUnarchive,
  onDelete
}) => (
  <>
    {entries.map((entry) => {
      const parsed = getParsed(entry)
      const meta = parsed.meta
      const displayCategory = parsed.resolvedCategory
      const categoryColor = resolveCategoryColor(displayCategory)

      return (
        <div
          key={entry.id}
          className={`rounded border p-3 transition-colors ${
            activeEntryId === entry.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <Space align="start">
              <Checkbox
                checked={selectedEntryIds.includes(entry.id)}
                onChange={(event) => onToggleSelect(entry.id, event.target.checked)}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="cursor-pointer" onClick={() => onSelectEntry(entry.id)}>
                <Space wrap size={[6, 6]}>
                  <Tag color={categoryColor}>{displayCategory === '其他' ? entry.category : displayCategory}</Tag>
                  {entry.trackingStatus === '已归档' ? <Tag>已归档</Tag> : null}
                  {entry.trackingStatus === '未读' ? <Tag color="processing">未读</Tag> : null}
                  {meta?.generationMode === 'local' ? <Tag>本地</Tag> : null}
                  {meta?.aiStatus === 'fallback' ? <Tag color="warning">AI失败</Tag> : null}
                </Space>
                <div className="mt-1">
                  <Text strong>{entry.title || '无标题'}</Text>
                </div>
                <div className="mt-1">
                  <Text type="secondary">{dayjs(entry.eventTime).format('YYYY-MM-DD HH:mm')}</Text>
                </div>
              </div>
            </Space>

            <Space>
              <Button size="small" type="link" onClick={() => onSelectEntry(entry.id)}>
                查看
              </Button>
              {entry.trackingStatus !== '已归档' ? (
                <CheckCircleOutlined
                  className="text-gray-400 hover:text-green-500 cursor-pointer"
                  onClick={(event) => {
                    event.stopPropagation()
                    onMarkRead(entry.id)
                  }}
                />
              ) : null}
              <Button
                size="small"
                type="link"
                loading={archivingEntryId === entry.id}
                onClick={() => {
                  if (entry.trackingStatus === '已归档') {
                    onUnarchive(entry.id)
                  } else {
                    onArchive(entry.id)
                  }
                }}
              >
                {entry.trackingStatus === '已归档' ? '取消归档' : '归档'}
              </Button>
              <Popconfirm
                title="确认删除这条复盘记录？"
                okText="删除"
                cancelText="取消"
                onConfirm={() => onDelete(entry.id)}
              >
                <DeleteOutlined
                  className="text-gray-400 hover:text-red-500 cursor-pointer"
                  onClick={(event) => event.stopPropagation()}
                />
              </Popconfirm>
            </Space>
          </div>
        </div>
      )
    })}
  </>
)

export default DailyReviewHistoryList
