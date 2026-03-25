import React, { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  message
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { KlineInterval, ReviewActionResult, ReviewEvaluateResponse, ReviewEventResult, ReviewScope } from '../../shared/types'

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
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(30, 'day').startOf('day'),
    dayjs().endOf('day')
  ])
  const [evaluation, setEvaluation] = useState<ReviewEvaluateResponse | null>(null)
  const [running, setRunning] = useState(false)

  const selectedScopeLabel = useMemo(() => {
    if (scope === 'single') {
      return currentStockCode ? `${currentStockName || currentStockCode}（${currentStockCode}）` : '未选择股票'
    }
    return '全股票综合'
  }, [currentStockCode, currentStockName, scope])

  const handleRunReview = async () => {
    if (scope === 'single' && !currentStockCode) {
      message.warning('请先在左侧选择一只股票')
      return
    }

    setRunning(true)
    try {
      const result = await window.api.review.evaluate({
        scope,
        stockCode: scope === 'single' ? currentStockCode || undefined : undefined,
        startDate: timeRange?.[0]?.toISOString(),
        endDate: timeRange?.[1]?.toISOString(),
        interval,
        rule: {
          windowDays: 3,
          thresholdPct: 3,
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
        <Tag color={value === '看多' ? 'red' : 'green'}>{value}</Tag>
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
              { label: '日线', value: '1d' }
            ]}
          />

          <Tag color="processing">规则: 3D / 3%</Tag>

          <Button type="primary" loading={running} onClick={handleRunReview}>
            开始复盘
          </Button>
        </Space>
      </div>

      <div className="p-4 overflow-auto">
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="预测复盘统计“看盘预测”类别；操作归因统计所有“买入/卖出”打标事件。两者都按事件时间对齐 K 线，默认规则为 3D / 3%。"
        />

        {!evaluation ? (
          <Empty description="设置范围后点击“开始复盘”" />
        ) : (
          <Space direction="vertical" size="middle" className="w-full">
            <Row gutter={12}>
              <Col span={4}>
                <Card>
                  <Statistic title="总笔记" value={evaluation.summary.totalNotes} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="未知观点" value={evaluation.summary.unknownNotes} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="可评估样本" value={evaluation.summary.actionableNotes} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="成功对齐样本" value={evaluation.summary.evaluatedSamples} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="命中数" value={evaluation.summary.hits} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="综合胜率" value={evaluation.summary.accuracy} suffix="%" />
                </Card>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col span={8}>
                <Card>
                  <Statistic title="看多胜率" value={evaluation.summary.bullish.accuracy} suffix="%" />
                  <div className="mt-2 text-xs text-gray-500">
                    {evaluation.summary.bullish.hits} / {evaluation.summary.bullish.samples}
                  </div>
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic title="看空胜率" value={evaluation.summary.bearish.accuracy} suffix="%" />
                  <div className="mt-2 text-xs text-gray-500">
                    {evaluation.summary.bearish.hits} / {evaluation.summary.bearish.samples}
                  </div>
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic title="数据不足样本" value={evaluation.summary.insufficientData} />
                </Card>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col span={4}>
                <Card>
                  <Statistic title="操作总数" value={actionSummary.totalActions} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="买入次数" value={actionSummary.buyActions} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="卖出次数" value={actionSummary.sellActions} />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="操作胜率" value={actionSummary.accuracy} suffix="%" />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="买入胜率" value={actionSummary.buyAccuracy} suffix="%" />
                </Card>
              </Col>
              <Col span={4}>
                <Card>
                  <Statistic title="知行一致率" value={actionSummary.alignmentRate} suffix="%" />
                </Card>
              </Col>
            </Row>

            <Card title={`事件判定明细（${evaluation.results.length} 条）`} size="small">
              <Table<ReviewEventResult>
                rowKey={(record) => `${record.stockCode}-${record.entryId}-${record.eventTime}`}
                columns={columns}
                dataSource={evaluation.results}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 980 }}
                size="small"
              />
            </Card>

            <Card title={`操作归因明细（${actionResults.length} 条）`} size="small">
              <Table<ReviewActionResult>
                rowKey={(record) => `${record.stockCode}-${record.entryId}-${record.eventTime}`}
                columns={actionColumns}
                dataSource={actionResults}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 1050 }}
                size="small"
              />
            </Card>
          </Space>
        )}
      </div>
    </div>
  )
}

export default ReviewAnalysisView
