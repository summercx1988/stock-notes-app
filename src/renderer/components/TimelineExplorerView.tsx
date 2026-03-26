import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Drawer, Empty, Input, Select, Space, Spin, Tag, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import MDEditor from '@uiw/react-md-editor'
import { useAppStore } from '../stores/app'
import type {
  NoteCategoryConfig,
  TimelineExplorerEvent,
  TimelineExplorerFacetOption,
  TimelineExplorerResponse,
  TrackingStatus,
  UserSettings
} from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, normalizeNoteCategoryConfigs } from '../../shared/note-categories'

const { RangePicker } = DatePicker

type FilterValue = '全部' | string

interface DayGroup {
  date: string
  items: TimelineExplorerEvent[]
}

const TRACKING_OPTIONS: TrackingStatus[] = ['关注', '已取关']
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(45, 'day').startOf('day'), dayjs().endOf('day')]

const getDirectionColor = (direction?: string) => {
  if (direction === '看多') return '#dc2626'
  if (direction === '看空') return '#15803d'
  if (direction === '震荡') return '#2563eb'
  return '#64748b'
}

const getDirectionSurface = (direction?: string) => {
  if (direction === '看多') return 'rgba(254, 226, 226, 0.95)'
  if (direction === '看空') return 'rgba(220, 252, 231, 0.95)'
  if (direction === '震荡') return 'rgba(219, 234, 254, 0.95)'
  return 'rgba(241, 245, 249, 0.95)'
}

const getTrackingTone = (status?: string) => {
  if (status === '已取关') {
    return {
      bg: 'rgba(226, 232, 240, 0.85)',
      fg: '#475569',
      border: 'rgba(148, 163, 184, 0.45)'
    }
  }
  return {
    bg: 'rgba(254, 240, 138, 0.9)',
    fg: '#854d0e',
    border: 'rgba(245, 158, 11, 0.4)'
  }
}

const createFacetCountMap = (options: TimelineExplorerFacetOption[]) => {
  const map = new Map<string, number>()
  for (const option of options) {
    map.set(option.value, option.count)
  }
  return map
}

const TimelineExplorerView: React.FC = () => {
  const { setActiveModule, setCurrentStock } = useAppStore()
  const [categoryConfigs, setCategoryConfigs] = useState<NoteCategoryConfig[]>(DEFAULT_NOTE_CATEGORY_CONFIGS)
  const [trackingFilter, setTrackingFilter] = useState<FilterValue>('全部')
  const [viewpointFilter, setViewpointFilter] = useState<FilterValue>('全部')
  const [categoryFilter, setCategoryFilter] = useState<FilterValue>('全部')
  const [operationFilter, setOperationFilter] = useState<FilterValue>('全部')
  const [stockQuery, setStockQuery] = useState('')
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(DEFAULT_RANGE)
  const [response, setResponse] = useState<TimelineExplorerResponse | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<TimelineExplorerEvent | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [trackingUpdating, setTrackingUpdating] = useState(false)

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
    let cancelled = false
    const loadData = async () => {
      setLoading(true)
      try {
        const next = await window.api.timeline.queryExplorer({
          trackingStatuses: trackingFilter === '全部' ? undefined : [trackingFilter],
          viewpointDirections: viewpointFilter === '全部' ? undefined : [viewpointFilter],
          categories: categoryFilter === '全部' ? undefined : [categoryFilter],
          operationTags: operationFilter === '全部' ? undefined : [operationFilter],
          stockQuery: deferredStockQuery.trim() || undefined,
          startDate: timeRange?.[0]?.toISOString(),
          endDate: timeRange?.[1]?.toISOString()
        })
        if (cancelled) return
        setResponse(next)
        setSelectedEvent((current) => {
          if (!current) return null
          return next.items.find((item) => item.entryId === current.entryId) || null
        })
      } catch (error: any) {
        if (!cancelled) {
          message.error(`加载全局时间轴失败: ${error.message}`)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [categoryFilter, deferredStockQuery, operationFilter, refreshToken, timeRange, trackingFilter, viewpointFilter])

  useEffect(() => {
    const unsubscribe = window.api.notes.onChanged(() => {
      startTransition(() => {
        setRefreshToken((value) => value + 1)
      })
    })
    return () => { unsubscribe() }
  }, [])

  const dayGroups = useMemo<DayGroup[]>(() => {
    const items = response?.items || []
    const groups = new Map<string, TimelineExplorerEvent[]>()
    for (const item of items) {
      const dateKey = dayjs(item.eventTime).format('YYYY-MM-DD')
      const current = groups.get(dateKey) || []
      current.push(item)
      groups.set(dateKey, current)
    }
    return [...groups.entries()].map(([date, items]) => ({ date, items }))
  }, [response?.items])

  const categoryLabelMap = useMemo(() => {
    return new Map(categoryConfigs.map((item) => [item.code, item.label]))
  }, [categoryConfigs])

  const viewpointCounts = useMemo(() => createFacetCountMap(response?.facets.viewpointDirections || []), [response?.facets.viewpointDirections])
  const trackingCounts = useMemo(() => createFacetCountMap(response?.facets.trackingStatuses || []), [response?.facets.trackingStatuses])
  const operationOptions = response?.facets.operationTags || []
  const categoryOptions = response?.facets.categories || []

  const handleSetLatestTrackingStatus = async (trackingStatus: TrackingStatus) => {
    if (!selectedEvent) return
    setTrackingUpdating(true)
    try {
      await window.api.timeline.updateLatestTrackingStatus(selectedEvent.stockCode, trackingStatus)
      message.success(`已将 ${selectedEvent.stockName || selectedEvent.stockCode} 标记为${trackingStatus}`)
      startTransition(() => {
        setRefreshToken((value) => value + 1)
      })
    } catch (error: any) {
      message.error(`更新跟踪状态失败: ${error.message}`)
    } finally {
      setTrackingUpdating(false)
    }
  }

  const handleJumpToSingleTimeline = (item: TimelineExplorerEvent) => {
    setCurrentStock(item.stockCode, item.stockName)
    setActiveModule('timeline')
  }

  return (
    <div className="h-full overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(254,240,138,0.28),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(191,219,254,0.32),_transparent_34%),linear-gradient(180deg,_#fffdf7,_#f8fafc_38%,_#f5f7fb_100%)]">
      <div className="h-full overflow-auto px-5 py-5 md:px-7">
        <div className="mx-auto max-w-[1480px]">
          <div className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Global Explorer</div>
                  <h2 className="mt-2 text-3xl font-semibold text-slate-900">事件纵览时间轴</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    默认全视角浏览全部股票事件。先按跟踪状态和观点筛出研究对象，再沿时间检查预测与普通笔记，最后在右侧抽屉里完成状态切换。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3">
                    <div className="text-xs text-amber-700">事件数</div>
                    <div className="mt-1 text-2xl font-semibold text-amber-950">{response?.totalItems || 0}</div>
                  </div>
                  <div className="rounded-2xl border border-sky-200/70 bg-sky-50/80 px-4 py-3">
                    <div className="text-xs text-sky-700">股票数</div>
                    <div className="mt-1 text-2xl font-semibold text-sky-950">{response?.totalStocks || 0}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3">
                    <div className="text-xs text-slate-500">日期带</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900">{dayGroups.length}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-white/85 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.25em] text-slate-400">主筛选</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setTrackingFilter('全部')}
                    className={`rounded-full border px-4 py-2 text-sm transition ${trackingFilter === '全部' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                  >
                    全部状态
                  </button>
                  {TRACKING_OPTIONS.map((status) => {
                    const tone = getTrackingTone(status)
                    const active = trackingFilter === status
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setTrackingFilter(status)}
                        className="rounded-full border px-4 py-2 text-sm transition"
                        style={{
                          borderColor: active ? '#0f172a' : tone.border,
                          background: active ? '#0f172a' : tone.bg,
                          color: active ? '#ffffff' : tone.fg
                        }}
                      >
                        {status} · {trackingCounts.get(status) || 0}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setViewpointFilter('全部')}
                    className={`rounded-full border px-4 py-2 text-sm transition ${viewpointFilter === '全部' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                  >
                    全部观点
                  </button>
                  {['看多', '看空', '震荡', '未知'].map((direction) => {
                    const active = viewpointFilter === direction
                    return (
                      <button
                        key={direction}
                        type="button"
                        onClick={() => setViewpointFilter(direction)}
                        className="rounded-full border px-4 py-2 text-sm transition"
                        style={{
                          borderColor: active ? getDirectionColor(direction) : 'rgba(203, 213, 225, 0.85)',
                          background: active ? getDirectionColor(direction) : getDirectionSurface(direction),
                          color: active ? '#ffffff' : getDirectionColor(direction)
                        }}
                      >
                        {direction} · {viewpointCounts.get(direction) || 0}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center">
                  <Input
                    value={stockQuery}
                    onChange={(event) => setStockQuery(event.target.value)}
                    placeholder="按股票名称或代码过滤"
                    allowClear
                    className="xl:max-w-[260px]"
                  />
                  <Select
                    value={categoryFilter}
                    onChange={(value) => setCategoryFilter(value)}
                    className="xl:max-w-[180px]"
                    options={[
                      { label: '全部类别', value: '全部' },
                      ...categoryOptions.map((option) => ({
                        label: `${categoryLabelMap.get(option.value) || option.label} · ${option.count}`,
                        value: option.value
                      }))
                    ]}
                  />
                  <Select
                    value={operationFilter}
                    onChange={(value) => setOperationFilter(value)}
                    className="xl:max-w-[180px]"
                    options={[
                      { label: '全部操作', value: '全部' },
                      ...operationOptions.map((option) => ({
                        label: `${option.label} · ${option.count}`,
                        value: option.value
                      }))
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
                    className="xl:min-w-[320px]"
                  />
                  <Space>
                    <Button
                      onClick={() => {
                        setTrackingFilter('全部')
                        setViewpointFilter('全部')
                        setCategoryFilter('全部')
                        setOperationFilter('全部')
                        setStockQuery('')
                        setTimeRange(DEFAULT_RANGE)
                      }}
                    >
                      重置筛选
                    </Button>
                    <Button onClick={() => setRefreshToken((value) => value + 1)}>刷新</Button>
                  </Space>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <Spin spinning={loading}>
              {!response || response.items.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 px-6 py-20 text-center shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
                  <Empty
                    description="当前筛选条件下暂无事件，试试切换关注状态、类别或时间范围。"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                </div>
              ) : (
                <div className="space-y-5 pb-8">
                  {dayGroups.map((group, index) => {
                    const reverse = index % 2 === 1
                    return (
                      <section
                        key={group.date}
                        className="rounded-[28px] border border-white/80 bg-white/72 p-4 shadow-[0_18px_44px_rgba(15,23,42,0.06)] backdrop-blur"
                      >
                        <div className={`flex items-center justify-between gap-4 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{dayjs(group.date).format('YYYY年MM月DD日')}</div>
                            <div className="mt-1 text-xs text-slate-500">{group.items.length} 条事件沿时间回转展开</div>
                          </div>
                          <div className="rounded-full bg-slate-900 px-3 py-1 text-xs tracking-[0.22em] text-white">
                            {reverse ? 'RETURN' : 'FORWARD'}
                          </div>
                        </div>

                        <div className="relative mt-5 overflow-x-auto pb-3">
                          <div className="absolute left-12 right-12 top-[68px] h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                          <div className={`flex min-w-max items-start gap-5 px-3 ${reverse ? 'flex-row-reverse' : ''}`}>
                            {group.items.map((item) => {
                              const currentTone = getTrackingTone(item.currentTrackingStatus)
                              const selected = selectedEvent?.entryId === item.entryId
                              return (
                                <button
                                  key={item.entryId}
                                  type="button"
                                  onClick={() => setSelectedEvent(item)}
                                  className="group text-left"
                                >
                                  <div className="flex flex-col items-center">
                                    <div
                                      className="h-5 w-5 rounded-full border-[3px] shadow-sm transition-transform group-hover:scale-110"
                                      style={{
                                        background: getDirectionSurface(item.viewpoint?.direction),
                                        borderColor: getDirectionColor(item.viewpoint?.direction)
                                      }}
                                    />
                                    <div className="h-7 w-px bg-slate-300" />
                                  </div>

                                  <div
                                    className={`w-[276px] rounded-[24px] border p-4 shadow-[0_14px_32px_rgba(15,23,42,0.08)] transition ${selected ? 'translate-y-[-2px]' : 'group-hover:translate-y-[-2px]'}`}
                                    style={{
                                      background: selected ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.88)',
                                      borderColor: selected ? 'rgba(15,23,42,0.22)' : 'rgba(226,232,240,0.92)'
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-slate-900">
                                          {item.stockName && item.stockName !== item.stockCode
                                            ? `${item.stockName}${item.stockCode}`
                                            : item.stockCode}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          {dayjs(item.eventTime).format('HH:mm')} · {item.inputType === 'voice' ? '语音' : '手动'}
                                        </div>
                                      </div>
                                      {item.isLatestForStock ? (
                                        <Tag color="gold" className="mr-0">最新</Tag>
                                      ) : null}
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <Tag color={item.category === '看盘预测' ? 'magenta' : 'blue'} className="mr-0">
                                        {categoryLabelMap.get(item.category) || item.category}
                                      </Tag>
                                      <Tag color={item.viewpoint?.direction === '看多' ? 'red' : item.viewpoint?.direction === '看空' ? 'green' : item.viewpoint?.direction === '震荡' ? 'blue' : 'default'} className="mr-0">
                                        {item.viewpoint?.direction || '未知'}
                                      </Tag>
                                      <span
                                        className="rounded-full border px-2 py-1 text-xs"
                                        style={{
                                          background: currentTone.bg,
                                          borderColor: currentTone.border,
                                          color: currentTone.fg
                                        }}
                                      >
                                        当前{item.currentTrackingStatus}
                                      </span>
                                    </div>

                                    <div className="mt-3 text-sm leading-6 text-slate-600">
                                      {item.contentPreview || item.title || '暂无摘要'}
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </section>
                    )
                  })}
                </div>
              )}
            </Spin>
          </div>
        </div>
      </div>

      <Drawer
        title={selectedEvent ? `${selectedEvent.stockName || selectedEvent.stockCode} · 事件详情` : '事件详情'}
        open={Boolean(selectedEvent)}
        width={480}
        onClose={() => setSelectedEvent(null)}
      >
        {selectedEvent ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap gap-2">
                <Tag color={selectedEvent.category === '看盘预测' ? 'magenta' : 'blue'}>
                  {categoryLabelMap.get(selectedEvent.category) || selectedEvent.category}
                </Tag>
                <Tag color={selectedEvent.viewpoint?.direction === '看多' ? 'red' : selectedEvent.viewpoint?.direction === '看空' ? 'green' : selectedEvent.viewpoint?.direction === '震荡' ? 'blue' : 'default'}>
                  {selectedEvent.viewpoint?.direction || '未知'}
                </Tag>
                <Tag>{selectedEvent.operationTag || '无'}</Tag>
                <Tag color={selectedEvent.currentTrackingStatus === '关注' ? 'gold' : 'default'}>
                  当前{selectedEvent.currentTrackingStatus}
                </Tag>
              </div>
              <div className="mt-3 text-sm leading-6 text-slate-600">
                <div>事件时间：{dayjs(selectedEvent.eventTime).format('YYYY-MM-DD HH:mm')}</div>
                <div>记录时间：{dayjs(selectedEvent.createdAt).format('YYYY-MM-DD HH:mm')}</div>
                <div>记录来源：{selectedEvent.inputType === 'voice' ? '语音' : '手动'}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">状态操作</div>
              <Space wrap>
                <Button loading={trackingUpdating} onClick={() => handleSetLatestTrackingStatus('关注')}>标记最新状态为关注</Button>
                <Button loading={trackingUpdating} onClick={() => handleSetLatestTrackingStatus('已取关')}>标记最新状态为已取关</Button>
                <Button type="primary" onClick={() => handleJumpToSingleTimeline(selectedEvent)}>打开单股时间轴</Button>
              </Space>
              <div className="mt-2 text-xs text-slate-500">
                状态切换会写入这只股票的最新一条笔记，用来控制全局纵览里的关注过滤。
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-400">笔记正文</div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <MDEditor.Markdown source={selectedEvent.content || selectedEvent.title} />
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}

export default TimelineExplorerView
