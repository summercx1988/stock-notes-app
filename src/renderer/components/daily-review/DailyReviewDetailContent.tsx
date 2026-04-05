import React from 'react'
import { Card, Descriptions, Space, Tag, Typography } from 'antd'
import { AlertOutlined, BulbOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { TimeEntry } from '../../../shared/types'
import type { DailySummaryData, ParsedCache } from './types'

const { Text, Paragraph } = Typography

interface DailyReviewDetailContentProps {
  entry: TimeEntry
  parsed: ParsedCache
  getEntryRawText: (entry: TimeEntry) => string
}

const sentimentColorMap: Record<string, string> = {
  乐观: 'red',
  谨慎: 'orange',
  悲观: 'green',
  中性: 'blue'
}

const riskLevelColorMap: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'blue'
}

const riskLevelLabelMap: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险'
}

const actionColorMap: Record<string, string> = {
  买入: 'red',
  卖出: 'green',
  观望: 'default'
}

const renderGenerationMeta = (parsed: ParsedCache) => {
  const meta = parsed.meta
  if (!meta) return null

  return (
    <Space wrap size={[8, 8]}>
      <Tag color={meta.generationMode === 'hybrid' ? 'processing' : 'default'}>
        {meta.generationMode === 'hybrid' ? 'AI 增强' : '本地复盘'}
      </Tag>
      <Tag color={meta.aiStatus === 'completed' ? 'success' : meta.aiStatus === 'fallback' ? 'warning' : 'default'}>
        {meta.aiStatus === 'completed' ? '增强完成' : meta.aiStatus === 'fallback' ? 'AI 失败已保留本地结果' : '本地草稿'}
      </Tag>
      {meta.lookbackDays ? <Tag>分析窗口 T-{meta.lookbackDays}</Tag> : null}
      {meta.note ? <Text type="secondary">{meta.note}</Text> : null}
    </Space>
  )
}

const renderRelatedEntries = (data: DailySummaryData) => {
  if (!Array.isArray(data.relatedEntries) || data.relatedEntries.length === 0) return null
  return (
    <div>
      <Text strong>📚 关联近期笔记</Text>
      <div className="mt-2 space-y-2">
        {data.relatedEntries.slice(0, 8).map((item) => (
          <div key={item.entryId} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <Space wrap>
              <Tag>{item.category}</Tag>
              <Text strong>{item.stockName}</Text>
              <Text type="secondary">({item.stockCode})</Text>
              <Text type="secondary">{dayjs(item.eventTime).format('MM-DD HH:mm')}</Text>
            </Space>
            <div className="mt-1">
              <Text type="secondary">{item.preview}</Text>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const DailyReviewDetailContent: React.FC<DailyReviewDetailContentProps> = ({ entry, parsed, getEntryRawText }) => {
  const displayCategory = parsed.resolvedCategory

  if (displayCategory === '每日总结') {
    const data = parsed.summaryData
    if (!data) {
      return (
        <pre className="bg-gray-50 p-3 rounded overflow-auto max-h-[560px] text-xs whitespace-pre-wrap">
          {getEntryRawText(entry) || '无内容'}
        </pre>
      )
    }

    return (
      <Space direction="vertical" className="w-full" size="large">
        {renderGenerationMeta(parsed)}
        <Descriptions size="small" column={5}>
          <Descriptions.Item label="笔记数">{data.stats.totalNotes}</Descriptions.Item>
          <Descriptions.Item label="股票数">{data.stats.stocksCount}</Descriptions.Item>
          <Descriptions.Item label="买入">{data.stats.buyActions}</Descriptions.Item>
          <Descriptions.Item label="卖出">{data.stats.sellActions}</Descriptions.Item>
          <Descriptions.Item label="市场情绪">
            <Tag color={sentimentColorMap[data.content.marketSentiment] || 'default'}>{data.content.marketSentiment}</Tag>
          </Descriptions.Item>
        </Descriptions>

        <div>
          <Text strong>📝 复盘概述</Text>
          <Paragraph className="mt-2 mb-0">{data.content.overview}</Paragraph>
        </div>

        {data.content.keyDecisions.length > 0 && (
          <div>
            <Text strong>🔑 关键决策</Text>
            <div className="mt-2 space-y-2">
              {data.content.keyDecisions.map((decision, index) => (
                <Card key={`${decision.entryId}-${index}`} size="small" className="bg-gray-50">
                  <Space wrap>
                    <Tag color={actionColorMap[decision.action] || 'default'}>{decision.action}</Tag>
                    <Text strong>{decision.stockName}</Text>
                    <Text type="secondary">({decision.stockCode})</Text>
                    <Text type="secondary">信心 {(decision.confidence * 100).toFixed(0)}%</Text>
                  </Space>
                  <div className="mt-2">
                    <Text>{decision.reason}</Text>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {data.content.riskAlerts.length > 0 && (
          <div>
            <Text strong>⚠️ 风险提示</Text>
            <div className="mt-2 space-y-2">
              {data.content.riskAlerts.map((risk, index) => (
                <div key={`${risk.description}-${index}`} className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <Space wrap>
                    <Tag color={riskLevelColorMap[risk.level] || 'default'}>{riskLevelLabelMap[risk.level] || risk.level}</Tag>
                    <Text>{risk.description}</Text>
                  </Space>
                  {risk.suggestion ? (
                    <div className="mt-1">
                      <Text type="secondary">建议：{risk.suggestion}</Text>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.content.tomorrowFocus.length > 0 && (
          <div>
            <Text strong>🎯 明日关注</Text>
            <div className="mt-2 space-y-2">
              {data.content.tomorrowFocus.map((focus, index) => (
                <div key={`${focus.stockCode}-${index}`} className="flex items-start gap-2 rounded border border-gray-200 px-3 py-2">
                  <BulbOutlined className="mt-1" />
                  <div>
                    <Space wrap>
                      <Text strong>{focus.stockName}</Text>
                      <Text type="secondary">({focus.stockCode})</Text>
                      <Tag>{focus.actionType}</Tag>
                    </Space>
                    <div className="mt-1">
                      <Text>{focus.reason}</Text>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {renderRelatedEntries(data)}
      </Space>
    )
  }

  if (displayCategory === '盘前复习') {
    const data = parsed.preMarketData
    if (!data) {
      return (
        <pre className="bg-gray-50 p-3 rounded overflow-auto max-h-[560px] text-xs whitespace-pre-wrap">
          {getEntryRawText(entry) || '无内容'}
        </pre>
      )
    }

    return (
      <Space direction="vertical" className="w-full" size="large">
        {renderGenerationMeta(parsed)}
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="来源复盘日">{data.sourceSummaryDate || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="待跟进">{data.quickReview.pendingItems.length}</Descriptions.Item>
          <Descriptions.Item label="观察列表">{data.todayStrategy.watchlist.length}</Descriptions.Item>
        </Descriptions>

        <div>
          <Text strong>📋 昨日概要</Text>
          <Paragraph className="mt-2 mb-0">{data.quickReview.yesterdaySummary}</Paragraph>
        </div>

        {data.quickReview.pendingItems.length > 0 && (
          <div>
            <Text strong>🔴 待跟进事项</Text>
            <div className="mt-2 space-y-2">
              {data.quickReview.pendingItems.map((item, index) => (
                <div key={`${item.sourceEntryId}-${index}`} className="rounded border border-gray-200 px-3 py-2">
                  <Space wrap>
                    <Tag color={item.priority === 'high' ? 'red' : item.priority === 'medium' ? 'orange' : 'blue'}>
                      {item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低'}
                    </Tag>
                    <Text strong>{item.stockName}</Text>
                    <Text type="secondary">({item.stockCode})</Text>
                  </Space>
                  <div className="mt-1">
                    <Text>{item.description}</Text>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.todayStrategy.focusAreas.length > 0 && (
          <div>
            <Text strong>🎯 今日重点</Text>
            <div className="mt-2 space-y-1">
              {data.todayStrategy.focusAreas.map((item, index) => (
                <div key={`${item}-${index}`} className="flex items-center gap-2">
                  <BulbOutlined />
                  <Text>{item}</Text>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.todayStrategy.watchlist.length > 0 && (
          <div>
            <Text strong>👀 观察列表</Text>
            <div className="mt-2 space-y-2">
              {data.todayStrategy.watchlist.map((item, index) => (
                <div key={`${item.stockCode}-${index}`} className="rounded border border-gray-200 px-3 py-2">
                  <Space wrap>
                    <EyeOutlined />
                    <Text strong>{item.stockName}</Text>
                    <Text type="secondary">({item.stockCode})</Text>
                  </Space>
                  <div className="mt-1">
                    <Text>{item.reason}</Text>
                  </div>
                  <div className="mt-1">
                    <Text type="secondary">预期动作：{item.expectedAction}</Text>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.todayStrategy.riskReminders.length > 0 && (
          <div>
            <Text strong>⚠️ 风险提醒</Text>
            <div className="mt-2 space-y-1">
              {data.todayStrategy.riskReminders.map((item, index) => (
                <div key={`${item}-${index}`} className="flex items-start gap-2">
                  <AlertOutlined className="mt-1" />
                  <Text>{item}</Text>
                </div>
              ))}
            </div>
          </div>
        )}
      </Space>
    )
  }

  if (parsed.raw) {
    return (
      <pre className="bg-gray-50 p-3 rounded overflow-auto max-h-[560px] text-xs whitespace-pre-wrap">
        {JSON.stringify(parsed.raw, null, 2)}
      </pre>
    )
  }

  return (
    <pre className="bg-gray-50 p-3 rounded overflow-auto max-h-[560px] text-xs whitespace-pre-wrap">
      {getEntryRawText(entry) || '无内容'}
    </pre>
  )
}

export default DailyReviewDetailContent
