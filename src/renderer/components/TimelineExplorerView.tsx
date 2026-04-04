import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Drawer, Empty, Input, Segmented, Select, Space, Tag, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
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

const TRACKING_OPTIONS: TrackingStatus[] = ['关注', '已取关']
const VIEWPOINT_OPTIONS = ['看多', '看空', '未知', '震荡']
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(45, 'day').startOf('day'), dayjs().endOf('day')]
const CHART_MIN_HEIGHT = 520
const CHART_MAX_VIEWPORT_HEIGHT = 760
const CHART_MIN_WIDTH = 980
const COLUMN_WIDTH = 120
const ROW_HEIGHT = 40
const RECENT_ACTIVITY_DAYS = 14
const VIEWPOINT_COLUMN_ORDER = ['看多', '看空', '未知', '震荡']
const VIEWPOINT_SET = new Set(VIEWPOINT_COLUMN_ORDER)
const QUERY_TIMEOUT_MS = 15_000
const UPDATE_TIMEOUT_MS = 10_000

const getDirectionColor = (direction?: string) => {
  if (direction === '看多') return '#d94f4f'
  if (direction === '看空') return '#2f8f74'
  if (direction === '震荡') return '#5f8fd6'
  return '#8f97a6'
}

const getDirectionSurfaceColor = (direction?: string) => {
  if (direction === '看多') return 'rgba(217, 79, 79, 0.15)'
  if (direction === '看空') return 'rgba(47, 143, 116, 0.16)'
  if (direction === '震荡') return 'rgba(95, 143, 214, 0.16)'
  return 'rgba(143, 151, 166, 0.16)'
}

const getDirectionLabel = (direction?: string) => (direction && VIEWPOINT_SET.has(direction) ? direction : '未知')

const getTrackingTone = (status?: string) => {
  if (status === '已取关') {
    return {
      tag: 'default' as const,
      border: '#94a3b8',
      opacity: 0.42
    }
  }
  return {
    tag: 'gold' as const,
    border: '#f59e0b',
    opacity: 0.96
  }
}

const createFacetCountMap = (options: TimelineExplorerFacetOption[]) => {
  const map = new Map<string, number>()
  for (const option of options) {
    map.set(option.value, option.count)
  }
  return map
}

const getRecentVisualScale = (recentCount: number, isLatestForStock: boolean) => {
  let scale = 1
  if (recentCount >= 6) {
    scale = 1.3
  } else if (recentCount >= 4) {
    scale = 1.18
  } else if (recentCount >= 2) {
    scale = 1.08
  }
  return isLatestForStock ? scale + 0.04 : scale
}

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

const TimelineExplorerView: React.FC = () => {
  const { setActiveModule, setCurrentStock } = useAppStore()
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.EChartsType | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

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
        const next = await withTimeout(
          window.api.timeline.queryExplorer({
            trackingStatuses: trackingFilter === '全部' ? undefined : [trackingFilter],
            viewpointDirections: viewpointFilter === '全部' ? undefined : [viewpointFilter],
            categories: categoryFilter === '全部' ? undefined : [categoryFilter],
            operationTags: operationFilter === '全部' ? undefined : [operationFilter],
            stockQuery: deferredStockQuery.trim() || undefined,
            startDate: timeRange?.[0]?.toISOString(),
            endDate: timeRange?.[1]?.toISOString()
          }),
          QUERY_TIMEOUT_MS,
          '事件纵览刷新超时，请稍后重试'
        )
        if (cancelled) return
        setResponse(next)
        setSelectedEvent((current) => {
          if (!current) return null
          return next.items.find((item) => item.entryId === current.entryId) || null
        })
      } catch (error: any) {
        if (!cancelled) {
          message.error(`加载事件纵览失败: ${error.message}`)
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

  const items = useMemo(() => {
    return [...(response?.items || [])].sort((left, right) => {
      return dayjs(right.eventTime).valueOf() - dayjs(left.eventTime).valueOf()
    })
  }, [response?.items])

  const eventMap = useMemo(() => {
    return new Map(items.map((item) => [item.entryId, item]))
  }, [items])

  const axisLabelMap = useMemo(() => {
    const map = new Map<string, { dateText: string; timeText: string; showDate: boolean }>()
    let previousDate = ''
    for (const item of items) {
      const currentDate = dayjs(item.eventTime).format('MM-DD')
      map.set(item.entryId, {
        dateText: currentDate,
        timeText: dayjs(item.eventTime).format('HH:mm'),
        showDate: currentDate !== previousDate
      })
      previousDate = currentDate
    }
    return map
  }, [items])

  const categoryLabelMap = useMemo(() => {
    return new Map(categoryConfigs.map((item) => [item.code, item.label]))
  }, [categoryConfigs])

  const viewpointCounts = useMemo(() => createFacetCountMap(response?.facets.viewpointDirections || []), [response?.facets.viewpointDirections])
  const trackingCounts = useMemo(() => createFacetCountMap(response?.facets.trackingStatuses || []), [response?.facets.trackingStatuses])
  const operationOptions = response?.facets.operationTags || []
  const categoryOptions = response?.facets.categories || []

  const trackingSegmentOptions = useMemo(() => {
    return [
      { label: '全部状态', value: '全部' },
      ...TRACKING_OPTIONS.map((status) => ({
        label: `${status} ${trackingCounts.get(status) || 0}`,
        value: status
      }))
    ]
  }, [trackingCounts])

  const viewpointSegmentOptions = useMemo(() => {
    return [
      { label: '全部观点', value: '全部' },
      ...VIEWPOINT_OPTIONS.map((direction) => ({
        label: `${direction} ${viewpointCounts.get(direction) || 0}`,
        value: direction
      }))
    ]
  }, [viewpointCounts])

  const metrics = useMemo(() => {
    const bullish = items.filter((item) => item.viewpoint?.direction === '看多').length
    const bearish = items.filter((item) => item.viewpoint?.direction === '看空').length
    const ranging = items.filter((item) => item.viewpoint?.direction === '震荡').length
    const activeStocks = new Set(
      items
        .filter((item) => item.currentTrackingStatus === '关注')
        .map((item) => item.stockCode)
    ).size

    return {
      activeStocks,
      bullish,
      bearish,
      ranging
    }
  }, [items])

  const chartHeight = useMemo(() => {
    return Math.max(CHART_MIN_HEIGHT, items.length * ROW_HEIGHT + 80)
  }, [items.length])

  const explorerColumns = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const direction = getDirectionLabel(item.viewpoint?.direction)
      const key = direction
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    return VIEWPOINT_COLUMN_ORDER.map((viewpoint) => {
      const key = viewpoint
      return {
        key,
        viewpoint,
        itemCount: counts.get(key) || 0
      }
    })
  }, [items])

  const columnMap = useMemo(() => {
    return new Map(explorerColumns.map((column) => [column.key, column]))
  }, [explorerColumns])

  const chartWidth = useMemo(() => {
    return Math.max(CHART_MIN_WIDTH, explorerColumns.length * COLUMN_WIDTH + 220)
  }, [explorerColumns.length])

  const recentActivity = useMemo(() => {
    const counts = new Map<string, number>()
    const visibleEnd = timeRange?.[1] || (items[0] ? dayjs(items[0].eventTime) : dayjs())
    const cutoff = visibleEnd.subtract(RECENT_ACTIVITY_DAYS, 'day').startOf('day')

    for (const item of items) {
      const eventTime = dayjs(item.eventTime)
      if (eventTime.isBefore(cutoff) || eventTime.isAfter(visibleEnd)) continue
      counts.set(item.stockCode, (counts.get(item.stockCode) || 0) + 1)
    }

    return {
      counts,
      label: `近${RECENT_ACTIVITY_DAYS}天`
    }
  }, [items, timeRange])

  const handleSetLatestTrackingStatus = async (trackingStatus: TrackingStatus) => {
    if (!selectedEvent) return
    setTrackingUpdating(true)
    try {
      await withTimeout(
        window.api.timeline.updateLatestTrackingStatus(selectedEvent.stockCode, trackingStatus),
        UPDATE_TIMEOUT_MS,
        '状态更新超时，请重试'
      )
      message.success(`已将 ${selectedEvent.stockName || selectedEvent.stockCode} 标记为${trackingStatus}`)
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

  const chartOption = useMemo<EChartsOption>(() => {
    if (items.length === 0) {
      return {
        animation: false,
        title: {
          text: '暂无事件',
          left: 'center',
          top: 'middle',
          textStyle: {
            color: '#94a3b8',
            fontSize: 16,
            fontWeight: 500
          }
        }
      }
    }

    const rowIds = items.map((item) => item.entryId)
    const columnKeys = explorerColumns.map((column) => column.key)
    const markerData = items.map((item) => {
      const statusTone = getTrackingTone(item.currentTrackingStatus)
      const direction = getDirectionLabel(item.viewpoint?.direction)
      const recentCount = recentActivity.counts.get(item.stockCode) || 0
      const visualScale = getRecentVisualScale(recentCount, item.isLatestForStock)
      const labelText = item.stockName || item.stockCode
      const symbolWidth = Math.round(Math.min(180, Math.max(74, (labelText.length * 14) + 26)) * visualScale)
      const symbolHeight = Math.round(24 * visualScale)
      return {
        name: item.stockCode,
        value: [direction, item.entryId],
        entryId: item.entryId,
        stockCode: item.stockCode,
        stockName: item.stockName,
        labelText,
        labelFontSize: Math.max(11, Math.min(15, Math.round(11 * visualScale))),
        eventTime: item.eventTime,
        category: item.category,
        viewpointDirection: direction,
        operationTag: item.operationTag,
        trackingStatus: item.currentTrackingStatus,
        recentCount,
        symbol: 'roundRect',
        symbolSize: [symbolWidth, symbolHeight],
        itemStyle: {
          color: getDirectionSurfaceColor(direction),
          borderColor: statusTone.border,
          borderWidth: item.currentTrackingStatus === '关注' ? 2 : 1.2,
          opacity: item.currentTrackingStatus === '关注' ? statusTone.opacity : 0.66,
          shadowColor: selectedEvent?.entryId === item.entryId ? getDirectionColor(direction) : 'rgba(15,23,42,0.08)',
          shadowBlur: selectedEvent?.entryId === item.entryId ? 18 : 6,
          shadowOffsetY: selectedEvent?.entryId === item.entryId ? 0 : 2
        },
        label: {
          show: true,
          formatter: labelText,
          color: getDirectionColor(direction),
          fontWeight: 600,
          fontSize: Math.max(11, Math.min(15, Math.round(11 * visualScale))),
          width: Math.min(148, symbolWidth - 18),
          overflow: 'truncate' as const
        }
      }
    })

    return {
      animationDuration: 280,
      animationDurationUpdate: 180,
      backgroundColor: 'transparent',
      grid: {
        top: 88,
        right: 32,
        bottom: 24,
        left: 128
      },
      tooltip: {
        show: false
      },
      xAxis: {
        type: 'category',
        position: 'top',
        data: columnKeys,
        axisTick: {
          show: false
        },
        axisLine: {
          lineStyle: {
            color: '#cbd5e1'
          }
        },
        axisLabel: {
          interval: 0,
          margin: 18,
          formatter: (value: string) => {
            const column = columnMap.get(value)
            if (!column) return ''
            return `{view|${column.viewpoint}}`
          },
          rich: {
            view: {
              fontSize: 11,
              fontWeight: 600,
              color: '#94a3b8',
              lineHeight: 16,
              align: 'center'
            }
          }
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(203, 213, 225, 0.34)'
          }
        }
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rowIds,
        axisLine: {
          show: true,
          lineStyle: {
            color: '#8f99a8',
            width: 1.5
          }
        },
        axisTick: {
          show: true,
          lineStyle: {
            color: '#c8d0da'
          }
        },
        axisLabel: {
          color: '#6b7280',
          fontSize: 11,
          margin: 18,
          formatter: (value: string) => {
            const label = axisLabelMap.get(value)
            if (!label) return ''
            if (label.showDate) {
              return `{date|${label.dateText}}\n{time|${label.timeText}}`
            }
            return `{timeOnly|${label.timeText}}`
          },
          rich: {
            date: {
              fontSize: 11,
              fontWeight: 600,
              color: '#667085',
              lineHeight: 16
            },
            time: {
              fontSize: 10,
              color: '#9aa4b2',
              lineHeight: 14
            },
            timeOnly: {
              fontSize: 10,
              color: '#9aa4b2',
              lineHeight: 28
            }
          }
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(203, 213, 225, 0.26)',
            type: 'dashed'
          }
        }
      },
      series: [
        {
          type: 'scatter',
          data: markerData,
          z: 3,
          symbolSize: (_value: unknown, params: any) => params?.data?.symbolSize || [80, 24],
          cursor: 'pointer',
          emphasis: {
            scale: 1.12,
            itemStyle: {
              shadowBlur: 22,
              opacity: 1
            }
          }
        }
      ]
    }
  }, [axisLabelMap, columnMap, explorerColumns, items, recentActivity, selectedEvent?.entryId])

  useEffect(() => {
    if (!chartHostRef.current) return

    if (!chartRef.current) {
      chartRef.current = echarts.init(chartHostRef.current, undefined, {
        renderer: 'canvas'
      })
    }

    const chart = chartRef.current
    chart.setOption(chartOption, true)

    const handleClick = (params: any) => {
      const entryId = params?.data?.entryId
      if (!entryId) return
      const item = eventMap.get(entryId)
      if (item) {
        setSelectedEvent(item)
      }
    }

    chart.off('click')
    chart.on('click', handleClick)

    if (!resizeObserverRef.current && chartHostRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        chart.resize()
      })
      resizeObserverRef.current.observe(chartHostRef.current)
    }

    return () => {
      chart.off('click', handleClick)
    }
  }, [chartOption, eventMap])

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect()
      chartRef.current?.dispose()
      resizeObserverRef.current = null
      chartRef.current = null
    }
  }, [])

  const isInitialLoading = loading && !response

  return (
    <div className="h-full overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(254,240,138,0.2),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(191,219,254,0.22),_transparent_34%),linear-gradient(180deg,_#fffdf8,_#f8fafc_42%,_#f3f6fb_100%)]">
      <div className="h-full overflow-auto px-4 py-4 md:px-6">
        <div className="mx-auto max-w-[1540px]">
          <div className="rounded-[28px] border border-white/75 bg-white/80 p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Global Explorer</div>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-900">事件纵览时间轴</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    横向按观点分列，纵向按时间展开事件。点越大，代表这只股票在 {recentActivity.label} 的记录越密集。
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Tag color="gold">关注股票 {metrics.activeStocks}</Tag>
                  <Tag color="red">看多 {metrics.bullish}</Tag>
                  <Tag color="green">看空 {metrics.bearish}</Tag>
                  <Tag color="blue">震荡 {metrics.ranging}</Tag>
                  <Tag>事件 {response?.totalItems || 0}</Tag>
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/85 bg-white/85 px-3 py-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <Segmented
                      size="small"
                      value={trackingFilter}
                      onChange={(value) => setTrackingFilter(String(value))}
                      options={trackingSegmentOptions}
                    />
                    <Segmented
                      size="small"
                      value={viewpointFilter}
                      onChange={(value) => setViewpointFilter(String(value))}
                      options={viewpointSegmentOptions}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      size="small"
                      value={stockQuery}
                      onChange={(event) => setStockQuery(event.target.value)}
                      placeholder="股票名称/代码"
                      allowClear
                      className="w-[150px]"
                    />
                    <Select
                      size="small"
                      value={categoryFilter}
                      onChange={(value) => setCategoryFilter(value)}
                      className="w-[128px]"
                      options={[
                        { label: '全部类别', value: '全部' },
                        ...categoryOptions.map((option) => ({
                          label: `${categoryLabelMap.get(option.value) || option.label} ${option.count}`,
                          value: option.value
                        }))
                      ]}
                    />
                    <Select
                      size="small"
                      value={operationFilter}
                      onChange={(value) => setOperationFilter(value)}
                      className="w-[122px]"
                      options={[
                        { label: '全部操作', value: '全部' },
                        ...operationOptions.map((option) => ({
                          label: `${option.label} ${option.count}`,
                          value: option.value
                        }))
                      ]}
                    />
                    <RangePicker
                      size="small"
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
                    />
                    <Button
                      size="small"
                      onClick={() => {
                        setTrackingFilter('全部')
                        setViewpointFilter('全部')
                        setCategoryFilter('全部')
                        setOperationFilter('全部')
                        setStockQuery('')
                        setTimeRange(DEFAULT_RANGE)
                      }}
                    >
                      重置
                    </Button>
                    <Button size="small" onClick={() => setRefreshToken((value) => value + 1)}>
                      刷新
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.92))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#d94f4f]" />
                      看多
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#2f8f74]" />
                      看空
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#8f97a6]" />
                      未知
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#5f8fd6]" />
                      震荡
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                      <span className="h-3 w-3 rounded-full border-2 border-[#f59e0b] bg-white" />
                      关注
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                      <span className="h-3 w-3 rounded-full border-2 border-[#94a3b8] bg-white opacity-50" />
                      已取关
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400">
                    直接展示股票名，颜色表示观点，点击名称打开右侧详情。
                  </div>
                </div>

                {isInitialLoading ? (
                  <div className="flex h-[420px] items-center justify-center text-sm text-slate-500">
                    正在加载事件纵览...
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex h-[420px] items-center justify-center">
                    <Empty
                      description="当前筛选条件下暂无事件，试试缩小时间范围或切换观点。"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  </div>
                ) : (
                  <div
                    className="overflow-auto rounded-[18px] border border-slate-200/70 bg-white/70"
                    style={{ maxHeight: CHART_MAX_VIEWPORT_HEIGHT }}
                  >
                    <div
                      ref={chartHostRef}
                      className="rounded-[18px]"
                      style={{ width: chartWidth, height: chartHeight }}
                    />
                  </div>
                )}
                {loading && !isInitialLoading ? (
                  <div className="mt-2 text-[11px] text-slate-400">
                    刷新中...
                  </div>
                ) : null}
              </div>
            </div>
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
