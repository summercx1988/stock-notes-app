import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Calendar, Card, Empty, Input, Select, Space, Spin, Tag, Typography, message } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useAppStore } from '../stores/app'
import type { NoteCategoryConfig, TimelineExplorerEvent, TimelineExplorerResponse, UserSettings } from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, normalizeNoteCategoryConfigs } from '../../shared/note-categories'

const { Text } = Typography

const ALL_VALUE = '全部'
const QUERY_TIMEOUT_MS = 12_000

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer))
  })
}

const dayKey = (value: string | Date): string => dayjs(value).format('YYYY-MM-DD')

const compactText = (value: string, maxLength = 140): string => {
  const oneLine = String(value || '').replace(/\s+/g, ' ').trim()
  if (!oneLine) return '无内容'
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength).trim()}...` : oneLine
}

const getViewpointTagColor = (direction?: string): string => {
  if (direction === '看多') return 'red'
  if (direction === '看空') return 'green'
  if (direction === '震荡') return 'blue'
  return 'default'
}

const getOperationTagColor = (operationTag?: string): string => {
  if (operationTag === '买入') return 'red'
  if (operationTag === '卖出') return 'green'
  return 'default'
}

const getTrackingTagColor = (trackingStatus?: string): string => {
  if (trackingStatus === '关注') return 'gold'
  return 'default'
}

const TimelineExplorerView: React.FC = () => {
  const { setCurrentStock, setActiveModule } = useAppStore()
  const [categoryConfigs, setCategoryConfigs] = useState<NoteCategoryConfig[]>(DEFAULT_NOTE_CATEGORY_CONFIGS)
  const [monthAnchor, setMonthAnchor] = useState<Dayjs>(dayjs().startOf('month'))
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs())
  const [trackingFilter, setTrackingFilter] = useState(ALL_VALUE)
  const [viewpointFilter, setViewpointFilter] = useState(ALL_VALUE)
  const [categoryFilter, setCategoryFilter] = useState(ALL_VALUE)
  const [operationFilter, setOperationFilter] = useState(ALL_VALUE)
  const [stockQuery, setStockQuery] = useState('')
  const [response, setResponse] = useState<TimelineExplorerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const loadSeqRef = useRef(0)

  const deferredStockQuery = useDeferredValue(stockQuery)

  useEffect(() => {
    let cancelled = false
    const loadConfigs = async () => {
      try {
        const settings = await window.api.config.getAll() as UserSettings
        if (!cancelled) {
          setCategoryConfigs(normalizeNoteCategoryConfigs(settings?.notes?.categoryConfigs))
        }
      } catch {
        if (!cancelled) {
          setCategoryConfigs(normalizeNoteCategoryConfigs(DEFAULT_NOTE_CATEGORY_CONFIGS))
        }
      }
    }
    void loadConfigs()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedDate.isSame(monthAnchor, 'month')) return
    setSelectedDate(monthAnchor.startOf('month'))
  }, [monthAnchor, selectedDate])

  useEffect(() => {
    const requestSeq = ++loadSeqRef.current
    let cancelled = false

    const loadData = async () => {
      setLoading(true)
      try {
        const startDate = monthAnchor.startOf('month').toISOString()
        const endDate = monthAnchor.endOf('month').toISOString()
        const next = await withTimeout(
          window.api.timeline.queryExplorer({
            trackingStatuses: trackingFilter === ALL_VALUE ? undefined : [trackingFilter],
            viewpointDirections: viewpointFilter === ALL_VALUE ? undefined : [viewpointFilter],
            categories: categoryFilter === ALL_VALUE ? undefined : [categoryFilter],
            operationTags: operationFilter === ALL_VALUE ? undefined : [operationFilter],
            stockQuery: deferredStockQuery.trim() || undefined,
            startDate,
            endDate
          }),
          QUERY_TIMEOUT_MS,
          '事件日历加载超时，请稍后重试'
        )
        if (cancelled || requestSeq !== loadSeqRef.current) return
        setResponse(next)
      } catch (error: any) {
        if (!cancelled && requestSeq === loadSeqRef.current) {
          message.error(`加载事件日历失败: ${error.message}`)
        }
      } finally {
        if (!cancelled && requestSeq === loadSeqRef.current) {
          setLoading(false)
        }
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [categoryFilter, deferredStockQuery, monthAnchor, operationFilter, refreshToken, trackingFilter, viewpointFilter])

  useEffect(() => {
    const unsubscribe = window.api.notes.onChanged(() => {
      startTransition(() => {
        setRefreshToken((value) => value + 1)
      })
    })
    return () => { unsubscribe() }
  }, [])

  const categoryLabelMap = useMemo(() => {
    return new Map(categoryConfigs.map((item) => [item.code, item.label]))
  }, [categoryConfigs])

  const monthItems = useMemo(() => {
    return [...(response?.items || [])].sort((left, right) => {
      return dayjs(right.eventTime).valueOf() - dayjs(left.eventTime).valueOf()
    })
  }, [response?.items])

  const dayCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of monthItems) {
      const key = dayKey(item.eventTime)
      map.set(key, (map.get(key) || 0) + 1)
    }
    return map
  }, [monthItems])

  const selectedDayItems = useMemo(() => {
    const key = selectedDate.format('YYYY-MM-DD')
    return monthItems.filter((item) => dayKey(item.eventTime) === key)
  }, [monthItems, selectedDate])

  const monthTotal = monthItems.length
  const activeDays = dayCountMap.size

  const trackingOptions = response?.facets.trackingStatuses || []
  const viewpointOptions = response?.facets.viewpointDirections || []
  const categoryOptions = response?.facets.categories || []
  const operationOptions = response?.facets.operationTags || []

  const openStockNote = (item: TimelineExplorerEvent): void => {
    setCurrentStock(item.stockCode, item.stockName)
    setActiveModule('notes')
  }

  return (
    <div className="h-full overflow-hidden bg-[linear-gradient(180deg,#f8fafc,#f1f5f9)]">
      <div className="h-full overflow-hidden p-4">
        <div className="mx-auto flex h-full max-w-[1540px] min-h-0 flex-col gap-4">
          <Card
            size="small"
            className="border-slate-200"
            bodyStyle={{ padding: 12 }}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Daily Calendar</div>
                  <h2 className="m-0 text-xl font-semibold text-slate-900">事件日历</h2>
                  <Text type="secondary">按天查看笔记动向，点击日期查看当日明细</Text>
                </div>
                <Space wrap>
                  <Tag color="processing">本月事件 {monthTotal}</Tag>
                  <Tag>活跃天数 {activeDays}</Tag>
                  <Tag>股票数 {response?.totalStocks || 0}</Tag>
                </Space>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  size="small"
                  className="w-[160px]"
                  allowClear
                  placeholder="股票名称/代码"
                  value={stockQuery}
                  onChange={(event) => setStockQuery(event.target.value)}
                />
                <Select
                  size="small"
                  className="w-[124px]"
                  value={trackingFilter}
                  onChange={(value) => setTrackingFilter(value)}
                  options={[
                    { label: '全部状态', value: ALL_VALUE },
                    ...trackingOptions.map((option) => ({
                      label: `${option.label} ${option.count}`,
                      value: option.value
                    }))
                  ]}
                />
                <Select
                  size="small"
                  className="w-[124px]"
                  value={viewpointFilter}
                  onChange={(value) => setViewpointFilter(value)}
                  options={[
                    { label: '全部观点', value: ALL_VALUE },
                    ...viewpointOptions.map((option) => ({
                      label: `${option.label} ${option.count}`,
                      value: option.value
                    }))
                  ]}
                />
                <Select
                  size="small"
                  className="w-[140px]"
                  value={categoryFilter}
                  onChange={(value) => setCategoryFilter(value)}
                  options={[
                    { label: '全部类别', value: ALL_VALUE },
                    ...categoryOptions.map((option) => ({
                      label: `${categoryLabelMap.get(option.value) || option.label} ${option.count}`,
                      value: option.value
                    }))
                  ]}
                />
                <Select
                  size="small"
                  className="w-[118px]"
                  value={operationFilter}
                  onChange={(value) => setOperationFilter(value)}
                  options={[
                    { label: '全部操作', value: ALL_VALUE },
                    ...operationOptions.map((option) => ({
                      label: `${option.label} ${option.count}`,
                      value: option.value
                    }))
                  ]}
                />
                <Button
                  size="small"
                  onClick={() => {
                    setTrackingFilter(ALL_VALUE)
                    setViewpointFilter(ALL_VALUE)
                    setCategoryFilter(ALL_VALUE)
                    setOperationFilter(ALL_VALUE)
                    setStockQuery('')
                    setMonthAnchor(dayjs().startOf('month'))
                    setSelectedDate(dayjs())
                  }}
                >
                  重置
                </Button>
                <Button size="small" onClick={() => setRefreshToken((value) => value + 1)}>
                  刷新
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card
              title={`📅 ${monthAnchor.format('YYYY 年 MM 月')}`}
              size="small"
              className="h-full min-h-0"
              bodyStyle={{ height: 'calc(100% - 57px)', overflow: 'hidden', padding: 10 }}
            >
              <Spin spinning={loading}>
                <Calendar
                  value={selectedDate}
                  fullscreen={false}
                  onSelect={(date) => setSelectedDate(date)}
                  onPanelChange={(date) => {
                    startTransition(() => {
                      setMonthAnchor(date.startOf('month'))
                    })
                  }}
                  dateCellRender={(date) => {
                    const count = dayCountMap.get(date.format('YYYY-MM-DD')) || 0
                    if (count <= 0) return null
                    return (
                      <div className="mt-1">
                        <Badge count={count} size="small" />
                      </div>
                    )
                  }}
                />
              </Spin>
            </Card>

            <Card
              title={`🗂️ ${selectedDate.format('YYYY-MM-DD')} · ${selectedDayItems.length} 条`}
              size="small"
              className="h-full min-h-0"
              bodyStyle={{ height: 'calc(100% - 57px)', overflow: 'auto', padding: 12 }}
            >
              <Spin spinning={loading}>
                {selectedDayItems.length === 0 ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center">
                    <Empty description="该日期暂无符合筛选条件的笔记" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedDayItems.map((item) => (
                      <div key={item.entryId} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Space wrap size={[6, 6]}>
                            <Tag color="blue">{categoryLabelMap.get(item.category) || item.category}</Tag>
                            <Tag color={getViewpointTagColor(item.viewpoint?.direction)}>{item.viewpoint?.direction || '未知'}</Tag>
                            <Tag color={getOperationTagColor(item.operationTag)}>{item.operationTag || '无'}</Tag>
                            <Tag color={getTrackingTagColor(item.currentTrackingStatus)}>{item.currentTrackingStatus || '关注'}</Tag>
                          </Space>
                          <Text type="secondary">{dayjs(item.eventTime).format('HH:mm')}</Text>
                        </div>

                        <div className="mt-2">
                          <Text strong>{item.stockName || item.stockCode}</Text>
                          <Text type="secondary" className="ml-2">{item.stockCode}</Text>
                        </div>

                        <div className="mt-2 text-sm text-slate-700">
                          {compactText(item.contentPreview || item.content || item.title)}
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <Text type="secondary" className="text-xs">
                            记录时间：{dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}
                          </Text>
                          <Button size="small" type="link" onClick={() => openStockNote(item)}>
                            打开个股笔记
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Spin>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TimelineExplorerView
