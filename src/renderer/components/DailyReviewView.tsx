import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Empty,
  message,
  Popconfirm,
  Progress,
  Space,
  Tag,
  Typography
} from 'antd'
import {
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  AlertOutlined,
  BulbOutlined,
  EyeOutlined,
  InboxOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type {
  DailyReviewGenerationProgress,
  DailyReviewGenerationStatus,
  TimeEntry,
  UserSettings
} from '../../shared/types'

const { Title, Text, Paragraph } = Typography
const HISTORY_LOOKBACK_DAYS = 30

interface ReviewGenerationMeta {
  generationMode?: 'local' | 'hybrid'
  aiStatus?: 'pending' | 'completed' | 'fallback'
  lookbackDays?: number
  note?: string
}

interface DailySummaryData {
  version: string
  generatedAt: string
  meta?: ReviewGenerationMeta
  stats: {
    totalNotes: number
    stocksCount: number
    buyActions: number
    sellActions: number
    bullishNotes: number
    bearishNotes: number
  }
  content: {
    overview: string
    keyDecisions: Array<{
      stockCode: string
      stockName: string
      action: string
      reason: string
      confidence: number
      entryId: string
    }>
    riskAlerts: Array<{
      level: string
      description: string
      relatedStocks: string[]
      suggestion: string
    }>
    tomorrowFocus: Array<{
      stockCode: string
      stockName: string
      reason: string
      actionType: string
      sourceEntryId?: string
    }>
    marketSentiment: string
  }
  relatedEntries?: Array<{
    entryId: string
    stockCode: string
    stockName: string
    eventTime: string
    category: string
    viewpoint: string
    preview: string
  }>
}

interface PreMarketData {
  version: string
  generatedAt: string
  sourceSummaryDate: string
  meta?: ReviewGenerationMeta
  quickReview: {
    yesterdaySummary: string
    pendingItems: Array<{
      stockCode: string
      stockName: string
      description: string
      priority: string
      dueDate: string
      sourceEntryId: string
    }>
    keyLevels: Array<{
      stockCode: string
      stockName: string
      level: string
      price: number
      note: string
    }>
  }
  todayStrategy: {
    focusAreas: string[]
    watchlist: Array<{
      stockCode: string
      stockName: string
      reason: string
      expectedAction: string
    }>
    riskReminders: string[]
  }
}

type JsonObject = Record<string, unknown>

interface ParsedCache {
  raw: JsonObject | null
  meta: ReviewGenerationMeta | null
  summaryData: DailySummaryData | null
  preMarketData: PreMarketData | null
}

const parseJSONContent = <T,>(entry: TimeEntry): T | null => {
  try {
    return JSON.parse(entry.content) as T
  } catch {
    return null
  }
}

const getEntryMeta = (entry: TimeEntry): ReviewGenerationMeta | null => {
  const parsed = parseJSONContent<JsonObject>(entry)
  if (!parsed || typeof parsed.meta !== 'object' || parsed.meta === null) return null
  return parsed.meta as ReviewGenerationMeta
}

const DailyReviewView: React.FC = () => {
  const [historyEntries, setHistoryEntries] = useState<TimeEntry[]>([])
  const [generating, setGenerating] = useState(false)
  const [collectingEntryId, setCollectingEntryId] = useState<string | null>(null)
  const [analysisLookbackDays, setAnalysisLookbackDays] = useState(3)
  const [taskProgress, setTaskProgress] = useState<DailyReviewGenerationProgress | null>(null)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<DailyReviewGenerationStatus | null>(null)

  const parsedCacheRef = useRef<Map<string, ParsedCache>>(new Map())
  const loadDataRef = useRef<() => Promise<void>>()

  const getEntryRawText = (entry: TimeEntry): string => String(entry.content || '').trim()

  const getOrParseEntry = useCallback((entry: TimeEntry): ParsedCache => {
    const cached = parsedCacheRef.current.get(entry.id)
    if (cached) return cached

    const raw = parseJSONContent<JsonObject>(entry)
    const meta = raw && typeof raw.meta === 'object' && raw.meta !== null ? raw.meta as ReviewGenerationMeta : null
    const summaryData = parseJSONContent<DailySummaryData>(entry)
    const preMarketData = parseJSONContent<PreMarketData>(entry)

    const result: ParsedCache = { raw, meta, summaryData, preMarketData }
    parsedCacheRef.current.set(entry.id, result)
    return result
  }, [])

  const clearParsedCache = useCallback(() => {
    parsedCacheRef.current.clear()
  }, [])

  const loadData = useCallback(async () => {
    try {
      const dailyReview = await window.api.config.get('dailyReview') as UserSettings['dailyReview'] | undefined
      const lookbackDays = Math.max(1, Number(dailyReview?.analysisLookbackDays || 3))
      const historyStartDate = dayjs()
        .subtract(HISTORY_LOOKBACK_DAYS - 1, 'day')
        .startOf('day')
        .toISOString()
      const historyEndDate = new Date().toISOString()

      const [historyResult, generationStatusResult] = await Promise.all([
        window.api.dailyReview.getHistory(historyStartDate, historyEndDate),
        window.api.dailyReview.getGenerationStatus()
      ])

      const nextEntries = historyResult?.success && Array.isArray(historyResult.data)
        ? historyResult.data as TimeEntry[]
        : []

      clearParsedCache()
      setAnalysisLookbackDays(lookbackDays)
      setHistoryEntries(nextEntries)
      setGenerationStatus(generationStatusResult?.success ? generationStatusResult.data || null : null)
      setSelectedEntryIds((current) => current.filter((id) => nextEntries.some((entry) => entry.id === id)))
      setActiveEntryId((current) => {
        if (current && nextEntries.some((entry) => entry.id === current)) return current
        return nextEntries[0]?.id || null
      })
    } catch (error) {
      console.error('[DailyReviewView] Failed to load data:', error)
    }
  }, [clearParsedCache])

  loadDataRef.current = loadData

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    const unsubscribe = window.api.dailyReview.onGenerationProgress((payload) => {
      setTaskProgress(payload)
      if (payload.stage === 'completed' || payload.stage === 'error') {
        window.setTimeout(() => {
          setTaskProgress((current) => (current?.operation === payload.operation ? null : current))
        }, 1600)
      }
    })
    return () => { unsubscribe() }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.notes.onChanged(() => {
      void loadData()
    })
    return () => { unsubscribe() }
  }, [loadData])

  const activeEntry = useMemo(
    () => historyEntries.find((entry) => entry.id === activeEntryId) || null,
    [historyEntries, activeEntryId]
  )

  const showGenerationFeedback = useCallback((entry: TimeEntry, defaultText: string) => {
    const parsed = getOrParseEntry(entry)
    if (parsed.meta?.aiStatus === 'fallback') {
      message.warning(parsed.meta.note || `${defaultText}，AI 增强失败，已保留本地结果`)
      return
    }
    message.success(defaultText)
  }, [getOrParseEntry])

  const handleGenerateSummary = useCallback(async () => {
    setGenerating(true)
    setTaskProgress({
      operation: 'daily-summary',
      stage: 'start',
      progress: 1,
      message: '准备生成今日复盘'
    })
    try {
      const result = await window.api.dailyReview.generateSummary()
      if (result?.success) {
        const entry = result.data as TimeEntry
        setActiveEntryId(entry.id)
        showGenerationFeedback(entry, '今日复盘已生成')
        await loadData()
      } else {
        message.error(`生成失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }, [loadData, showGenerationFeedback])

  const handleGeneratePreMarket = useCallback(async () => {
    setGenerating(true)
    setTaskProgress({
      operation: 'pre-market',
      stage: 'start',
      progress: 1,
      message: '准备生成盘前复习'
    })
    try {
      const result = await window.api.dailyReview.generatePreMarket()
      if (result?.success) {
        const entry = result.data as TimeEntry
        setActiveEntryId(entry.id)
        showGenerationFeedback(entry, '盘前复习已生成')
        await loadData()
      } else {
        message.error(`生成失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }, [loadData, showGenerationFeedback])

  const handleMarkAsRead = useCallback(async (entryId: string) => {
    try {
      const result = await window.api.dailyReview.markAsRead(entryId)
      if (result?.success === false) {
        message.error(`操作失败: ${result?.error || '未知错误'}`)
        return
      }
      message.success('已标记为已读')
      await loadData()
    } catch (error: any) {
      message.error(`操作失败: ${error.message}`)
    }
  }, [loadData])

  const handleCollectToNotes = useCallback(async (entryId: string) => {
    setCollectingEntryId(entryId)
    setTaskProgress({
      operation: 'collect-to-notes',
      stage: 'start',
      progress: 1,
      message: '准备收录到股票笔记'
    })
    try {
      const result = await window.api.dailyReview.collectToNotes(entryId)
      if (result?.success) {
        const created = Number(result.data?.created || 0)
        message.success(created > 0 ? `已收录到 ${created} 条股票笔记` : '收录完成')
      } else {
        message.error(`收录失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`收录失败: ${error.message}`)
    } finally {
      setCollectingEntryId(null)
    }
  }, [])

  const handleRegenerate = useCallback(async (entryId: string) => {
    setGenerating(true)
    setTaskProgress({
      operation: 'regenerate',
      stage: 'start',
      progress: 1,
      message: '准备重新生成'
    })
    try {
      const result = await window.api.dailyReview.regenerate(entryId)
      if (result?.success) {
        const entry = result.data as TimeEntry
        setActiveEntryId(entry.id)
        showGenerationFeedback(entry, '复盘内容已更新')
        await loadData()
      } else {
        message.error(`重新生成失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`重新生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }, [loadData, showGenerationFeedback])

  const handleDeleteEntry = useCallback(async (entryId: string) => {
    try {
      const result = await window.api.dailyReview.deleteEntry(entryId)
      if (!result?.success) {
        message.error(`删除失败: ${result?.error || '未知错误'}`)
        return
      }
      message.success('已删除复盘记录')
      if (activeEntryId === entryId) {
        setActiveEntryId(null)
      }
      await loadData()
    } catch (error: any) {
      message.error(`删除失败: ${error.message}`)
    }
  }, [activeEntryId, loadData])

  const handleDeleteSelected = useCallback(async () => {
    if (selectedEntryIds.length === 0) return
    try {
      const result = await window.api.dailyReview.deleteEntries(selectedEntryIds)
      if (!result?.success) {
        message.error(`批量删除失败: ${result?.error || '未知错误'}`)
        return
      }
      const deleted = Number(result?.data?.deleted || 0)
      message.success(`已删除 ${deleted} 条复盘记录`)
      setSelectedEntryIds([])
      if (activeEntryId && selectedEntryIds.includes(activeEntryId)) {
        setActiveEntryId(null)
      }
      await loadData()
    } catch (error: any) {
      message.error(`批量删除失败: ${error.message}`)
    }
  }, [activeEntryId, loadData, selectedEntryIds])

  const handleToggleSelected = useCallback((entryId: string, checked: boolean) => {
    setSelectedEntryIds((current) => {
      if (checked) {
        return current.includes(entryId) ? current : [...current, entryId]
      }
      return current.filter((id) => id !== entryId)
    })
  }, [])

  const sentimentColorMap: Record<string, string> = useMemo(() => ({
    '乐观': 'red', '谨慎': 'orange', '悲观': 'green', '中性': 'blue'
  }), [])

  const riskLevelColorMap: Record<string, string> = useMemo(() => ({
    'high': 'red', 'medium': 'orange', 'low': 'blue'
  }), [])

  const riskLevelLabelMap: Record<string, string> = useMemo(() => ({
    'high': '高风险', 'medium': '中风险', 'low': '低风险'
  }), [])

  const actionColorMap: Record<string, string> = useMemo(() => ({
    '买入': 'red', '卖出': 'green', '观望': 'default'
  }), [])

  const renderSentimentTag = useCallback((sentiment: string) => {
    return <Tag color={sentimentColorMap[sentiment] || 'default'}>{sentiment}</Tag>
  }, [sentimentColorMap])

  const renderRiskLevel = useCallback((level: string) => {
    return <Tag color={riskLevelColorMap[level] || 'default'}>{riskLevelLabelMap[level] || level}</Tag>
  }, [riskLevelColorMap, riskLevelLabelMap])

  const renderActionTag = useCallback((action: string) => {
    return <Tag color={actionColorMap[action] || 'default'}>{action}</Tag>
  }, [actionColorMap])

  const renderGenerationMeta = useCallback((entry: TimeEntry) => {
    const parsed = getOrParseEntry(entry)
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
  }, [getOrParseEntry])

  const renderRelatedEntries = useCallback((data: DailySummaryData) => {
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
  }, [])

  const renderDetailContent = useCallback((entry: TimeEntry) => {
    const parsed = getOrParseEntry(entry)

    if (entry.category === '每日总结') {
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
          {renderGenerationMeta(entry)}
          <Descriptions size="small" column={5}>
            <Descriptions.Item label="笔记数">{data.stats.totalNotes}</Descriptions.Item>
            <Descriptions.Item label="股票数">{data.stats.stocksCount}</Descriptions.Item>
            <Descriptions.Item label="买入">{data.stats.buyActions}</Descriptions.Item>
            <Descriptions.Item label="卖出">{data.stats.sellActions}</Descriptions.Item>
            <Descriptions.Item label="市场情绪">
              {renderSentimentTag(data.content.marketSentiment)}
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
                      {renderActionTag(decision.action)}
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
                      {renderRiskLevel(risk.level)}
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

    if (entry.category === '盘前复习') {
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
          {renderGenerationMeta(entry)}
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
  }, [getOrParseEntry, getEntryRawText, renderGenerationMeta, renderSentimentTag, renderActionTag, renderRiskLevel, renderRelatedEntries])

  const operationLabelMap = useMemo(() => ({
    'daily-summary': '今日复盘',
    'pre-market': '盘前复习',
    'weekly': '周回顾',
    'regenerate': '重新生成',
    'collect-to-notes': '收录笔记'
  }), [])

  const formatStatusTime = useCallback((value: string | null | undefined): string => {
    if (!value) return '暂无'
    const formatted = dayjs(value)
    return formatted.isValid() ? formatted.format('YYYY-MM-DD HH:mm:ss') : '暂无'
  }, [])

  const historyRowRenderers = useMemo(() => {
    return historyEntries.map((entry) => {
      const parsed = getOrParseEntry(entry)
      const meta = parsed.meta

      return (
        <div
          key={entry.id}
          className={`rounded border p-3 transition-colors ${
            activeEntryId === entry.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <Space align="start">
              <Checkbox
                checked={selectedEntryIds.includes(entry.id)}
                onChange={(event) => handleToggleSelected(entry.id, event.target.checked)}
                onClick={(event) => event.stopPropagation()}
              />
              <div className="cursor-pointer" onClick={() => setActiveEntryId(entry.id)}>
                <Space wrap size={[6, 6]}>
                  <Tag color={entry.category === '每日总结' ? 'blue' : 'green'}>{entry.category}</Tag>
                  {entry.trackingStatus === '未读' ? <Tag color="processing">未读</Tag> : null}
                  {meta?.generationMode === 'local' ? <Tag>本地</Tag> : null}
                  {meta?.aiStatus === 'fallback' ? <Tag color="warning">AI失败</Tag> : null}
                </Space>
                <div className="mt-1">
                  <Text strong>{entry.title || '无标题'}</Text>
                </div>
                <div className="mt-1">
                  <Text type="secondary">{dayjs(entry.eventTime).format('YYYY-MM-DD HH:mm')}</Text>
                </div>
              </div>
            </Space>

            <Space>
              <Button size="small" type="link" onClick={() => setActiveEntryId(entry.id)}>
                查看
              </Button>
              <CheckCircleOutlined
                className="text-gray-400 hover:text-green-500 cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleMarkAsRead(entry.id)
                }}
              />
              <Popconfirm
                title="确认删除这条复盘记录？"
                okText="删除"
                cancelText="取消"
                onConfirm={() => void handleDeleteEntry(entry.id)}
              >
                <DeleteOutlined
                  className="text-gray-400 hover:text-red-500 cursor-pointer"
                  onClick={(event) => event.stopPropagation()}
                />
              </Popconfirm>
            </Space>
          </div>
        </div>
      )
    })
  }, [historyEntries, activeEntryId, selectedEntryIds, handleToggleSelected, handleMarkAsRead, handleDeleteEntry, getOrParseEntry])

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="border-b border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Space direction="vertical" size={2}>
            <Title level={4} className="m-0">📋 每日复盘</Title>
            <Text type="secondary">
              复盘分析只看近 {analysisLookbackDays} 天（T-{analysisLookbackDays}），日志展示最近 {HISTORY_LOOKBACK_DAYS} 天
            </Text>
          </Space>

          <Space wrap>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={generating}
              onClick={handleGenerateSummary}
            >
              生成今日复盘
            </Button>
            <Button
              size="small"
              icon={<ClockCircleOutlined />}
              loading={generating}
              onClick={handleGeneratePreMarket}
            >
              生成盘前复习
            </Button>
          </Space>
        </div>

        {generationStatus ? (
          <Card size="small" className="mt-3 bg-slate-50">
            <Descriptions size="small" column={3}>
              <Descriptions.Item label="笔记最后更新时间">
                {formatStatusTime(generationStatus.notesLastUpdatedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="上次日报生成时间">
                {formatStatusTime(generationStatus.dailySummaryLastGeneratedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="上次日报基准时间">
                {formatStatusTime(generationStatus.dailySummaryLastGeneratedFromUpdatedAt)}
              </Descriptions.Item>
            </Descriptions>
            <div className="mt-2">
              {generationStatus.hasPendingChanges ? (
                <Tag color="processing">检测到新的普通笔记，建议生成更新</Tag>
              ) : (
                <Tag color="default">笔记无变化，可按需决定是否重做</Tag>
              )}
            </div>
          </Card>
        ) : null}

        {taskProgress ? (
          <Card size="small" className="mt-3 bg-gray-50">
            <Space direction="vertical" className="w-full" size="small">
              <Text>
                {operationLabelMap[taskProgress.operation]}：{taskProgress.message}
              </Text>
              <Progress
                percent={Math.max(0, Math.min(100, Math.round(taskProgress.progress)))}
                status={
                  taskProgress.stage === 'error'
                    ? 'exception'
                    : taskProgress.stage === 'completed'
                      ? 'success'
                      : 'active'
                }
              />
            </Space>
          </Card>
        ) : null}
      </div>

      <div className="flex-1 overflow-hidden p-4">
        <div className="grid h-full gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card
            title={`🗂️ 复盘日志 (${historyEntries.length})`}
            extra={
              <Space>
                <Button
                  size="small"
                  onClick={async () => {
                    try {
                      const result = await window.api.dailyReview.markAllAsRead()
                      if (result?.success === false) {
                        message.error(`操作失败: ${result?.error || '未知错误'}`)
                        return
                      }
                      message.success('已全部标记为已读')
                      await loadData()
                    } catch (error: any) {
                      message.error(`操作失败: ${error.message}`)
                    }
                  }}
                >
                  全部已读
                </Button>
                <Popconfirm
                  title="确认删除已选复盘记录？"
                  okText="删除"
                  cancelText="取消"
                  disabled={selectedEntryIds.length === 0}
                  onConfirm={handleDeleteSelected}
                >
                  <Button
                    size="small"
                    danger
                    disabled={selectedEntryIds.length === 0}
                    icon={<DeleteOutlined />}
                  >
                    删除已选
                  </Button>
                </Popconfirm>
              </Space>
            }
            size="small"
            className="h-full"
            bodyStyle={{ height: 'calc(100% - 57px)', padding: 12 }}
          >
            {historyEntries.length > 0 ? (
              <div className="h-full space-y-2 overflow-auto pr-1">
                {historyRowRenderers}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty description="最近 30 天暂无复盘日志">
                  <Button
                    type="primary"
                    icon={<ReloadOutlined />}
                    loading={generating}
                    onClick={handleGenerateSummary}
                  >
                    生成今日复盘
                  </Button>
                </Empty>
              </div>
            )}
          </Card>

          <Card
            title={activeEntry ? (
              <Space wrap size={[8, 8]}>
                <span>{activeEntry.title || '复盘详情'}</span>
                <Tag color={activeEntry.category === '每日总结' ? 'blue' : 'green'}>{activeEntry.category}</Tag>
                {activeEntry.trackingStatus === '未读' ? <Tag color="processing">未读</Tag> : null}
                <Text type="secondary">{dayjs(activeEntry.eventTime).format('YYYY-MM-DD HH:mm')}</Text>
              </Space>
            ) : '复盘详情'}
            extra={activeEntry ? (
              <Space wrap>
                <Button size="small" onClick={() => void handleMarkAsRead(activeEntry.id)}>
                  标记已读
                </Button>
                <Button
                  size="small"
                  icon={<InboxOutlined />}
                  loading={collectingEntryId === activeEntry.id}
                  onClick={() => void handleCollectToNotes(activeEntry.id)}
                >
                  收录到笔记
                </Button>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={generating}
                  onClick={() => void handleRegenerate(activeEntry.id)}
                >
                  重新生成
                </Button>
                <Popconfirm
                  title="确认删除这条复盘记录？"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => void handleDeleteEntry(activeEntry.id)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ) : null}
            size="small"
            className="h-full"
            bodyStyle={{ height: 'calc(100% - 57px)', overflow: 'auto' }}
          >
            {activeEntry ? (
              renderDetailContent(activeEntry)
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty description="选择左侧一条复盘日志查看详情" />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default DailyReviewView
