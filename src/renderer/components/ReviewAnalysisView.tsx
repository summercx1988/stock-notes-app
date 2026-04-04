import React, { useCallback, useMemo, useRef, useState } from 'react'
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
  ReviewEvaluateResponse,
  ReviewEventResult,
  ReviewScope
} from '../../shared/types'
import ReviewKlineWorkbench from './review/ReviewKlineWorkbench'

const { RangePicker } = DatePicker
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

const ReviewAnalysisView: React.FC = () => {
  const { currentStockCode, currentStockName } = useAppStore()

  const [scope, setScope] = useState<ReviewScope>('single')
  const [interval, setInterval] = useState<KlineInterval>('5m')
  const [ruleWindowDays, setRuleWindowDays] = useState<number>(3)
  const [ruleThresholdPct, setRuleThresholdPct] = useState<number>(3)
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(30, 'day').startOf('day'),
    dayjs().endOf('day')
  ])
  const [evaluation, setEvaluation] = useState<ReviewEvaluateResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [predictionPage, setPredictionPage] = useState(1)
  const [actionPage, setActionPage] = useState(1)
  const predictionTableRef = useRef<HTMLDivElement | null>(null)
  const actionTableRef = useRef<HTMLDivElement | null>(null)
  const PAGE_SIZE = 10

  const selectedScopeLabel = useMemo(() => {
    if (scope === 'single') {
      return currentStockCode ? `${currentStockName || currentStockCode}（${currentStockCode}）` : '未选择股票'
    }
    return '全股票综合'
  }, [currentStockCode, currentStockName, scope])

  const predictionIndexByEntry = useMemo(() => {
    const map = new Map<string, number>()
    ;(evaluation?.results || []).forEach((item, index) => map.set(item.entryId, index))
    return map
  }, [evaluation?.results])

  const actionIndexByEntry = useMemo(() => {
    const map = new Map<string, number>()
    ;(evaluation?.actionResults || []).forEach((item, index) => map.set(item.entryId, index))
    return map
  }, [evaluation?.actionResults])

  const scrollToEntryRow = useCallback((entryId: string) => {
    const selectors = [predictionTableRef.current, actionTableRef.current]
    for (const container of selectors) {
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
      window.setTimeout(() => {
        scrollToEntryRow(entryId)
      }, 120)
    }
  }, [actionIndexByEntry, predictionIndexByEntry, scrollToEntryRow])

  const handleRunReview = async () => {
    if (scope === 'single' && !currentStockCode) {
      message.warning('请先在左侧选择一只股票')
      return
    }

    setRunning(true)
    setActiveEntryId(null)
    setPredictionPage(1)
    setActionPage(1)
    try {
      const result = await window.api.review.evaluate({
        scope,
        stockCode: scope === 'single' ? currentStockCode || undefined : undefined,
        startDate: timeRange?.[0]?.toISOString(),
        endDate: timeRange?.[1]?.toISOString(),
        interval,
        rule: {
          windowDays: ruleWindowDays,
          thresholdPct: ruleThresholdPct,
          excludeUnknown: true
        }
      })
      const normalizedResult: ReviewEvaluateResponse = {
        ...result,
        actionSummary: (result as Partial<ReviewEvaluateResponse>).actionSummary || DEFAULT_ACTION_SUMMARY,
        actionResults: (result as Partial<ReviewEvaluateResponse>).actionResults || []
      }
      setEvaluation(normalizedResult)
    } catch (error: any) {
      message.error(`复盘计算失败: ${error.message}`)
    } finally {
      setRunning(false)
    }
  }

  const columns = [
    {
      title: '股票',
      dataIndex: 'stockCode',
      width: 92
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
    {
      title: '入场价',
      dataIndex: 'entryPrice',
      width: 92
    },
    {
      title: '目标价',
      dataIndex: 'targetPrice',
      width: 92
    },
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
      render: (value: boolean) => (
        <Tag color={value ? 'success' : 'error'}>{value ? '命中' : '未命中'}</Tag>
      )
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

  const actionSummary = evaluation?.actionSummary || DEFAULT_ACTION_SUMMARY
  const actionResults = evaluation?.actionResults || []

  const actionColumns = [
    {
      title: '股票',
      dataIndex: 'stockCode',
      width: 92
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
    {
      title: '入场价',
      dataIndex: 'entryPrice',
      width: 92
    },
    {
      title: '目标价',
      dataIndex: 'targetPrice',
      width: 92
    },
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
      render: (value: boolean) => (
        <Tag color={value ? 'success' : 'error'}>{value ? '命中' : '未命中'}</Tag>
      )
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

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold m-0">复盘分析（Phase 3）</h2>
          <Tag color="blue">{selectedScopeLabel}</Tag>
        </div>

        <Space wrap size="middle">
          <Radio.Group
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: '单股票', value: 'single' },
              { label: '全股票综合', value: 'overall' }
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

          <Select
            value={interval}
            onChange={(value) => setInterval(value)}
            style={{ width: 120 }}
            options={[
              { label: '5 分钟', value: '5m' },
              { label: '15 分钟', value: '15m' },
              { label: '30 分钟', value: '30m' },
              { label: '60 分钟', value: '60m' }
            ]}
          />

          <InputNumber
            min={1}
            max={30}
            value={ruleWindowDays}
            onChange={(value) => setRuleWindowDays(Number(value) || 3)}
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
            value={ruleThresholdPct}
            onChange={(value) => setRuleThresholdPct(Number(value) || 3)}
            addonAfter="%"
            style={{ width: 120 }}
          />
          <Tooltip title="% 表示命中阈值。示例：3%=3 天窗口内涨跌幅达到正负 3% 记为命中。">
            <InfoCircleOutlined className="text-gray-400 cursor-help" />
          </Tooltip>

          <Tag color="processing">规则: {ruleWindowDays}D / {ruleThresholdPct}%</Tag>

          <Button type="primary" loading={running} onClick={handleRunReview}>
            开始复盘
          </Button>
        </Space>
        <div className="mt-2 text-xs text-gray-500">
          参数说明：D 为观察窗口天数，% 为命中阈值百分比。默认 3D / 3%。
        </div>
      </div>

      <div className="p-4 overflow-auto">
        <div className="mb-3 text-xs text-gray-500">
          预测复盘统计“看盘预测”类别；操作归因统计“买入/卖出”打标事件。
        </div>

        <Card title="K线与笔记对齐验证（独立模块）" size="small" className="mb-4">
          <ReviewKlineWorkbench
            key={`${scope}-${currentStockCode || 'overall'}-${timeRange?.[0]?.toISOString() || 'start'}-${timeRange?.[1]?.toISOString() || 'end'}`}
            scope={scope}
            stockCode={scope === 'single' ? currentStockCode || undefined : undefined}
            stockName={scope === 'single' ? currentStockName || undefined : undefined}
            startDate={timeRange?.[0]?.toISOString()}
            endDate={timeRange?.[1]?.toISOString()}
            selectedEntryId={activeEntryId}
            onMarkerSelect={(entryId) => selectEntry(entryId, 'chart')}
            onNoteSaved={() => {
              if (evaluation) {
                void handleRunReview()
              }
            }}
          />
        </Card>

        {!evaluation ? (
          <Empty description="设置范围后点击“开始复盘”" />
        ) : (
          <Space direction="vertical" size="middle" className="w-full">
            <Card
              size="small"
              title={(
                <Space size={6}>
                  <span>预测统计（看盘预测）</span>
                  <Tooltip title="标签说明：看多=预期上涨；看空=预期下跌；未知/震荡不计入胜率">
                    <InfoCircleOutlined />
                  </Tooltip>
                </Space>
              )}
            >
              <Descriptions
                size="small"
                column={3}
                items={[
                  { key: 'totalNotes', label: '总笔记', children: evaluation.summary.totalNotes },
                  { key: 'unknownNotes', label: '未知观点', children: evaluation.summary.unknownNotes },
                  { key: 'actionableNotes', label: '可评估样本', children: evaluation.summary.actionableNotes },
                  { key: 'evaluatedSamples', label: '成功对齐样本', children: evaluation.summary.evaluatedSamples },
                  { key: 'hits', label: '命中数', children: evaluation.summary.hits },
                  { key: 'accuracy', label: '综合胜率', children: `${evaluation.summary.accuracy}%` },
                  {
                    key: 'bullish',
                    label: '看多胜率',
                    children: `${evaluation.summary.bullish.accuracy}% (${evaluation.summary.bullish.hits}/${evaluation.summary.bullish.samples})`
                  },
                  {
                    key: 'bearish',
                    label: '看空胜率',
                    children: `${evaluation.summary.bearish.accuracy}% (${evaluation.summary.bearish.hits}/${evaluation.summary.bearish.samples})`
                  },
                  { key: 'insufficientData', label: '数据不足样本', children: evaluation.summary.insufficientData }
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
                  { key: 'actionAccuracy', label: '操作胜率', children: `${actionSummary.accuracy}%` },
                  { key: 'buyAccuracy', label: '买入胜率', children: `${actionSummary.buyAccuracy}%` },
                  { key: 'sellAccuracy', label: '卖出胜率', children: `${actionSummary.sellAccuracy}%` },
                  {
                    key: 'alignmentRate',
                    label: '知行一致率',
                    children: `${actionSummary.alignmentRate}% (${actionSummary.alignedWithViewpoint}/${actionSummary.viewpointLinkedActions})`
                  },
                  { key: 'actionInsufficientData', label: '数据不足样本', children: actionSummary.insufficientData }
                ]}
              />
            </Card>

            <Card title={`事件判定明细（${evaluation.results.length} 条）`} size="small">
              <div ref={predictionTableRef}>
                <Table<ReviewEventResult>
                  rowKey={(record) => record.entryId}
                  columns={columns}
                  dataSource={evaluation.results}
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
                  scroll={{ x: 980 }}
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
                  scroll={{ x: 1050 }}
                  size="small"
                />
              </div>
            </Card>
          </Space>
        )}
      </div>
    </div>
  )
}

export default ReviewAnalysisView
