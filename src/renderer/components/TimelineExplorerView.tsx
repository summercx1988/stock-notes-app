import React, { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Drawer, Empty, Input, Segmented, Select, Space, Spin, Tag, Tooltip, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import MDEditor from '@uiw/react-md-editor'
import { MinusOutlined, PlusOutlined } from '@ant-design/icons'
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
const VIEWPOINT_OPTIONS = ['看多', '看空', '震荡', '未知']
const DEFAULT_RANGE: [Dayjs, Dayjs] = [dayjs().subtract(45, 'day').startOf('day'), dayjs().endOf('day')]
const CHART_MIN_HEIGHT = 620
const DEFAULT_ZOOM_WINDOW = { start: 0, end: 100 }
const MIN_ZOOM_SPAN = 8
const ZOOM_STEP = 12
const MARKER_LANES = [0.38, 0.56, 0.76, 0.98]

const getDirectionColor = (direction?: string) => {
  if (direction === '看多') return '#d94f4f'
  if (direction === '看空') return '#2f8f74'
  if (direction === '震荡') return '#5f8fd6'
  return '#8f97a6'
}

const getDirectionLabel = (direction?: string) => direction || '未知'

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

const formatShortTime = (value?: string) => dayjs(value).format('MM-DD HH:mm')

const hashString = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
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
  const [zoomWindow, setZoomWindow] = useState(DEFAULT_ZOOM_WINDOW)

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

  useEffect(() => {
    setZoomWindow(DEFAULT_ZOOM_WINDOW)
  }, [items.length, timeRange, trackingFilter, viewpointFilter, categoryFilter, operationFilter, deferredStockQuery])

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
    return Math.max(CHART_MIN_HEIGHT, items.length * 34)
  }, [items.length])

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

  const handleZoom = (direction: 'in' | 'out') => {
    setZoomWindow((current) => {
      const span = current.end - current.start
      const midpoint = current.start + span / 2
      const nextSpan = direction === 'in'
        ? Math.max(MIN_ZOOM_SPAN, span - ZOOM_STEP)
        : Math.min(100, span + ZOOM_STEP)
      const nextStart = Math.max(0, Math.min(100 - nextSpan, midpoint - nextSpan / 2))
      return {
        start: Number(nextStart.toFixed(2)),
        end: Number((nextStart + nextSpan).toFixed(2))
      }
    })
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
    const timelineData = items.map((item) => [0, item.entryId])

    const markerData = items.map((item, index) => {
      const statusTone = getTrackingTone(item.currentTrackingStatus)
      const direction = item.viewpoint?.direction
      const laneSeed = hashString(`${item.stockCode}:${item.category}`) % MARKER_LANES.length
      const laneBase = MARKER_LANES[laneSeed] + ((index % 2 === 0 ? 1 : -1) * 0.018)
      return {
        name: item.stockCode,
        value: [laneBase, item.entryId],
        entryId: item.entryId,
        stockCode: item.stockCode,
        stockName: item.stockName,
        eventTime: item.eventTime,
        category: item.category,
        viewpointDirection: getDirectionLabel(direction),
        operationTag: item.operationTag,
        trackingStatus: item.currentTrackingStatus,
        symbol: item.category === '看盘预测' ? 'circle' : 'roundRect',
        symbolSize: item.isLatestForStock ? 17 : 13,
        itemStyle: {
          color: getDirectionColor(direction),
          opacity: statusTone.opacity,
          shadowColor: selectedEvent?.entryId === item.entryId ? getDirectionColor(direction) : 'rgba(15,23,42,0.08)',
          shadowBlur: selectedEvent?.entryId === item.entryId ? 18 : 6,
          shadowOffsetY: selectedEvent?.entryId === item.entryId ? 0 : 2
        }
      }
    })

    return {
      animationDuration: 280,
      animationDurationUpdate: 180,
      backgroundColor: 'transparent',
      grid: {
        top: 18,
        right: 56,
        bottom: 24,
        left: 128
      },
      tooltip: {
        trigger: 'item',
        enterable: false,
        confine: true,
        borderWidth: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        extraCssText: 'box-shadow: 0 18px 48px rgba(15,23,42,0.24); border-radius: 18px; padding: 0;',
        formatter: (params: any) => {
          if (!params?.data?.entryId) return ''
          const item = eventMap.get(params.data.entryId)
          if (!item) return ''
          return `
            <div style="width: 200px; padding: 12px 14px; color: #e2e8f0;">
              <div style="font-size: 13px; font-weight: 600; color: #f8fafc; margin-bottom: 6px;">
                ${item.stockName && item.stockName !== item.stockCode ? `${item.stockName}${item.stockCode}` : item.stockCode}
              </div>
              <div style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">
                ${formatShortTime(item.eventTime)}
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
                <span style="padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 11px;">${categoryLabelMap.get(item.category) || item.category}</span>
                <span style="padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 11px;">${getDirectionLabel(item.viewpoint?.direction)}</span>
                <span style="padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 11px;">${item.currentTrackingStatus}</span>
              </div>
              <div style="font-size: 11px; line-height: 1.6; color: #94a3b8;">
                ${item.operationTag || '无操作'} · 点击查看详情
              </div>
            </div>
          `
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
      xAxis: {
        type: 'value',
        min: -0.18,
          max: 1.24,
        show: false
      },
      dataZoom: [
        {
          type: 'inside',
          yAxisIndex: 0,
          filterMode: 'none',
          start: zoomWindow.start,
          end: zoomWindow.end,
          zoomOnMouseWheel: false,
          moveOnMouseMove: true,
          moveOnMouseWheel: true
        }
      ],
      series: [
        {
          type: 'line',
          data: timelineData,
          lineStyle: {
            color: '#8f99a8',
            width: 2.4
          },
          symbol: 'none',
          silent: true,
          z: 1
        },
        {
          type: 'scatter',
          data: markerData,
          z: 3,
          emphasis: {
            scale: 1.22,
            itemStyle: {
              shadowBlur: 22,
              opacity: 1
            }
          }
        },
        {
          type: 'scatter',
          data: [
            {
              value: [0, items[0].entryId],
              symbol: 'circle',
              symbolSize: 7,
              silent: true,
              itemStyle: {
                color: '#8f99a8'
              }
            },
            {
              value: [0, items[items.length - 1].entryId],
              symbol: 'circle',
              symbolSize: 7,
              silent: true,
              itemStyle: {
                color: '#8f99a8'
              }
            }
          ],
          z: 2,
          tooltip: {
            show: false
          }
        }
      ]
    }
  }, [axisLabelMap, categoryLabelMap, eventMap, items, selectedEvent?.entryId, zoomWindow.end, zoomWindow.start])

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

    const handleDataZoom = (params: any) => {
      const batchItem = Array.isArray(params?.batch) ? params.batch[0] : params
      const nextStart = typeof batchItem?.start === 'number' ? batchItem.start : null
      const nextEnd = typeof batchItem?.end === 'number' ? batchItem.end : null
      if (nextStart === null || nextEnd === null) return
      setZoomWindow((current) => {
        if (Math.abs(current.start - nextStart) < 0.01 && Math.abs(current.end - nextEnd) < 0.01) {
          return current
        }
        return {
          start: Number(nextStart.toFixed(2)),
          end: Number(nextEnd.toFixed(2))
        }
      })
    }

    chart.off('click')
    chart.off('datazoom')
    chart.on('click', handleClick)
    chart.on('datazoom', handleDataZoom)

    if (!resizeObserverRef.current && chartHostRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        chart.resize()
      })
      resizeObserverRef.current.observe(chartHostRef.current)
    }

    return () => {
      chart.off('click', handleClick)
      chart.off('datazoom', handleDataZoom)
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
                    让时间轴回到主角位置。沿时间扫描 marker，悬停看简要观点，点击进入右侧抽屉查看完整笔记。
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
                    <span className="h-2.5 w-2.5 rounded-full bg-[#5f8fd6]" />
                    震荡
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#8f97a6]" />
                    未知
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-3 w-3 rounded-full border-2 border-[#f59e0b] bg-white" />
                    关注
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-3 w-3 rounded-full border-2 border-[#94a3b8] bg-white opacity-50" />
                    已取关
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-3 w-3 rounded-full bg-slate-900" />
                    看盘预测
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-3 w-4 rounded bg-slate-900" />
                    普通笔记
                    </span>
                  </div>

                  <Space size="small">
                    <Tooltip title="放大时间轴尺度">
                      <Button size="small" icon={<PlusOutlined />} onClick={() => handleZoom('in')} />
                    </Tooltip>
                    <Tooltip title="缩小时间轴尺度">
                      <Button size="small" icon={<MinusOutlined />} onClick={() => handleZoom('out')} />
                    </Tooltip>
                    <span className="text-[11px] text-slate-400">拖拽或滚轮都可滚动时间轴</span>
                  </Space>
                </div>

                <Spin spinning={loading}>
                  {items.length === 0 ? (
                    <div className="flex h-[420px] items-center justify-center">
                      <Empty
                        description="当前筛选条件下暂无事件，试试缩小时间范围或切换观点。"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    </div>
                  ) : (
                    <div
                      ref={chartHostRef}
                      className="w-full rounded-[18px]"
                      style={{ height: chartHeight }}
                    />
                  )}
                </Spin>
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
