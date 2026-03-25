import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Space, Spin, Tag } from 'antd'
import type { ReviewMarkerDirection, ReviewVisualResponse } from '../../shared/types'

interface ReviewKlinePanelProps {
  data: ReviewVisualResponse | null
  loading?: boolean
  selectedEntryId?: string | null
  onMarkerSelect?: (entryId: string) => void
  onRetry?: () => void
}

interface MarkerPoint {
  entryId: string
  direction: ReviewMarkerDirection
  eventTime: string
  stockCode: string
  candleTime: string
  x: number
  y: number
  clusterCount: number
}

const CHART_HEIGHT = 320
const MARGIN_TOP = 24
const MARGIN_BOTTOM = 30
const MARGIN_LEFT = 16
const MARGIN_RIGHT = 16

const colorByDirection: Record<ReviewMarkerDirection, string> = {
  看多: '#ef4444',
  看空: '#16a34a',
  中性: '#64748b',
  未知: '#9ca3af'
}

const resolveClusterDirection = (input: { bullish: number; bearish: number; neutral: number; unknown: number }): ReviewMarkerDirection => {
  const pairs: Array<{ direction: ReviewMarkerDirection; count: number }> = [
    { direction: '看多', count: input.bullish },
    { direction: '看空', count: input.bearish },
    { direction: '中性', count: input.neutral },
    { direction: '未知', count: input.unknown }
  ]
  return pairs.sort((left, right) => right.count - left.count)[0]?.direction || '未知'
}

const ReviewKlinePanel: React.FC<ReviewKlinePanelProps> = ({
  data,
  loading = false,
  selectedEntryId = null,
  onMarkerSelect,
  onRetry
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [activeClusterTime, setActiveClusterTime] = useState<string | null>(null)

  const chart = useMemo(() => {
    if (!data || data.candles.length === 0) {
      return null
    }

    const candles = [...data.candles]
      .filter((item) => Number.isFinite(new Date(item.timestamp).getTime()))
      .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    if (candles.length === 0) {
      return null
    }

    const allHigh = candles.map((item) => item.high)
    const allLow = candles.map((item) => item.low)
    const maxHigh = Math.max(...allHigh)
    const minLow = Math.min(...allLow)
    const rawRange = maxHigh - minLow
    const safeRange = rawRange > 0 ? rawRange : Math.max(maxHigh * 0.01, 1)
    const padding = safeRange * 0.08
    const topPrice = maxHigh + padding
    const bottomPrice = minLow - padding

    const svgWidth = Math.max(900, candles.length * 8 + MARGIN_LEFT + MARGIN_RIGHT + 40)
    const plotWidth = svgWidth - MARGIN_LEFT - MARGIN_RIGHT
    const plotHeight = CHART_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
    const candleStep = plotWidth / candles.length
    const candleBodyWidth = Math.max(2, Math.min(10, candleStep * 0.62))

    const priceToY = (price: number) => {
      const ratio = (topPrice - price) / (topPrice - bottomPrice)
      return MARGIN_TOP + ratio * plotHeight
    }
    const indexToX = (index: number) => MARGIN_LEFT + index * candleStep + candleStep / 2

    const indexByTimestamp = new Map<string, number>()
    candles.forEach((item, index) => {
      indexByTimestamp.set(item.timestamp, index)
    })

    const clusterByTime = new Map(data.clusters.map((item) => [item.candleTime, item]))

    const markerPoints: MarkerPoint[] = data.markers
      .filter((item) => !item.outOfRange && Boolean(item.alignedCandleTime))
      .map((item) => {
        const candleTime = item.alignedCandleTime as string
        const candleIndex = indexByTimestamp.get(candleTime)
        if (candleIndex === undefined) return null
        const candle = candles[candleIndex]
        const cluster = clusterByTime.get(candleTime)
        return {
          entryId: item.entryId,
          direction: item.direction,
          eventTime: item.eventTime,
          stockCode: item.stockCode,
          candleTime,
          x: indexToX(candleIndex),
          y: priceToY(candle.high) - 12,
          clusterCount: cluster?.count || 1
        }
      })
      .filter((item): item is MarkerPoint => Boolean(item))

    const markerByEntry = new Map(markerPoints.map((item) => [item.entryId, item]))

    const clusters = data.clusters
      .map((cluster) => {
        const index = indexByTimestamp.get(cluster.candleTime)
        if (index === undefined) return null
        const candle = candles[index]
        return {
          ...cluster,
          direction: resolveClusterDirection(cluster),
          x: indexToX(index),
          y: priceToY(candle.high) - 12
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    const directionSummary = data.markers.reduce<Record<ReviewMarkerDirection, number>>((acc, marker) => {
      acc[marker.direction] = (acc[marker.direction] || 0) + 1
      return acc
    }, { 看多: 0, 看空: 0, 中性: 0, 未知: 0 })

    const labels = candles
      .map((item, index) => ({ index, timestamp: item.timestamp }))
      .filter((_, index) => index === 0 || index === candles.length - 1 || index % Math.max(1, Math.floor(candles.length / 6)) === 0)

    return {
      candles,
      clusters,
      directionSummary,
      svgWidth,
      candleBodyWidth,
      labels,
      topPrice,
      bottomPrice,
      priceToY,
      indexToX,
      markerByEntry
    }
  }, [data])

  useEffect(() => {
    setActiveClusterTime(null)
  }, [data?.generatedAt, data?.stockCode, data?.interval])

  useEffect(() => {
    if (!selectedEntryId || !chart || !scrollRef.current) return
    const selectedMarker = chart.markerByEntry.get(selectedEntryId)
    if (!selectedMarker) return
    const viewport = scrollRef.current
    const targetLeft = Math.max(0, selectedMarker.x - viewport.clientWidth / 2)
    viewport.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [chart, selectedEntryId])

  if (loading) {
    return (
      <div className="h-[360px] flex items-center justify-center">
        <Spin tip="正在加载K线与笔记对齐数据..." />
      </div>
    )
  }

  if (!data || !chart) {
    return (
      <div className="h-[360px] flex items-center justify-center">
        <Empty
          description="暂无可展示的K线对齐数据"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  const benchmarkLabel = data.scope === 'overall'
    ? `基准：${data.stockCode === 'SH000001' ? '上证指数(SH000001)' : data.stockCode}`
    : `股票：${data.stockCode}`
  const activeCluster = activeClusterTime
    ? chart.clusters.find((item) => item.candleTime === activeClusterTime) || null
    : null

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Space size={[6, 6]} wrap>
          <Tag color="blue">{benchmarkLabel}</Tag>
          <Tag>周期：{data.interval}</Tag>
          <Tag>蜡烛：{data.candles.length}</Tag>
          <Tag>标记：{data.stats.totalMarkers}</Tag>
          <Tag color={data.stats.clusteredCandles > 0 ? 'purple' : 'default'}>
            聚合蜡烛：{data.stats.clusteredCandles}
          </Tag>
          {data.stats.outOfRangeMarkers > 0 ? (
            <Tag color="warning">未对齐：{data.stats.outOfRangeMarkers}</Tag>
          ) : null}
        </Space>
        {onRetry ? (
          <Button size="small" onClick={onRetry}>刷新图表</Button>
        ) : null}
      </div>

      <div className="mb-2 text-xs text-gray-500">
        方向分布：看多 {chart.directionSummary.看多} · 看空 {chart.directionSummary.看空} · 中性 {chart.directionSummary.中性} · 未知 {chart.directionSummary.未知}
      </div>

      {data.stats.totalMarkers === 0 ? (
        <Alert type="info" showIcon className="mb-3" message="当前区间暂无可对齐笔记，K线仅展示行情背景。" />
      ) : null}

      <div ref={scrollRef} className="overflow-x-auto border border-slate-200 rounded-lg bg-slate-50">
        <svg width={chart.svgWidth} height={CHART_HEIGHT} role="img" aria-label="复盘K线图">
          <rect x={0} y={0} width={chart.svgWidth} height={CHART_HEIGHT} fill="#f8fafc" />

          <line
            x1={MARGIN_LEFT}
            y1={CHART_HEIGHT - MARGIN_BOTTOM}
            x2={chart.svgWidth - MARGIN_RIGHT}
            y2={CHART_HEIGHT - MARGIN_BOTTOM}
            stroke="#cbd5e1"
            strokeWidth={1}
          />

          <line
            x1={MARGIN_LEFT}
            y1={MARGIN_TOP}
            x2={MARGIN_LEFT}
            y2={CHART_HEIGHT - MARGIN_BOTTOM}
            stroke="#e2e8f0"
            strokeWidth={1}
          />

          {chart.candles.map((candle, index) => {
            const x = chart.indexToX(index)
            const openY = chart.priceToY(candle.open)
            const closeY = chart.priceToY(candle.close)
            const highY = chart.priceToY(candle.high)
            const lowY = chart.priceToY(candle.low)
            const bodyTop = Math.min(openY, closeY)
            const bodyHeight = Math.max(1, Math.abs(closeY - openY))
            const isBullish = candle.close >= candle.open
            const color = isBullish ? '#ef4444' : '#16a34a'
            return (
              <g key={candle.timestamp}>
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={1} />
                <rect
                  x={x - chart.candleBodyWidth / 2}
                  y={bodyTop}
                  width={chart.candleBodyWidth}
                  height={bodyHeight}
                  fill={isBullish ? '#fff1f2' : '#ecfdf3'}
                  stroke={color}
                  strokeWidth={1}
                >
                  <title>{`${candle.timestamp}\n开:${candle.open} 高:${candle.high} 低:${candle.low} 收:${candle.close}`}</title>
                </rect>
              </g>
            )
          })}

          {chart.clusters.map((cluster) => {
            const markerColor = colorByDirection[cluster.direction]
            const containsSelected = Boolean(selectedEntryId && cluster.markerEntryIds.includes(selectedEntryId))
            if (cluster.count > 1) {
              return (
                <g key={`${cluster.candleTime}-cluster`} onClick={() => setActiveClusterTime(cluster.candleTime)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={cluster.x - 12}
                    y={cluster.y - 12}
                    width={24}
                    height={16}
                    rx={6}
                    fill={containsSelected ? '#0f172a' : '#1e293b'}
                    stroke={containsSelected ? '#fde047' : 'transparent'}
                    strokeWidth={containsSelected ? 1.5 : 0}
                    opacity={0.95}
                  >
                    <title>{`${cluster.candleTime}\n共 ${cluster.count} 条：多${cluster.bullish} 空${cluster.bearish} 中${cluster.neutral} 未知${cluster.unknown}`}</title>
                  </rect>
                  <text
                    x={cluster.x}
                    y={cluster.y}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#ffffff"
                    dominantBaseline="middle"
                  >
                    {cluster.count}
                  </text>
                </g>
              )
            }

            const entryId = cluster.markerEntryIds[0]
            const selected = selectedEntryId === entryId
            return (
              <g
                key={`${cluster.candleTime}-single`}
                onClick={() => {
                  setActiveClusterTime(cluster.candleTime)
                  if (entryId && onMarkerSelect) onMarkerSelect(entryId)
                }}
                style={{ cursor: 'pointer' }}
              >
                {selected ? <circle cx={cluster.x} cy={cluster.y - 3} r={7} fill="#fef9c3" opacity={0.9} /> : null}
                <circle cx={cluster.x} cy={cluster.y - 3} r={4} fill={markerColor}>
                  <title>{`${cluster.candleTime}\n${cluster.direction}`}</title>
                </circle>
              </g>
            )
          })}

          {chart.labels.map((item) => {
            const x = chart.indexToX(item.index)
            const label = item.timestamp.slice(5, 16).replace('T', ' ')
            return (
              <text
                key={`${item.timestamp}-label`}
                x={x}
                y={CHART_HEIGHT - 10}
                fontSize="10"
                fill="#64748b"
                textAnchor="middle"
              >
                {label}
              </text>
            )
          })}

          <text x={6} y={MARGIN_TOP + 8} fontSize="10" fill="#64748b">
            {chart.topPrice.toFixed(2)}
          </text>
          <text x={6} y={CHART_HEIGHT - MARGIN_BOTTOM} fontSize="10" fill="#64748b">
            {chart.bottomPrice.toFixed(2)}
          </text>
        </svg>
      </div>

      {activeCluster && activeCluster.count > 1 ? (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="mb-2 text-xs text-slate-500">
            聚合详情 · {activeCluster.candleTime} · 共 {activeCluster.count} 条（多{activeCluster.bullish} 空{activeCluster.bearish} 中{activeCluster.neutral} 未知{activeCluster.unknown}）
          </div>
          <Space size={[6, 6]} wrap>
            {activeCluster.markerEntryIds.map((entryId) => {
              const marker = chart.markerByEntry.get(entryId)
              if (!marker) return null
              const selected = selectedEntryId === entryId
              return (
                <Button
                  key={entryId}
                  size="small"
                  type={selected ? 'primary' : 'default'}
                  onClick={() => onMarkerSelect?.(entryId)}
                >
                  {marker.direction} · {marker.eventTime.slice(11, 16)} · {marker.stockCode}
                </Button>
              )
            })}
          </Space>
        </div>
      ) : null}

      <div className="mt-2 text-xs text-gray-500">
        提示：数字标记表示同一蜡烛上的多条笔记聚合；点击数字可展开并定位对应明细行。
      </div>
    </div>
  )
}

export default ReviewKlinePanel

