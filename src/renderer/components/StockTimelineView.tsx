import React, { useEffect, useMemo, useState } from 'react'
import { Card, DatePicker, Empty, Select, Space, Spin, Tag, Timeline, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { NoteCategory, TimeEntry, Viewpoint } from '../../shared/types'

const { RangePicker } = DatePicker
const { Text } = Typography

type ViewpointFilter = '全部' | Viewpoint['direction']
type CategoryFilter = '全部' | NoteCategory

const StockTimelineView: React.FC = () => {
  const {
    currentStockCode,
    currentStockName,
    stockNotes,
    setStockNote,
    loading,
    setLoading
  } = useAppStore()

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [viewpointFilter, setViewpointFilter] = useState<ViewpointFilter>('全部')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('全部')
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null)

  useEffect(() => {
    if (!currentStockCode) {
      setEntries([])
      return
    }
    const note = stockNotes.get(currentStockCode)
    setEntries(note?.entries || [])
  }, [currentStockCode, stockNotes])

  useEffect(() => {
    if (!currentStockCode || stockNotes.get(currentStockCode)) return

    let cancelled = false
    const loadNote = async () => {
      setLoading(true)
      try {
        const note = await window.api.notes.getStockNote(currentStockCode)
        if (!cancelled && note) {
          setStockNote(currentStockCode, note)
        }
      } catch (error: any) {
        if (!cancelled) {
          message.error(`加载时间轴失败: ${error.message}`)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadNote()
    return () => {
      cancelled = true
    }
  }, [currentStockCode, setLoading, setStockNote, stockNotes])

  const filteredEntries = useMemo(() => {
    return [...entries]
      .filter((entry) => {
        if (viewpointFilter !== '全部') {
          const direction = entry.viewpoint?.direction || '未知'
          if (direction !== viewpointFilter) return false
        }

        if (categoryFilter !== '全部' && entry.category !== categoryFilter) {
          return false
        }

        if (timeRange) {
          const eventTime = dayjs(entry.eventTime || entry.timestamp)
          if (eventTime.isBefore(timeRange[0]) || eventTime.isAfter(timeRange[1])) return false
        }

        return true
      })
      .sort((a, b) => {
        const left = new Date(a.eventTime || a.timestamp).getTime()
        const right = new Date(b.eventTime || b.timestamp).getTime()
        return right - left
      })
  }, [categoryFilter, entries, timeRange, viewpointFilter])

  const getViewpointColor = (direction?: Viewpoint['direction']) => {
    if (direction === '看多') return 'red'
    if (direction === '看空') return 'green'
    if (direction === '中性') return 'blue'
    return 'default'
  }

  const getNodeColor = (direction?: Viewpoint['direction']) => {
    if (direction === '看多') return '#ef4444'
    if (direction === '看空') return '#22c55e'
    if (direction === '中性') return '#3b82f6'
    return '#9ca3af'
  }

  const getCategoryColor = (category: NoteCategory) => {
    if (category === '看盘预测') return 'magenta'
    if (category === '交易札记') return 'gold'
    if (category === '资讯备忘') return 'cyan'
    return 'default'
  }

  const formatMinuteTime = (value?: Date | string) => {
    const date = dayjs(value)
    return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '-'
  }

  const summarizeContent = (content: string) => {
    const oneLine = content.replace(/\s+/g, ' ').trim()
    return oneLine.length > 120 ? `${oneLine.slice(0, 120)}...` : oneLine
  }

  const stockDisplayName = currentStockName && currentStockName !== currentStockCode
    ? `${currentStockName}+${currentStockCode}`
    : currentStockCode

  if (!currentStockCode) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <Empty
          description={
            <div className="text-center">
              <p className="text-lg mb-2">先从左侧选择一只股票</p>
              <p className="text-gray-400 text-sm">时间轴会展示该股票全部笔记事件</p>
            </div>
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold m-0">
            {stockDisplayName} 事件时间轴
          </h2>
          <Tag color="blue">{currentStockCode}</Tag>
        </div>
        <Space wrap>
          <Select
            value={categoryFilter}
            style={{ width: 140 }}
            onChange={(value) => setCategoryFilter(value as CategoryFilter)}
            options={[
              { label: '全部类别', value: '全部' },
              { label: '看盘预测', value: '看盘预测' },
              { label: '交易札记', value: '交易札记' },
              { label: '备忘', value: '备忘' },
              { label: '资讯备忘', value: '资讯备忘' }
            ]}
          />
          <Select
            value={viewpointFilter}
            style={{ width: 120 }}
            onChange={(value) => setViewpointFilter(value as ViewpointFilter)}
            options={[
              { label: '全部观点', value: '全部' },
              { label: '看多', value: '看多' },
              { label: '看空', value: '看空' },
              { label: '中性', value: '中性' },
              { label: '未知', value: '未知' }
            ]}
          />
          <RangePicker
            value={timeRange}
            onChange={(value) => {
              if (!value || !value[0] || !value[1]) {
                setTimeRange(null)
                return
              }
              setTimeRange([value[0], value[1]])
            }}
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            placeholder={['开始时间', '结束时间']}
          />
        </Space>
      </div>

      <Spin spinning={loading}>
        <div className="flex-1 overflow-auto p-4">
          {filteredEntries.length === 0 ? (
            <Empty description="当前筛选条件下暂无事件" />
          ) : (
            <Timeline
              items={filteredEntries.map((entry) => ({
                color: getNodeColor(entry.viewpoint?.direction),
                children: (
                  <Card size="small" bordered className="mb-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Tag color={getCategoryColor(entry.category)}>{entry.category}</Tag>
                        <Tag color={getViewpointColor(entry.viewpoint?.direction)}>
                          {entry.viewpoint?.direction || '未知'}
                        </Tag>
                        <Tag>{entry.inputType === 'voice' ? '语音' : '手动'}</Tag>
                      </div>
                      <Text type="secondary">{formatMinuteTime(entry.eventTime || entry.timestamp)}</Text>
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">
                      <Text strong>{entry.title}</Text>
                      <div className="mt-2">{summarizeContent(entry.content)}</div>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      记录时间：{formatMinuteTime(entry.createdAt)}
                    </div>
                  </Card>
                )
              }))}
            />
          )}
        </div>
      </Spin>
    </div>
  )
}

export default StockTimelineView
