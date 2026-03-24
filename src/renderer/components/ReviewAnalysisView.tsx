import React, { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, DatePicker, Empty, Radio, Row, Select, Space, Statistic, Tag, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { KlineInterval, ReviewScope, ReviewSnapshot } from '../../shared/types'

const { RangePicker } = DatePicker

const ReviewAnalysisView: React.FC = () => {
  const { currentStockCode, currentStockName } = useAppStore()

  const [scope, setScope] = useState<ReviewScope>('single')
  const [interval, setInterval] = useState<KlineInterval>('5m')
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(30, 'day').startOf('day'),
    dayjs().endOf('day')
  ])
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<string>('')

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
      const result = await window.api.review.getSnapshot({
        scope,
        stockCode: scope === 'single' ? currentStockCode || undefined : undefined,
        startDate: timeRange?.[0]?.toISOString(),
        endDate: timeRange?.[1]?.toISOString(),
        interval
      })
      setSnapshot(result.snapshot)
      setLastRun(dayjs(result.generatedAt).format('YYYY-MM-DD HH:mm:ss'))
    } catch (error: any) {
      message.error(`复盘计算失败: ${error.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold m-0">复盘分析（基础版）</h2>
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
          message="当前统计由主进程 review 用例统一计算（UI/CLI可复用同一逻辑）。K线拉取与命中判定将在下一阶段接入。"
        />

        {!snapshot ? (
          <Empty description="设置范围后点击“开始复盘”" />
        ) : (
          <Space direction="vertical" size="middle" className="w-full">
            <Row gutter={12}>
              <Col span={6}>
                <Card>
                  <Statistic title="总样本" value={snapshot.total} />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic title="看多样本" value={snapshot.bullish} />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic title="看空样本" value={snapshot.bearish} />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic title="未知样本" value={snapshot.unknown} />
                </Card>
              </Col>
            </Row>

            <Row gutter={12}>
              <Col span={8}>
                <Card>
                  <Statistic
                    title="可评估样本（看多+看空）"
                    value={snapshot.actionable}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title="综合胜率"
                    value="待接入K线"
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card>
                  <Statistic
                    title="最近一次运行"
                    value={lastRun || '-'}
                    valueStyle={{ fontSize: 16 }}
                  />
                </Card>
              </Col>
            </Row>
          </Space>
        )}
      </div>
    </div>
  )
}

export default ReviewAnalysisView
