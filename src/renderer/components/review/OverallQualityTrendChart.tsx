import React, { useMemo } from 'react'
import { Empty, Tag } from 'antd'
import type { ReviewDailyQualityItem } from '../../../shared/types'

interface OverallQualityTrendChartProps {
  data: ReviewDailyQualityItem[]
}

const CHART_HEIGHT = 300
const MARGIN_TOP = 24
const MARGIN_RIGHT = 56
const MARGIN_BOTTOM = 48
const MARGIN_LEFT = 52

const OverallQualityTrendChart: React.FC<OverallQualityTrendChartProps> = ({ data }) => {
  const chart = useMemo(() => {
    const points = [...data]
      .filter((item) => item.date)
      .sort((left, right) => left.date.localeCompare(right.date))
    if (points.length === 0) return null

    const maxSamples = Math.max(
      1,
      ...points.map((item) => Math.max(item.predictionSamples, item.actionSamples))
    )
    const width = Math.max(760, points.length * 68 + MARGIN_LEFT + MARGIN_RIGHT)
    const plotWidth = width - MARGIN_LEFT - MARGIN_RIGHT
    const plotHeight = CHART_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
    const step = points.length > 1 ? plotWidth / (points.length - 1) : 0
    const barWidth = Math.max(16, Math.min(34, (points.length > 1 ? step : plotWidth) * 0.48))

    const xForIndex = (index: number) => (
      points.length > 1
        ? MARGIN_LEFT + index * step
        : MARGIN_LEFT + plotWidth / 2
    )
    const yForSample = (samples: number) => (
      MARGIN_TOP + (1 - (samples / maxSamples)) * plotHeight
    )
    const yForAccuracy = (accuracy: number) => (
      MARGIN_TOP + (1 - (accuracy / 100)) * plotHeight
    )

    const predictionPath = buildPath(points.map((item, index) => ({
      x: xForIndex(index),
      y: yForAccuracy(item.predictionAccuracy)
    })))
    const actionPath = buildPath(points.map((item, index) => ({
      x: xForIndex(index),
      y: yForAccuracy(item.actionAccuracy)
    })))
    const alignmentPath = buildPath(points.map((item, index) => ({
      x: xForIndex(index),
      y: yForAccuracy(item.alignmentRate)
    })))

    return {
      points,
      width,
      plotHeight,
      maxSamples,
      barWidth,
      xForIndex,
      yForSample,
      yForAccuracy,
      predictionPath,
      actionPath,
      alignmentPath
    }
  }, [data])

  if (!chart) {
    return <Empty description="暂无按日质量数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const labelStep = Math.max(1, Math.ceil(chart.points.length / 8))
  const leftTicks = [0, chart.maxSamples / 2, chart.maxSamples]
  const rightTicks = [0, 50, 100]

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-gray-600">
        <Tag color="processing">柱：每日预测样本数</Tag>
        <Tag color="red">线：预测命中率</Tag>
        <Tag color="green">线：操作胜率</Tag>
        <Tag color="gold">线：知行一致率</Tag>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-slate-50">
        <svg width={chart.width} height={CHART_HEIGHT} role="img" aria-label="全股票综合复盘每日质量趋势">
          <rect x={0} y={0} width={chart.width} height={CHART_HEIGHT} fill="#f8fafc" />

          {leftTicks.map((tick) => {
            const y = chart.yForSample(tick)
            return (
              <g key={`left-${tick}`}>
                <line
                  x1={MARGIN_LEFT}
                  y1={y}
                  x2={chart.width - MARGIN_RIGHT}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text x={MARGIN_LEFT - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#64748b">
                  {Math.round(tick)}
                </text>
              </g>
            )
          })}

          {rightTicks.map((tick) => {
            const y = chart.yForAccuracy(tick)
            return (
              <text key={`right-${tick}`} x={chart.width - MARGIN_RIGHT + 8} y={y + 4} fontSize={11} fill="#64748b">
                {tick}%
              </text>
            )
          })}

          <line
            x1={MARGIN_LEFT}
            y1={CHART_HEIGHT - MARGIN_BOTTOM}
            x2={chart.width - MARGIN_RIGHT}
            y2={CHART_HEIGHT - MARGIN_BOTTOM}
            stroke="#cbd5e1"
            strokeWidth={1}
          />
          <line
            x1={MARGIN_LEFT}
            y1={MARGIN_TOP}
            x2={MARGIN_LEFT}
            y2={CHART_HEIGHT - MARGIN_BOTTOM}
            stroke="#cbd5e1"
            strokeWidth={1}
          />

          {chart.points.map((item, index) => {
            const x = chart.xForIndex(index)
            const y = chart.yForSample(item.predictionSamples)
            const height = CHART_HEIGHT - MARGIN_BOTTOM - y
            return (
              <g key={`bar-${item.date}`}>
                <rect
                  x={x - chart.barWidth / 2}
                  y={y}
                  width={chart.barWidth}
                  height={Math.max(height, 1)}
                  rx={4}
                  fill="#93c5fd"
                  opacity={0.85}
                >
                  <title>{`${item.date} 预测样本: ${item.predictionSamples}`}</title>
                </rect>
              </g>
            )
          })}

          <path d={chart.predictionPath} fill="none" stroke="#ef4444" strokeWidth={2} />
          <path d={chart.actionPath} fill="none" stroke="#16a34a" strokeWidth={2} />
          <path d={chart.alignmentPath} fill="none" stroke="#f59e0b" strokeWidth={2} />

          {chart.points.map((item, index) => {
            const x = chart.xForIndex(index)
            return (
              <g key={`point-${item.date}`}>
                <circle cx={x} cy={chart.yForAccuracy(item.predictionAccuracy)} r={3} fill="#ef4444">
                  <title>{`${item.date} 预测命中率: ${toPercent(item.predictionAccuracy)}`}</title>
                </circle>
                <circle cx={x} cy={chart.yForAccuracy(item.actionAccuracy)} r={3} fill="#16a34a">
                  <title>{`${item.date} 操作胜率: ${toPercent(item.actionAccuracy)}`}</title>
                </circle>
                <circle cx={x} cy={chart.yForAccuracy(item.alignmentRate)} r={3} fill="#f59e0b">
                  <title>{`${item.date} 知行一致率: ${toPercent(item.alignmentRate)}`}</title>
                </circle>
              </g>
            )
          })}

          {chart.points.map((item, index) => {
            const show = index === 0 || index === chart.points.length - 1 || index % labelStep === 0
            if (!show) return null
            return (
              <text
                key={`label-${item.date}`}
                x={chart.xForIndex(index)}
                y={CHART_HEIGHT - MARGIN_BOTTOM + 18}
                textAnchor="middle"
                fontSize={11}
                fill="#64748b"
              >
                {item.date.slice(5)}
              </text>
            )
          })}

          <text x={MARGIN_LEFT} y={14} fontSize={11} fill="#64748b">样本数</text>
          <text x={chart.width - MARGIN_RIGHT + 8} y={14} fontSize={11} fill="#64748b">比率</text>
        </svg>
      </div>
    </div>
  )
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

function toPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%'
  return `${value.toFixed(2)}%`
}

export default OverallQualityTrendChart
