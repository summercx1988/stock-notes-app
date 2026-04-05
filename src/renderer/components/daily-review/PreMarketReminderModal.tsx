import React from 'react'
import { Alert, Button, Modal, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { ClockCircleOutlined } from '@ant-design/icons'
import type { DailyReviewReminderIncludeSections, TimeEntry } from '../../../shared/types'

const { Text, Paragraph } = Typography
const DEFAULT_INCLUDE_SECTIONS: DailyReviewReminderIncludeSections = {
  yesterdaySummary: true,
  pendingItems: true,
  keyLevels: true,
  watchlist: true,
  riskReminders: true
}

interface PreMarketData {
  generatedAt?: string
  sourceSummaryDate?: string
  quickReview?: {
    yesterdaySummary?: string
    pendingItems?: Array<{
      stockCode?: string
      stockName?: string
      description?: string
      priority?: string
    }>
    keyLevels?: Array<{
      stockCode?: string
      stockName?: string
      level?: string
      price?: number
      note?: string
    }>
  }
  todayStrategy?: {
    watchlist?: Array<{
      stockCode?: string
      stockName?: string
      reason?: string
      expectedAction?: string
    }>
    riskReminders?: string[]
  }
}

interface PreMarketReminderModalProps {
  open: boolean
  entry: TimeEntry | null
  includeSections: DailyReviewReminderIncludeSections
  marking: boolean
  onClose: () => void
  onMarkRead: (entryId: string) => void
  onOpenDailyReview: () => void
}

const parseData = (entry: TimeEntry | null): PreMarketData | null => {
  if (!entry) return null
  try {
    return JSON.parse(entry.content || '{}') as PreMarketData
  } catch {
    return null
  }
}

const toPriorityLabel = (priority?: string) => {
  if (priority === 'high') return { text: '高', color: 'red' }
  if (priority === 'medium') return { text: '中', color: 'orange' }
  return { text: '低', color: 'blue' }
}

const PreMarketReminderModal: React.FC<PreMarketReminderModalProps> = ({
  open,
  entry,
  includeSections,
  marking,
  onClose,
  onMarkRead,
  onOpenDailyReview
}) => {
  const data = parseData(entry)
  const safeSections: DailyReviewReminderIncludeSections = {
    ...DEFAULT_INCLUDE_SECTIONS,
    ...(includeSections || {})
  }

  return (
    <Modal
      title={
        <Space>
          <ClockCircleOutlined />
          <span>盘前复习提醒</span>
          {entry?.trackingStatus === '未读' ? <Tag color="processing">未读</Tag> : null}
        </Space>
      }
      open={open}
      width={720}
      maskClosable={false}
      onCancel={onClose}
      footer={entry ? [
        <Button key="later" onClick={onClose}>
          稍后处理
        </Button>,
        <Button key="open" onClick={onOpenDailyReview}>
          查看每日复盘
        </Button>,
        <Button
          key="read"
          type="primary"
          loading={marking}
          onClick={() => onMarkRead(entry.id)}
        >
          标记已读
        </Button>
      ] : undefined}
    >
      {entry ? (
        <Space direction="vertical" className="w-full" size="middle">
          <Alert
            type="info"
            showIcon
            message={`${dayjs(entry.eventTime).format('YYYY-MM-DD')} 盘前复习`}
            description={data?.sourceSummaryDate ? `基于 ${data.sourceSummaryDate} 的总结生成` : '基于昨日复盘数据生成'}
          />

          {safeSections.yesterdaySummary ? (
            <div>
              <Text strong>昨日概要</Text>
              <Paragraph className="mt-2 mb-0">
                {data?.quickReview?.yesterdaySummary || '暂无概要'}
              </Paragraph>
            </div>
          ) : null}

          {safeSections.pendingItems && (data?.quickReview?.pendingItems || []).length > 0 ? (
            <div>
              <Text strong>待跟进事项</Text>
              <Space direction="vertical" className="w-full mt-2">
                {(data?.quickReview?.pendingItems || []).slice(0, 5).map((item, index) => {
                  const priority = toPriorityLabel(item.priority)
                  return (
                    <div key={`${item.stockCode || 'unknown'}-${index}`} className="flex items-center gap-2">
                      <Tag color={priority.color}>{priority.text}</Tag>
                      <Text>{item.stockName || item.stockCode || '未知标的'}</Text>
                      <Text type="secondary">{item.description || '待跟进'}</Text>
                    </div>
                  )
                })}
              </Space>
            </div>
          ) : null}

          {safeSections.keyLevels && (data?.quickReview?.keyLevels || []).length > 0 ? (
            <div>
              <Text strong>关键位</Text>
              <Space direction="vertical" className="w-full mt-2">
                {(data?.quickReview?.keyLevels || []).slice(0, 5).map((item, index) => (
                  <Text key={`${item.stockCode || 'unknown'}-${index}`}>
                    {item.stockName || item.stockCode || '未知标的'} · {item.level === 'support' ? '支撑位' : item.level === 'resistance' ? '压力位' : '关键位'}
                    {typeof item.price === 'number' ? ` ${item.price}` : ''}
                    {item.note ? ` · ${item.note}` : ''}
                  </Text>
                ))}
              </Space>
            </div>
          ) : null}

          {safeSections.watchlist && (data?.todayStrategy?.watchlist || []).length > 0 ? (
            <div>
              <Text strong>观察列表</Text>
              <Space direction="vertical" className="w-full mt-2">
                {(data?.todayStrategy?.watchlist || []).slice(0, 5).map((item, index) => (
                  <Text key={`${item.stockCode || 'unknown'}-${index}`}>
                    {item.stockName || item.stockCode || '未知标的'}: {item.reason || '待观察'}
                  </Text>
                ))}
              </Space>
            </div>
          ) : null}

          {safeSections.riskReminders && (data?.todayStrategy?.riskReminders || []).length > 0 ? (
            <div>
              <Text strong>风险提醒</Text>
              <Space direction="vertical" className="w-full mt-2">
                {(data?.todayStrategy?.riskReminders || []).slice(0, 3).map((item, index) => (
                  <Text key={`${item}-${index}`}>- {item}</Text>
                ))}
              </Space>
            </div>
          ) : null}
        </Space>
      ) : (
        <Text type="secondary">暂无提醒内容</Text>
      )}
    </Modal>
  )
}

export default PreMarketReminderModal
