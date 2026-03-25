import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionType, dispose, init, type Chart, type KLineData } from 'klinecharts'
import { Alert, Button, DatePicker, Empty, Input, Modal, Select, Space, Tag, Tooltip, message } from 'antd'
import { InfoCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { KlineInterval, ReviewMarkerDirection, ReviewScope, ReviewVisualResponse } from '../../../shared/types'

interface ReviewKlineWorkbenchProps {
  scope: ReviewScope
  stockCode?: string
  stockName?: string
  startDate?: string
  endDate?: string
  selectedEntryId?: string | null
  onMarkerSelect?: (entryId: string) => void
  onNoteSaved?: () => void
}

interface HoverCandleInfo {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  clusterCount: number
}

interface MarkerLayout {
  candleTime: string
  direction: ReviewMarkerDirection
  count: number
  entryIds: string[]
  x: number
  y: number
}

const INTERVAL_OPTIONS: Array<{ label: string; value: KlineInterval }> = [
  { label: '5 分钟', value: '5m' },
  { label: '15 分钟', value: '15m' },
  { label: '30 分钟', value: '30m' },
  { label: '日K', value: '1d' }
]

const DIRECTION_OPTIONS: Array<{ label: string; value: ReviewMarkerDirection }> = [
  { label: '看多', value: '看多' },
  { label: '看空', value: '看空' },
  { label: '中性', value: '中性' },
  { label: '未知', value: '未知' }
]

const MARKER_BG_BY_DIRECTION: Record<ReviewMarkerDirection, string> = {
  看多: '#ef4444',
  看空: '#22c55e',
  中性: '#64748b',
  未知: '#94a3b8'
}

const CHART_HEIGHT = 420

const toMs = (input?: string | number | null): number | null => {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null
  }
  if (!input) return null
  const ms = new Date(input).getTime()
  return Number.isFinite(ms) ? ms : null
}

const resolveDirectionFromCluster = (input: { bullish: number; bearish: number; neutral: number; unknown: number }): ReviewMarkerDirection => {
  const pairs: Array<{ direction: ReviewMarkerDirection; count: number }> = [
    { direction: '看多', count: input.bullish },
    { direction: '看空', count: input.bearish },
    { direction: '中性', count: input.neutral },
    { direction: '未知', count: input.unknown }
  ]
  return pairs.sort((left, right) => right.count - left.count)[0]?.direction || '未知'
}

const extractEventTimestamp = (payload: any): number | null => {
  const candidates = [
    payload?.timestamp,
    payload?.kLineData?.timestamp,
    payload?.data?.timestamp,
    payload?.data?.kLineData?.timestamp
  ]
  for (const candidate of candidates) {
    const value = toMs(candidate)
    if (value !== null) return value
  }
  return null
}

const ReviewKlineWorkbench: React.FC<ReviewKlineWorkbenchProps> = ({
  scope,
  stockCode,
  stockName,
  startDate,
  endDate,
  selectedEntryId = null,
  onMarkerSelect,
  onNoteSaved
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const chartHostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<Chart | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const rafRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const cacheRef = useRef(new Map<string, ReviewVisualResponse>())
  const clustersRef = useRef<ReviewVisualResponse['clusters']>([])

  const [interval, setInterval] = useState<KlineInterval>('5m')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<ReviewVisualResponse | null>(null)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [hoverInfo, setHoverInfo] = useState<HoverCandleInfo | null>(null)
  const [anchorTimestamp, setAnchorTimestamp] = useState<number | null>(null)
  const [activeClusterTime, setActiveClusterTime] = useState<string | null>(null)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteContent, setNoteContent] = useState('')
  const [noteDirection, setNoteDirection] = useState<ReviewMarkerDirection>('未知')
  const [noteEventTime, setNoteEventTime] = useState<Dayjs | null>(null)
  const [savingNote, setSavingNote] = useState(false)

  const canAddNote = scope === 'single' && Boolean(stockCode)
  const resolvedStockLabel = scope === 'single'
    ? (stockName && stockName !== stockCode ? `${stockName}${stockCode}` : (stockCode || '未选择股票'))
    : '全股票综合（基准图）'

  const queryKey = useMemo(() => JSON.stringify({
    scope,
    stockCode: scope === 'single' ? stockCode || null : null,
    startDate: startDate || null,
    endDate: endDate || null,
    interval
  }), [scope, stockCode, startDate, endDate, interval])

  const scheduleRelayout = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = requestAnimationFrame(() => {
      setLayoutVersion((value) => value + 1)
    })
  }, [])

  const loadVisualData = useCallback(async (force = false) => {
    if (scope === 'single' && !stockCode) {
      setData(null)
      setHoverInfo(null)
      setErrorMessage(null)
      return
    }

    if (!force && cacheRef.current.has(queryKey)) {
      setData(cacheRef.current.get(queryKey) || null)
      setErrorMessage(null)
      scheduleRelayout()
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setErrorMessage(null)

    try {
      const response = await window.api.review.getVisualData({
        scope,
        stockCode: scope === 'single' ? stockCode || undefined : undefined,
        startDate,
        endDate,
        interval
      })
      if (requestId !== requestIdRef.current) return
      cacheRef.current.set(queryKey, response)
      setData(response)
      setActiveClusterTime(null)
      scheduleRelayout()
    } catch (error: any) {
      if (requestId !== requestIdRef.current) return
      setData(null)
      setErrorMessage(error?.message || String(error))
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [scope, stockCode, startDate, endDate, interval, queryKey, scheduleRelayout])

  useEffect(() => {
    clustersRef.current = data?.clusters || []
  }, [data?.clusters])

  useEffect(() => {
    if (!chartHostRef.current) return

    const chart = init(chartHostRef.current, {
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      styles: {
        candle: {
          tooltip: { showRule: 'follow_cross' }
        },
        crosshair: {
          horizontal: { show: true, text: { show: true } },
          vertical: { show: true, text: { show: true } }
        }
      } as any
    })
    if (!chart) {
      setErrorMessage('K线图初始化失败')
      return
    }
    chartRef.current = chart
    chart.setPriceVolumePrecision(2, 0)

    const onCrosshairChange = (payload?: any) => {
      const kLineData = payload?.kLineData
      if (!kLineData) {
        setHoverInfo(null)
        return
      }
      const ts = toMs(kLineData.timestamp)
      if (ts === null) {
        setHoverInfo(null)
        return
      }
      const clusterCount = clustersRef.current.find((item) => toMs(item.candleTime) === ts)?.count || 0
      setHoverInfo({
        timestamp: ts,
        open: Number(kLineData.open || 0),
        high: Number(kLineData.high || 0),
        low: Number(kLineData.low || 0),
        close: Number(kLineData.close || 0),
        clusterCount
      })
    }

    const onCandleClick = (payload?: any) => {
      const ts = extractEventTimestamp(payload)
      if (ts !== null) {
        setAnchorTimestamp(ts)
      }
    }

    const onRangeChanged = () => {
      scheduleRelayout()
    }

    chart.subscribeAction(ActionType.OnCrosshairChange, onCrosshairChange)
    chart.subscribeAction(ActionType.OnCandleBarClick, onCandleClick)
    chart.subscribeAction(ActionType.OnVisibleRangeChange, onRangeChanged)
    chart.subscribeAction(ActionType.OnZoom, onRangeChanged)
    chart.subscribeAction(ActionType.OnScroll, onRangeChanged)
    chart.subscribeAction(ActionType.OnDataReady, onRangeChanged)

    resizeObserverRef.current = new ResizeObserver(() => {
      chart.resize()
      scheduleRelayout()
    })
    if (wrapperRef.current) {
      resizeObserverRef.current.observe(wrapperRef.current)
    }

    return () => {
      chart.unsubscribeAction(ActionType.OnCrosshairChange, onCrosshairChange)
      chart.unsubscribeAction(ActionType.OnCandleBarClick, onCandleClick)
      chart.unsubscribeAction(ActionType.OnVisibleRangeChange, onRangeChanged)
      chart.unsubscribeAction(ActionType.OnZoom, onRangeChanged)
      chart.unsubscribeAction(ActionType.OnScroll, onRangeChanged)
      chart.unsubscribeAction(ActionType.OnDataReady, onRangeChanged)
      resizeObserverRef.current?.disconnect()
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      dispose(chart)
      chartRef.current = null
    }
  }, [scheduleRelayout])

  useEffect(() => {
    void loadVisualData()
  }, [loadVisualData])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!data || data.candles.length === 0) {
      chart.clearData()
      scheduleRelayout()
      return
    }

    const chartData: KLineData[] = []
    for (const item of data.candles) {
      const ts = toMs(item.timestamp)
      if (ts === null) continue
      chartData.push({
        timestamp: ts,
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
        volume: Number(item.volume || 0)
      })
    }
    chartData.sort((left, right) => left.timestamp - right.timestamp)

    chart.applyNewData(chartData)
    chart.scrollToRealTime()
    scheduleRelayout()
  }, [data, scheduleRelayout])

  useEffect(() => {
    if (!selectedEntryId || !data || !chartRef.current) return
    const marker = data.markers.find((item) => item.entryId === selectedEntryId && !item.outOfRange && item.alignedCandleTime)
    if (!marker?.alignedCandleTime) return
    const ts = toMs(marker.alignedCandleTime)
    if (ts === null) return
    chartRef.current.scrollToTimestamp(ts, 180)
    setActiveClusterTime(marker.alignedCandleTime)
  }, [selectedEntryId, data])

  const candleByTime = useMemo(() => {
    const map = new Map<string, { high: number; low: number }>()
    for (const candle of data?.candles || []) {
      map.set(candle.timestamp, { high: candle.high, low: candle.low })
    }
    return map
  }, [data?.candles])

  const markerLayouts = useMemo(() => {
    if (!data || !chartRef.current) return []
    const chart = chartRef.current
    const layouts: MarkerLayout[] = []
    for (const cluster of data.clusters) {
      const candle = candleByTime.get(cluster.candleTime)
      if (!candle) continue
      const ts = toMs(cluster.candleTime)
      if (ts === null) continue
      const point = chart.convertToPixel({ timestamp: ts, value: candle.high }, {})
      const x = typeof (point as any)?.x === 'number' ? (point as any).x : NaN
      const y = typeof (point as any)?.y === 'number' ? (point as any).y : NaN
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      layouts.push({
        candleTime: cluster.candleTime,
        direction: resolveDirectionFromCluster(cluster),
        count: cluster.count,
        entryIds: cluster.markerEntryIds,
        x,
        y
      })
    }
    return layouts
  }, [data, candleByTime, layoutVersion])

  const activeCluster = useMemo(() => {
    if (!activeClusterTime || !data) return null
    return data.clusters.find((item) => item.candleTime === activeClusterTime) || null
  }, [activeClusterTime, data])

  const openAddNote = () => {
    if (!canAddNote) return
    const seed = anchorTimestamp || hoverInfo?.timestamp || Date.now()
    setNoteEventTime(dayjs(seed))
    setNoteContent('')
    setNoteDirection('未知')
    setNoteModalOpen(true)
  }

  const handleSaveNote = async () => {
    if (!stockCode) {
      message.warning('请先在单股票模式下选择股票')
      return
    }
    if (!noteContent.trim()) {
      message.warning('请先填写笔记内容')
      return
    }
    setSavingNote(true)
    try {
      await window.api.notes.addEntry(stockCode, {
        content: noteContent.trim(),
        category: '看盘预测',
        operationTag: '无',
        viewpoint: {
          direction: noteDirection,
          confidence: noteDirection === '未知' ? 0 : 0.7,
          timeHorizon: '短线'
        },
        eventTime: (noteEventTime || dayjs()).toISOString(),
        inputType: 'manual'
      })
      message.success('笔记已保存，并已按时间吸附到K线')
      setNoteModalOpen(false)
      onNoteSaved?.()
      await loadVisualData(true)
    } catch (error: any) {
      message.error(`保存失败: ${error?.message || String(error)}`)
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Space size={[8, 8]} wrap>
          <Tag color="blue">{resolvedStockLabel}</Tag>
          <Select<KlineInterval>
            value={interval}
            onChange={(value) => setInterval(value)}
            style={{ width: 120 }}
            options={INTERVAL_OPTIONS}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { void loadVisualData(true) }} loading={loading}>
            刷新
          </Button>
          <Tooltip title={canAddNote ? '先点击K线蜡烛可锁定事件时间，再添加笔记' : '仅单股票模式支持直接从K线添加笔记'}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddNote} disabled={!canAddNote}>
              添加笔记
            </Button>
          </Tooltip>
        </Space>
        <div className="text-xs text-gray-500">
          {anchorTimestamp ? `锚定时间: ${dayjs(anchorTimestamp).format('YYYY-MM-DD HH:mm:ss')}` : '提示：点击蜡烛可设置笔记锚定时间'}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {hoverInfo ? (
          <span>
            {dayjs(hoverInfo.timestamp).format('YYYY-MM-DD HH:mm')} · O {hoverInfo.open.toFixed(2)} · H {hoverInfo.high.toFixed(2)} · L {hoverInfo.low.toFixed(2)} · C {hoverInfo.close.toFixed(2)}
            {hoverInfo.clusterCount > 0 ? ` · 笔记 ${hoverInfo.clusterCount} 条` : ''}
          </span>
        ) : (
          <span>移动鼠标查看蜡烛详情，点击蜡烛可把时间吸附为笔记事件时间。</span>
        )}
        <Tooltip title="聚合标记：同一根蜡烛上的多条笔记会显示为数字。点击数字可展开列表并联动明细。">
          <InfoCircleOutlined className="cursor-help text-gray-400" />
        </Tooltip>
      </div>

      {errorMessage ? (
        <Alert className="mb-3" type="error" showIcon message={`K线数据加载失败: ${errorMessage}`} />
      ) : null}

      <div ref={wrapperRef} className="relative rounded-lg border border-slate-200 bg-white" style={{ height: CHART_HEIGHT }}>
        <div ref={chartHostRef} className="h-full w-full" />

        {(data && markerLayouts.length > 0) ? (
          <div className="pointer-events-none absolute inset-0">
            {markerLayouts.map((marker) => {
              const isSelected = Boolean(selectedEntryId && marker.entryIds.includes(selectedEntryId))
              return (
                <button
                  key={`${marker.candleTime}-${marker.count}`}
                  type="button"
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full text-white shadow"
                  style={{
                    left: marker.x,
                    top: marker.y - 14,
                    minWidth: marker.count > 1 ? 24 : 12,
                    height: marker.count > 1 ? 20 : 12,
                    padding: marker.count > 1 ? '0 6px' : 0,
                    fontSize: marker.count > 1 ? 11 : 0,
                    border: isSelected ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.65)',
                    background: marker.count > 1 ? '#111827' : MARKER_BG_BY_DIRECTION[marker.direction],
                    transform: marker.count > 1 ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)'
                  }}
                  onClick={() => {
                    setActiveClusterTime(marker.candleTime)
                    if (marker.count === 1 && marker.entryIds[0]) {
                      onMarkerSelect?.(marker.entryIds[0])
                    }
                  }}
                >
                  {marker.count > 1 ? marker.count : ''}
                </button>
              )
            })}
          </div>
        ) : null}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-slate-600">
            正在加载K线数据...
          </div>
        )}

        {(!loading && data && data.candles.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90">
            <Empty description="当前区间暂无K线数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </div>

      {activeCluster && activeCluster.count > 1 ? (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="mb-2 text-xs text-slate-500">
            聚合详情 · {dayjs(activeCluster.candleTime).format('YYYY-MM-DD HH:mm')} · 共 {activeCluster.count} 条
          </div>
          <Space size={[6, 6]} wrap>
            {activeCluster.markerEntryIds.map((entryId) => {
              const marker = data?.markers.find((item) => item.entryId === entryId)
              const direction = marker?.direction || '未知'
              return (
                <Button
                  key={entryId}
                  size="small"
                  type={selectedEntryId === entryId ? 'primary' : 'default'}
                  onClick={() => onMarkerSelect?.(entryId)}
                >
                  {direction} · {marker?.eventTime ? dayjs(marker.eventTime).format('MM-DD HH:mm') : entryId}
                </Button>
              )
            })}
          </Space>
        </div>
      ) : null}

      <Modal
        open={noteModalOpen}
        title="从K线添加笔记"
        okText="保存笔记"
        cancelText="取消"
        okButtonProps={{ loading: savingNote }}
        onCancel={() => setNoteModalOpen(false)}
        onOk={() => { void handleSaveNote() }}
      >
        <Space direction="vertical" size="middle" className="w-full">
          <div>
            <div className="mb-1 text-xs text-gray-500">事件时间（吸附到K线，可手动微调）</div>
            <DatePicker
              className="w-full"
              value={noteEventTime}
              showTime={{ format: 'HH:mm:ss' }}
              format="YYYY-MM-DD HH:mm:ss"
              onChange={(value) => setNoteEventTime(value)}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-500">观点</div>
            <Select<ReviewMarkerDirection>
              className="w-full"
              value={noteDirection}
              onChange={(value) => setNoteDirection(value)}
              options={DIRECTION_OPTIONS}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-500">内容（类别默认：看盘预测）</div>
            <Input.TextArea
              value={noteContent}
              rows={5}
              maxLength={2000}
              showCount
              onChange={(event) => setNoteContent(event.target.value)}
              placeholder="记录你当下对走势的判断和依据..."
            />
          </div>
        </Space>
      </Modal>
    </div>
  )
}

export default ReviewKlineWorkbench
