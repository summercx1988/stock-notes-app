import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Descriptions,
  DatePicker,
  Empty,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message
} from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type {
  KlineInterval,
  ReviewActionResult,
  ReviewDailyActionDetailItem,
  ReviewDailyQualityItem,
  ReviewEvaluateResponse,
  ReviewEventResult,
  ReviewScope
} from '../../shared/types'
import ReviewKlineWorkbench from './review/ReviewKlineWorkbench'
import OverallQualityTrendChart from './review/OverallQualityTrendChart'

const { RangePicker } = DatePicker
const PAGE_SIZE = 10
const DEFAULT_ACTION_SUMMARY: ReviewEvaluateResponse['actionSummary'] = {
  totalActions: 0,
  buyActions: 0,
  sellActions: 0,
  evaluatedSamples: 0,
  insufficientData: 0,
  hits: 0,
  accuracy: 0,
  buyAccuracy: 0,
  sellAccuracy: 0,
  alignedWithViewpoint: 0,
  viewpointLinkedActions: 0,
  alignmentRate: 0
}

const ViewpointTrackingView: React.FC = () => {
  const { currentStockCode, currentStockName } = useAppStore()

  const [trackingScope, setTrackingScope] = useState<ReviewScope>('single')
  const [interval, setInterval] = useState<KlineInterval>('5m')
  const [trackingWindowDays, setTrackingWindowDays] = useState<number>(3)
  const [trackingThresholdPct, setTrackingThresholdPct] = useState<number>(3)
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(13, 'day').startOf('day'),
    dayjs().endOf('day')
  ])
  const [trackingEvaluation, setTrackingEvaluation] = useState<ReviewEvaluateResponse | null>(null)
  const [trackingRunning, setTrackingRunning] = useState(false)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [predictionPage, setPredictionPage] = useState(1)
  const [actionPage, setActionPage] = useState(1)
  const [stockNameMap, setStockNameMap] = useState<Record<string, string>>({})
  const predictionTableRef = useRef<HTMLDivElement | null>(null)
  const actionTableRef = useRef<HTMLDivElement | null>(null)

  const selectedTrackingScopeLabel = useMemo(() => {
    if (trackingScope === 'single') {
      return currentStockCode ? `${currentStockName || currentStockCode}（${currentStockCode}）` : '未选择股票'
    }
    return '全市场观点追踪'
  }, [trackingScope, currentStockCode, currentStockName])

  const predictionIndexByEntry = useMemo(() => {
    const map = new Map<string, number>()
    ;(trackingEvaluation?.results || []).forEach((item, index) => map.set(item.entryId, index))
    return map
  }, [trackingEvaluation?.results])

  const actionIndexByEntry = useMemo(() => {
    const map = new Map<string, number>()
    ;(trackingEvaluation?.actionResults || []).forEach((item, index) => map.set(item.entryId, index))
    return map
  }, [trackingEvaluation?.actionResults])

  const scrollToEntryRow = useCallback((entryId: string) => {
    const containers = [predictionTableRef.current, actionTableRef.current]
    for (const container of containers) {
      if (!container) continue
      const row = container.querySelector(`tr[data-row-key="${entryId}"]`) as HTMLElement | null
      if (!row) continue
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
  }, [])

  const selectEntry = useCallback((entryId: string, source: 'chart' | 'prediction' | 'action') => {
    setActiveEntryId(entryId)
    const predictionIndex = predictionIndexByEntry.get(entryId)
    if (predictionIndex !== undefined) {
      setPredictionPage(Math.floor(predictionIndex / PAGE_SIZE) + 1)
    }
    const actionIndex = actionIndexByEntry.get(entryId)
    if (actionIndex !== undefined) {
      setActionPage(Math.floor(actionIndex / PAGE_SIZE) + 1)
    }
    if (source === 'chart') {
      window.setTimeout(() => scrollToEntryRow(entryId), 120)
    }
  }, [actionIndexByEntry, predictionIndexByEntry, scrollToEntryRow])

  const handleRunTracking = async () => {
    if (trackingScope === 'single' && !currentStockCode) {
      message.warning('请先在左侧选择一只股票')
      return
    }

    setTrackingRunning(true)
    setActiveEntryId(null)
    setPredictionPage(1)
    setActionPage(1)
    try {
      const result = await window.api.review.evaluate({
        scope: trackingScope,
        stockCode: trackingScope === 'single' ? currentStockCode || undefined : undefined,
        startDate: timeRange?.[0]?.toISOString(),
        endDate: timeRange?.[1]?.toISOString(),
        interval,
        rule: {
          windowDays: trackingWindowDays,
          thresholdPct: trackingThresholdPct,
          excludeUnknown: true
        }
      })

      const normalizedResult: ReviewEvaluateResponse = {
        ...result,
        actionSummary: (result as Partial<ReviewEvaluateResponse>).actionSummary || DEFAULT_ACTION_SUMMARY,
        actionResults: (result as Partial<ReviewEvaluateResponse>).actionResults || [],
        dailyQuality: (result as Partial<ReviewEvaluateResponse>).dailyQuality || [],
        perfStats: (result as Partial<ReviewEvaluateResponse>).perfStats
      }
      setTrackingEvaluation(normalizedResult)
    } catch (error: any) {
      message.error(`观点追踪计算失败: ${error.message}`)
    } finally {
      setTrackingRunning(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const stockCodes = new Set<string>()

    for (const item of trackingEvaluation?.results || []) {
      if (item.stockCode) stockCodes.add(item.stockCode)
    }
    for (const item of trackingEvaluation?.actionResults || []) {
      if (item.stockCode) stockCodes.add(item.stockCode)
    }
    for (const day of trackingEvaluation?.dailyQuality || []) {
      for (const detail of day.actionDetails || []) {
        if (detail.stockCode) stockCodes.add(detail.stockCode)
      }
    }

    const normalizedCodes = Array.from(stockCodes)
      .map((code) => normalizeStockCode(code))
      .filter((code): code is string => Boolean(code))
    const uniqueCodes = Array.from(new Set(normalizedCodes))
    if (uniqueCodes.length === 0) return () => { cancelled = true }

    const missingCodes = uniqueCodes.filter((code) => !stockNameMap[code])
    if (missingCodes.length === 0) return () => { cancelled = true }

    const load = async () => {
      try {
        const result = await window.api.stock.getByCodes(missingCodes) as Record<string, { name?: string }>
        if (cancelled) return
        setStockNameMap((prev) => {
          const next = { ...prev }
          for (const code of missingCodes) {
            const name = result?.[code]?.name
            if (name) {
              next[code] = name
            }
          }
          return next
        })
      } catch (error) {
        console.warn('[ViewpointTrackingView] load stock names failed', error)
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [trackingEvaluation, stockNameMap])

  const renderStockLabel = useCallback((stockCode: string) => {
    const normalizedCode = normalizeStockCode(stockCode)
    const name = (normalizedCode ? stockNameMap[normalizedCode] : undefined) || stockNameMap[stockCode]
    if (!name || name === stockCode || name === normalizedCode) {
      return stockCode
    }
    return `${name} (${stockCode})`
  }, [stockNameMap])

  const columns = [
    {
      title: '股票',
      dataIndex: 'stockCode',
      width: 170,
      render: (value: string) => renderStockLabel(value)
    },
    {
      title: '事件时间',
      dataIndex: 'eventTime',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
      width: 150
    },
    {
      title: '观点',
      dataIndex: 'direction',
      width: 88,
      render: (value: ReviewEventResult['direction']) => (
        <Tooltip title={value === '看多' ? '看多：预期窗口内上涨达到阈值' : '看空：预期窗口内下跌达到阈值'}>
          <Tag color={value === '看多' ? 'red' : 'green'}>{value}</Tag>
        </Tooltip>
      )
    },
    { title: '入场价', dataIndex: 'entryPrice', width: 92 },
    { title: '目标价', dataIndex: 'targetPrice', width: 92 },
    {
      title: '涨跌幅',
      dataIndex: 'changePct',
      width: 102,
      render: (value: number) => {
        const color = value >= 0 ? '#ef4444' : '#22c55e'
        return <span style={{ color }}>{value.toFixed(2)}%</span>
      }
    },
    {
      title: '结果',
      dataIndex: 'hit',
      width: 84,
      render: (value: boolean) => <Tag color={value ? 'success' : 'error'}>{value ? '命中' : '未命中'}</Tag>
    },
    {
      title: '说明',
      dataIndex: 'reason',
      ellipsis: true,
      render: (value: string) => (
        <Tooltip title={value}>
          <span>{value}</span>
        </Tooltip>
      )
    }
  ]

  const actionColumns = [
    {
      title: '股票',
      dataIndex: 'stockCode',
      width: 170,
      render: (value: string) => renderStockLabel(value)
    },
    {
      title: '事件时间',
      dataIndex: 'eventTime',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
      width: 150
    },
    {
      title: '操作',
      dataIndex: 'operationTag',
      width: 88,
      render: (value: ReviewActionResult['operationTag']) => (
        <Tag color={value === '买入' ? 'red' : 'green'}>{value}</Tag>
      )
    },
    {
      title: '观点一致性',
      dataIndex: 'viewpointDirection',
      width: 108,
      render: (value: ReviewActionResult['viewpointDirection'], record: ReviewActionResult) => {
        if (value === '未知') return <Tag>未知</Tag>
        const aligned = (value === '看多' && record.operationTag === '买入') || (value === '看空' && record.operationTag === '卖出')
        return <Tag color={aligned ? 'success' : 'warning'}>{aligned ? '一致' : '不一致'}</Tag>
      }
    },
    { title: '入场价', dataIndex: 'entryPrice', width: 92 },
    { title: '目标价', dataIndex: 'targetPrice', width: 92 },
    {
      title: '涨跌幅',
      dataIndex: 'changePct',
      width: 102,
      render: (value: number) => {
        const color = value >= 0 ? '#ef4444' : '#22c55e'
        return <span style={{ color }}>{value.toFixed(2)}%</span>
      }
    },
    {
      title: '结果',
      dataIndex: 'hit',
      width: 84,
      render: (value: boolean) => <Tag color={value ? 'success' : 'error'}>{value ? '命中' : '未命中'}</Tag>
    },
    {
      title: '说明',
      dataIndex: 'reason',
      ellipsis: true,
      render: (value: string) => (
        <Tooltip title={value}>
          <span>{value}</span>
        </Tooltip>
      )
    }
  ]

  const dailyQualityColumns = [
    {
      title: '日期',
      dataIndex: 'date',
      width: 110
    },
    {
      title: '股票数',
      dataIndex: 'stocksCount',
      width: 84
    },
    {
      title: '预测样本',
      dataIndex: 'predictionSamples',
      width: 100
    },
    {
      title: '预测命中率',
      dataIndex: 'predictionAccuracy',
      width: 112,
      render: (value: number) => toPercent(value)
    },
    {
      title: '买点胜率',
      key: 'buyAccuracy',
      width: 124,
      render: (_: unknown, record: ReviewDailyQualityItem) => (
        <span>{toPercent(record.buyAccuracy)} ({record.buyHits}/{record.buySamples})</span>
      )
    },
    {
      title: '卖点胜率',
      key: 'sellAccuracy',
      width: 124,
      render: (_: unknown, record: ReviewDailyQualityItem) => (
        <span>{toPercent(record.sellAccuracy)} ({record.sellHits}/{record.sellSamples})</span>
      )
    },
    {
      title: '操作样本',
      dataIndex: 'actionSamples',
      width: 100
    },
    {
      title: '操作胜率',
      dataIndex: 'actionAccuracy',
      width: 100,
      render: (value: number) => toPercent(value)
    },
    {
      title: '知行一致率',
      dataIndex: 'alignmentRate',
      width: 112,
      render: (value: number, record: ReviewDailyQualityItem) => (
        <span>
          {toPercent(value)} ({record.alignedActions}/{record.viewpointLinkedActions})
        </span>
      )
    },
    {
      title: '买/卖次数',
      key: 'buySell',
      width: 108,
      render: (_: unknown, record: ReviewDailyQualityItem) => `${record.buyActions}/${record.sellActions}`
    },
    {
      title: '数据不足',
      dataIndex: 'actionInsufficientData',
      width: 92
    }
  ]

  const actionSummary = trackingEvaluation?.actionSummary || DEFAULT_ACTION_SUMMARY
  const actionResults = trackingEvaluation?.actionResults || []
  const perfStats = trackingEvaluation?.perfStats
  const dailyQuality = useMemo(() => {
    const source = [...(trackingEvaluation?.dailyQuality || [])]
      .filter((item) => item.predictionSamples > 0)
      .sort((left, right) => left.date.localeCompare(right.date))
    if (source.length === 0) return []
    const latest = dayjs(source[source.length - 1].date)
    const minDate = latest.subtract(13, 'day')
    return source.filter((item) => dayjs(item.date).isSame(minDate, 'day') || dayjs(item.date).isAfter(minDate, 'day'))
  }, [trackingEvaluation?.dailyQuality])
  const dailyQualityTrend = useMemo(
    () => [...dailyQuality].sort((left, right) => left.date.localeCompare(right.date)),
    [dailyQuality]
  )

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold m-0">观点追踪</h2>
          <Tag color="blue">{selectedTrackingScopeLabel}</Tag>
        </div>

        <Space wrap size="middle">
          <Radio.Group
            value={trackingScope}
            onChange={(event) => setTrackingScope(event.target.value)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: '单股观点追踪', value: 'single' },
              { label: '全市场观点追踪', value: 'overall' }
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
          />

          <Select<KlineInterval>
            value={interval}
            onChange={(value) => setInterval(value)}
            style={{ width: 120 }}
            options={[
              { label: '5 分钟', value: '5m' },
              { label: '15 分钟', value: '15m' },
              { label: '30 分钟', value: '30m' },
              { label: '60 分钟', value: '60m' },
              { label: '日K', value: '1d' }
            ]}
          />

          <InputNumber
            min={1}
            max={30}
            value={trackingWindowDays}
            onChange={(value) => setTrackingWindowDays(Number(value) || 3)}
            addonAfter="D"
            style={{ width: 110 }}
          />
          <Tooltip title="D 表示判定窗口天数。示例：3D=从事件时间开始，向后观察 3 天内是否达到阈值。">
            <InfoCircleOutlined className="text-gray-400 cursor-help" />
          </Tooltip>

          <InputNumber
            min={0.1}
            max={20}
            step={0.1}
            value={trackingThresholdPct}
            onChange={(value) => setTrackingThresholdPct(Number(value) || 3)}
            addonAfter="%"
            style={{ width: 120 }}
          />
          <Tooltip title="% 表示命中阈值。示例：3%=3 天窗口内涨跌幅达到正负 3% 记为命中。">
            <InfoCircleOutlined className="text-gray-400 cursor-help" />
          </Tooltip>

          <Tag color="processing">规则: {trackingWindowDays}D / {trackingThresholdPct}%</Tag>

          <Button type="primary" loading={trackingRunning} onClick={handleRunTracking}>
            开始追踪
          </Button>
        </Space>
        <div className="mt-2 text-xs text-gray-500">
          参数说明：D 为观察窗口天数，% 为命中阈值百分比。默认 3D / 3%。
        </div>
      </div>

      <div className="p-4 overflow-auto">
        {!trackingEvaluation ? (
          <Empty description="设置范围后点击“开始追踪”" />
        ) : trackingScope === 'single' ? (
          <Space direction="vertical" size="middle" className="w-full">
            <Card title="个股择时工作台（K线联动）" size="small">
              <ReviewKlineWorkbench
                key={`${trackingScope}-${currentStockCode || 'none'}-${interval}-${timeRange?.[0]?.toISOString() || 'start'}-${timeRange?.[1]?.toISOString() || 'end'}`}
                scope={trackingScope}
                interval={interval}
                stockCode={currentStockCode || undefined}
                stockName={currentStockName || undefined}
                startDate={timeRange?.[0]?.toISOString()}
                endDate={timeRange?.[1]?.toISOString()}
                selectedEntryId={activeEntryId}
                onMarkerSelect={(entryId) => selectEntry(entryId, 'chart')}
                onNoteSaved={() => {
                  if (trackingEvaluation) {
                    void handleRunTracking()
                  }
                }}
              />
            </Card>

            <Card
              size="small"
              title={(
                <Space size={6}>
                  <span>预测统计（看盘预测）</span>
                  <Tooltip title="看多=预期上涨；看空=预期下跌；未知/震荡不计入胜率">
                    <InfoCircleOutlined />
                  </Tooltip>
                </Space>
              )}
            >
              <Descriptions
                size="small"
                column={3}
                items={[
                  { key: 'totalNotes', label: '总笔记', children: trackingEvaluation.summary.totalNotes },
                  { key: 'unknownNotes', label: '未知观点', children: trackingEvaluation.summary.unknownNotes },
                  { key: 'actionableNotes', label: '可评估样本', children: trackingEvaluation.summary.actionableNotes },
                  { key: 'evaluatedSamples', label: '成功对齐样本', children: trackingEvaluation.summary.evaluatedSamples },
                  { key: 'hits', label: '命中数', children: trackingEvaluation.summary.hits },
                  { key: 'accuracy', label: '综合胜率', children: toPercent(trackingEvaluation.summary.accuracy) },
                  {
                    key: 'bullish',
                    label: '看多胜率',
                    children: `${toPercent(trackingEvaluation.summary.bullish.accuracy)} (${trackingEvaluation.summary.bullish.hits}/${trackingEvaluation.summary.bullish.samples})`
                  },
                  {
                    key: 'bearish',
                    label: '看空胜率',
                    children: `${toPercent(trackingEvaluation.summary.bearish.accuracy)} (${trackingEvaluation.summary.bearish.hits}/${trackingEvaluation.summary.bearish.samples})`
                  },
                  { key: 'insufficientData', label: '数据不足样本', children: trackingEvaluation.summary.insufficientData }
                ]}
              />
            </Card>

            <Card size="small" title="操作归因统计（买入/卖出）">
              <Descriptions
                size="small"
                column={3}
                items={[
                  { key: 'totalActions', label: '操作总数', children: actionSummary.totalActions },
                  { key: 'buyActions', label: '买入次数', children: actionSummary.buyActions },
                  { key: 'sellActions', label: '卖出次数', children: actionSummary.sellActions },
                  { key: 'evaluatedActionSamples', label: '成功对齐样本', children: actionSummary.evaluatedSamples },
                  { key: 'actionAccuracy', label: '操作胜率', children: toPercent(actionSummary.accuracy) },
                  { key: 'buyAccuracy', label: '买入胜率', children: toPercent(actionSummary.buyAccuracy) },
                  { key: 'sellAccuracy', label: '卖出胜率', children: toPercent(actionSummary.sellAccuracy) },
                  {
                    key: 'alignmentRate',
                    label: '知行一致率',
                    children: `${toPercent(actionSummary.alignmentRate)} (${actionSummary.alignedWithViewpoint}/${actionSummary.viewpointLinkedActions})`
                  },
                  { key: 'actionInsufficientData', label: '数据不足样本', children: actionSummary.insufficientData }
                ]}
              />
            </Card>

            <Card title={`事件判定明细（${trackingEvaluation.results.length} 条）`} size="small">
              <div ref={predictionTableRef}>
                <Table<ReviewEventResult>
                  rowKey={(record) => record.entryId}
                  columns={columns}
                  dataSource={trackingEvaluation.results}
                  pagination={{
                    pageSize: PAGE_SIZE,
                    current: predictionPage,
                    onChange: (page) => setPredictionPage(page)
                  }}
                  onRow={(record) => ({
                    onClick: () => selectEntry(record.entryId, 'prediction'),
                    style: {
                      cursor: 'pointer',
                      backgroundColor: activeEntryId === record.entryId ? '#eff6ff' : undefined
                    }
                  })}
                  scroll={{ x: 1080 }}
                  size="small"
                />
              </div>
            </Card>

            <Card title={`操作归因明细（${actionResults.length} 条）`} size="small">
              <div ref={actionTableRef}>
                <Table<ReviewActionResult>
                  rowKey={(record) => record.entryId}
                  columns={actionColumns}
                  dataSource={actionResults}
                  pagination={{
                    pageSize: PAGE_SIZE,
                    current: actionPage,
                    onChange: (page) => setActionPage(page)
                  }}
                  onRow={(record) => ({
                    onClick: () => selectEntry(record.entryId, 'action'),
                    style: {
                      cursor: 'pointer',
                      backgroundColor: activeEntryId === record.entryId ? '#f0fdf4' : undefined
                    }
                  })}
                  scroll={{ x: 1140 }}
                  size="small"
                />
              </div>
            </Card>
          </Space>
        ) : (
          <Space direction="vertical" size="middle" className="w-full">
            {perfStats ? (
              <Card size="small" title="本次计算性能">
                <Descriptions
                  size="small"
                  column={4}
                  items={[
                    { key: 'totalMs', label: '总耗时', children: `${perfStats.totalMs} ms` },
                    { key: 'collectMs', label: '索引查询耗时', children: `${perfStats.collectMs} ms` },
                    { key: 'marketDataMs', label: '行情拉取耗时', children: `${perfStats.marketDataMs} ms` },
                    { key: 'evaluateMs', label: '评估计算耗时', children: `${perfStats.evaluateMs} ms` },
                    { key: 'indexedHitCount', label: '索引命中量', children: perfStats.indexedHitCount },
                    { key: 'indexedMatchedStocks', label: '索引命中股票数', children: perfStats.indexedMatchedStocks },
                    { key: 'participatingStocks', label: '参与股票数', children: perfStats.participatingStocks },
                    { key: 'source', label: '数据源', children: 'notes-index' }
                  ]}
                />
              </Card>
            ) : null}

            <Card size="small" title="全市场预测质量总览">
              <Descriptions
                size="small"
                column={3}
                items={[
                  { key: 'totalNotes', label: '总笔记', children: trackingEvaluation.summary.totalNotes },
                  { key: 'actionableNotes', label: '可评估样本', children: trackingEvaluation.summary.actionableNotes },
                  { key: 'evaluatedSamples', label: '成功对齐样本', children: trackingEvaluation.summary.evaluatedSamples },
                  { key: 'hits', label: '命中数', children: trackingEvaluation.summary.hits },
                  { key: 'accuracy', label: '综合胜率', children: toPercent(trackingEvaluation.summary.accuracy) },
                  { key: 'unknownNotes', label: '未知观点', children: trackingEvaluation.summary.unknownNotes },
                  {
                    key: 'bullish',
                    label: '看多胜率',
                    children: `${toPercent(trackingEvaluation.summary.bullish.accuracy)} (${trackingEvaluation.summary.bullish.hits}/${trackingEvaluation.summary.bullish.samples})`
                  },
                  {
                    key: 'bearish',
                    label: '看空胜率',
                    children: `${toPercent(trackingEvaluation.summary.bearish.accuracy)} (${trackingEvaluation.summary.bearish.hits}/${trackingEvaluation.summary.bearish.samples})`
                  },
                  { key: 'insufficientData', label: '数据不足样本', children: trackingEvaluation.summary.insufficientData }
                ]}
              />
            </Card>

            <Card size="small" title="全市场操作质量总览">
              <Descriptions
                size="small"
                column={3}
                items={[
                  { key: 'totalActions', label: '操作总数', children: actionSummary.totalActions },
                  { key: 'buyActions', label: '买入次数', children: actionSummary.buyActions },
                  { key: 'sellActions', label: '卖出次数', children: actionSummary.sellActions },
                  { key: 'evaluatedActionSamples', label: '成功对齐样本', children: actionSummary.evaluatedSamples },
                  { key: 'actionAccuracy', label: '操作胜率', children: toPercent(actionSummary.accuracy) },
                  { key: 'buyAccuracy', label: '买入胜率', children: toPercent(actionSummary.buyAccuracy) },
                  { key: 'sellAccuracy', label: '卖出胜率', children: toPercent(actionSummary.sellAccuracy) },
                  {
                    key: 'alignmentRate',
                    label: '知行一致率',
                    children: `${toPercent(actionSummary.alignmentRate)} (${actionSummary.alignedWithViewpoint}/${actionSummary.viewpointLinkedActions})`
                  },
                  { key: 'actionInsufficientData', label: '数据不足样本', children: actionSummary.insufficientData }
                ]}
              />
            </Card>

            <Card size="small" title="每日决策质量趋势">
              <OverallQualityTrendChart data={dailyQualityTrend} />
            </Card>

            <Card size="small" title={`每日质量明细（近两周，${dailyQuality.length} 天）`}>
              <Table<ReviewDailyQualityItem>
                rowKey={(record) => record.date}
                columns={dailyQualityColumns}
                dataSource={dailyQuality}
                pagination={{ pageSize: 14, hideOnSinglePage: true }}
                expandable={{
                  expandedRowRender: (record) => (
                    <Table<ReviewDailyActionDetailItem>
                      rowKey={(item) => item.entryId}
                      size="small"
                      pagination={false}
                      columns={[
                        {
                          title: '时间',
                          dataIndex: 'eventTime',
                          width: 144,
                          render: (value: string) => dayjs(value).format('MM-DD HH:mm')
                        },
                        {
                          title: '股票',
                          dataIndex: 'stockCode',
                          width: 170,
                          render: (value: string) => renderStockLabel(value)
                        },
                        {
                          title: '类型',
                          dataIndex: 'operationTag',
                          width: 80,
                          render: (value: '买入' | '卖出') => (
                            <Tag color={value === '买入' ? 'red' : 'green'}>{value}</Tag>
                          )
                        },
                        {
                          title: '观点一致',
                          dataIndex: 'alignedWithViewpoint',
                          width: 96,
                          render: (value: boolean | null) => {
                            if (value === null) return <Tag>未知</Tag>
                            return <Tag color={value ? 'success' : 'warning'}>{value ? '一致' : '不一致'}</Tag>
                          }
                        },
                        {
                          title: '结果',
                          dataIndex: 'hit',
                          width: 80,
                          render: (value: boolean) => (
                            <Tag color={value ? 'success' : 'error'}>{value ? '命中' : '未命中'}</Tag>
                          )
                        },
                        {
                          title: '涨跌幅',
                          dataIndex: 'changePct',
                          width: 92,
                          render: (value: number) => {
                            const color = value >= 0 ? '#ef4444' : '#22c55e'
                            return <span style={{ color }}>{value.toFixed(2)}%</span>
                          }
                        },
                        {
                          title: '说明',
                          dataIndex: 'reason',
                          ellipsis: true,
                          render: (value: string) => (
                            <Tooltip title={value}>
                              <span>{value}</span>
                            </Tooltip>
                          )
                        }
                      ]}
                      dataSource={record.actionDetails || []}
                      locale={{ emptyText: '当日暂无可评估买卖执行记录' }}
                      scroll={{ x: 920 }}
                    />
                  ),
                  rowExpandable: (record) => (record.actionDetails || []).length > 0
                }}
                scroll={{ x: 1240 }}
                size="small"
              />
            </Card>
          </Space>
        )}
      </div>
    </div>
  )
}

function toPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%'
  return `${value.toFixed(2)}%`
}

function normalizeStockCode(stockCode: string): string | null {
  const normalized = String(stockCode || '').trim().toUpperCase()
  if (!normalized) return null
  const prefixed = normalized.match(/^(SH|SZ|BJ)(\d{6})$/)
  if (prefixed) {
    return prefixed[2]
  }
  const rawCode = normalized.match(/^(\d{6})$/)
  if (rawCode) {
    return rawCode[1]
  }
  return normalized
}

export default ViewpointTrackingView
