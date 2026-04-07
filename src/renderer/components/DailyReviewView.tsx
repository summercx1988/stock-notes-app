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
  DeleteOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type {
  DailyReviewGenerationProgress,
  DailyReviewGenerationStatus,
  TimeEntry,
  UserSettings
} from '../../shared/types'
import DailyReviewDetailContent from './daily-review/DailyReviewDetailContent'
import DailyReviewHistoryList from './daily-review/DailyReviewHistoryList'
import { parseReviewEntry, type ParsedCache } from './daily-review/types'

const { Title, Text } = Typography
const HISTORY_LOOKBACK_DAYS = 14
const ARCHIVE_VIEW_LOOKBACK_DAYS = 180

const DailyReviewView: React.FC = () => {
  const [historyEntries, setHistoryEntries] = useState<TimeEntry[]>([])
  const [generating, setGenerating] = useState(false)
  const [archivingEntryId, setArchivingEntryId] = useState<string | null>(null)
  const [archivingHistory, setArchivingHistory] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [analysisLookbackDays, setAnalysisLookbackDays] = useState(3)
  const [taskProgress, setTaskProgress] = useState<DailyReviewGenerationProgress | null>(null)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [generationStatus, setGenerationStatus] = useState<DailyReviewGenerationStatus | null>(null)

  const parsedCacheRef = useRef<Map<string, ParsedCache>>(new Map())
  const loadDataRef = useRef<() => Promise<void>>()
  const loadRequestSeqRef = useRef(0)

  const getEntryRawText = (entry: TimeEntry): string => String(entry.content || '').trim()

  const getOrParseEntry = useCallback((entry: TimeEntry): ParsedCache => {
    const cached = parsedCacheRef.current.get(entry.id)
    if (cached) return cached

    const result = parseReviewEntry(entry)
    parsedCacheRef.current.set(entry.id, result)
    return result
  }, [])

  const clearParsedCache = useCallback(() => {
    parsedCacheRef.current.clear()
  }, [])

  const loadData = useCallback(async () => {
    const requestSeq = ++loadRequestSeqRef.current
    try {
      const dailyReview = await window.api.config.get('dailyReview') as UserSettings['dailyReview'] | undefined
      const lookbackDays = Math.max(1, Number(dailyReview?.analysisLookbackDays || 3))
      const historyWindowDays = includeArchived ? ARCHIVE_VIEW_LOOKBACK_DAYS : HISTORY_LOOKBACK_DAYS
      const historyStartDate = dayjs()
        .subtract(historyWindowDays - 1, 'day')
        .startOf('day')
        .toISOString()
      const historyEndDate = new Date().toISOString()

      const [historyResult, generationStatusResult] = await Promise.all([
        window.api.dailyReview.getHistory(historyStartDate, historyEndDate, includeArchived),
        window.api.dailyReview.getGenerationStatus()
      ])

      const nextEntries = historyResult?.success && Array.isArray(historyResult.data)
        ? historyResult.data as TimeEntry[]
        : []
      if (requestSeq !== loadRequestSeqRef.current) return

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
      if (requestSeq !== loadRequestSeqRef.current) return
      console.error('[DailyReviewView] Failed to load data:', error)
    }
  }, [clearParsedCache, includeArchived])

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

  const upsertHistoryEntry = useCallback((entry: TimeEntry) => {
    parsedCacheRef.current.delete(entry.id)
    setHistoryEntries((current) => {
      const next = [entry, ...current.filter((item) => item.id !== entry.id)]
      return next.sort((left, right) => dayjs(right.eventTime).valueOf() - dayjs(left.eventTime).valueOf())
    })
    setActiveEntryId(entry.id)
  }, [])

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
        upsertHistoryEntry(entry)
        showGenerationFeedback(entry, '今日复盘已生成')
        void loadData()
      } else {
        message.error(`生成失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }, [loadData, showGenerationFeedback, upsertHistoryEntry])

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
        upsertHistoryEntry(entry)
        showGenerationFeedback(entry, '盘前复习已生成')
        void loadData()
      } else {
        message.error(`生成失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }, [loadData, showGenerationFeedback, upsertHistoryEntry])

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

  const handleArchiveEntry = useCallback(async (entryId: string) => {
    setArchivingEntryId(entryId)
    setTaskProgress({
      operation: 'archive',
      stage: 'start',
      progress: 1,
      message: '准备归档复盘记录'
    })
    try {
      const result = await window.api.dailyReview.archiveEntry(entryId)
      if (!result?.success) {
        const errorText = result?.error || '未知错误'
        message.error(`归档失败: ${errorText}`)
        setTaskProgress({
          operation: 'archive',
          stage: 'error',
          progress: 100,
          message: `归档失败: ${errorText}`
        })
        return
      }
      message.success('已归档复盘记录')
      if (activeEntryId === entryId && !includeArchived) {
        setActiveEntryId(null)
      }
      await loadData()
      setTaskProgress({
        operation: 'archive',
        stage: 'completed',
        progress: 100,
        message: '归档完成'
      })
    } catch (error: any) {
      message.error(`归档失败: ${error.message}`)
      setTaskProgress({
        operation: 'archive',
        stage: 'error',
        progress: 100,
        message: `归档失败: ${error.message}`
      })
    } finally {
      setArchivingEntryId(null)
      window.setTimeout(() => {
        setTaskProgress((current) => (current?.operation === 'archive' ? null : current))
      }, 1200)
    }
  }, [activeEntryId, includeArchived, loadData])

  const handleUnarchiveEntry = useCallback(async (entryId: string) => {
    setArchivingEntryId(entryId)
    try {
      const result = await window.api.dailyReview.unarchiveEntry(entryId)
      if (!result?.success) {
        message.error(`取消归档失败: ${result?.error || '未知错误'}`)
        return
      }
      message.success('已取消归档')
      await loadData()
    } catch (error: any) {
      message.error(`取消归档失败: ${error.message}`)
    } finally {
      setArchivingEntryId(null)
    }
  }, [loadData])

  const handleArchiveOlderEntries = useCallback(async () => {
    setArchivingHistory(true)
    try {
      const cutoffIso = dayjs().subtract(HISTORY_LOOKBACK_DAYS - 1, 'day').startOf('day').toISOString()
      const result = await window.api.dailyReview.archiveBefore(cutoffIso)
      if (!result?.success) {
        message.error(`归档失败: ${result?.error || '未知错误'}`)
        return
      }
      const archived = Number(result?.data?.archived || 0)
      message.success(archived > 0 ? `已归档 ${archived} 条两周前复盘` : '没有可归档的历史复盘')
      await loadData()
    } catch (error: any) {
      message.error(`归档失败: ${error.message}`)
    } finally {
      setArchivingHistory(false)
    }
  }, [loadData])

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
        upsertHistoryEntry(entry)
        showGenerationFeedback(entry, '复盘内容已更新')
        void loadData()
      } else {
        message.error(`重新生成失败: ${result?.error || '未知错误'}`)
      }
    } catch (error: any) {
      message.error(`重新生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }, [loadData, showGenerationFeedback, upsertHistoryEntry])

  const handleDeleteEntry = useCallback(async (entryId: string) => {
    try {
      const result = await window.api.dailyReview.deleteEntry(entryId)
      if (!result?.success) {
        message.error(`删除失败: ${result?.error || '未知错误'}`)
        return
      }
      message.success('已删除复盘记录')
      setHistoryEntries((current) => current.filter((entry) => entry.id !== entryId))
      setSelectedEntryIds((current) => current.filter((id) => id !== entryId))
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
      const selectedSet = new Set(selectedEntryIds)
      setHistoryEntries((current) => current.filter((entry) => !selectedSet.has(entry.id)))
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

  const operationLabelMap = useMemo(() => ({
    'daily-summary': '今日复盘',
    'pre-market': '盘前复习',
    'weekly': '周回顾',
    'regenerate': '重新生成',
    'archive': '复盘归档'
  }), [])

  const formatStatusTime = useCallback((value: string | null | undefined): string => {
    if (!value) return '暂无'
    const formatted = dayjs(value)
    return formatted.isValid() ? formatted.format('YYYY-MM-DD HH:mm:ss') : '暂无'
  }, [])

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="border-b border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Space direction="vertical" size={2}>
            <Title level={4} className="m-0">📋 每日复盘</Title>
            <Text type="secondary">
              观点追踪分析只看近 {analysisLookbackDays} 天（T-{analysisLookbackDays}），
              {includeArchived
                ? `日志查看近 ${ARCHIVE_VIEW_LOOKBACK_DAYS} 天（含归档）`
                : `日志默认展示近 ${HISTORY_LOOKBACK_DAYS} 天（未归档）`}
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

      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <Card
            title={`🗂️ 复盘日志 (${historyEntries.length})`}
            extra={
              <Space>
                <Checkbox checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}>
                  显示归档
                </Checkbox>
                <Popconfirm
                  title={`确认归档 ${HISTORY_LOOKBACK_DAYS} 天前复盘记录？`}
                  description="归档后默认不显示，但仍可在“显示归档”中查看与删除。"
                  okText="归档"
                  cancelText="取消"
                  onConfirm={() => void handleArchiveOlderEntries()}
                >
                  <Button size="small" loading={archivingHistory}>
                    归档两周前
                  </Button>
                </Popconfirm>
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
            className="h-full min-h-0"
            bodyStyle={{ height: 'calc(100% - 57px)', padding: 12, overflow: 'hidden' }}
          >
            {historyEntries.length > 0 ? (
              <div className="app-scroll-pane h-full min-h-0 space-y-2 overflow-y-scroll overflow-x-hidden pr-1">
                <DailyReviewHistoryList
                  entries={historyEntries}
                  activeEntryId={activeEntryId}
                  selectedEntryIds={selectedEntryIds}
                  archivingEntryId={archivingEntryId}
                  getParsed={getOrParseEntry}
                  onToggleSelect={handleToggleSelected}
                  onSelectEntry={(entryId) => setActiveEntryId(entryId)}
                  onMarkRead={(entryId) => void handleMarkAsRead(entryId)}
                  onArchive={(entryId) => void handleArchiveEntry(entryId)}
                  onUnarchive={(entryId) => void handleUnarchiveEntry(entryId)}
                  onDelete={(entryId) => void handleDeleteEntry(entryId)}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty description={includeArchived ? `最近 ${ARCHIVE_VIEW_LOOKBACK_DAYS} 天暂无复盘日志` : `最近 ${HISTORY_LOOKBACK_DAYS} 天暂无复盘日志`}>
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
                {(() => {
                  const activeParsed = getOrParseEntry(activeEntry)
                  const activeCategory = activeParsed.resolvedCategory
                  const activeCategoryColor = activeCategory === '每日总结'
                    ? 'blue'
                    : activeCategory === '盘前复习'
                      ? 'green'
                      : activeCategory === '周回顾'
                        ? 'purple'
                        : 'default'
                  return (
                    <>
                      <span>{activeEntry.title || '复盘详情'}</span>
                      <Tag color={activeCategoryColor}>
                        {activeCategory === '其他' ? activeEntry.category : activeCategory}
                      </Tag>
                    </>
                  )
                })()}
                {activeEntry.trackingStatus === '未读' ? <Tag color="processing">未读</Tag> : null}
                <Text type="secondary">{dayjs(activeEntry.eventTime).format('YYYY-MM-DD HH:mm')}</Text>
              </Space>
            ) : '复盘详情'}
            extra={activeEntry ? (
              <Space wrap>
                {activeEntry.trackingStatus !== '已归档' ? (
                  <Button size="small" onClick={() => void handleMarkAsRead(activeEntry.id)}>
                    标记已读
                  </Button>
                ) : null}
                <Button
                  size="small"
                  loading={archivingEntryId === activeEntry.id}
                  onClick={() => {
                    if (activeEntry.trackingStatus === '已归档') {
                      void handleUnarchiveEntry(activeEntry.id)
                    } else {
                      void handleArchiveEntry(activeEntry.id)
                    }
                  }}
                >
                  {activeEntry.trackingStatus === '已归档' ? '取消归档' : '复盘归档'}
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
            className="h-full min-h-0"
            bodyStyle={{ height: 'calc(100% - 57px)', overflow: 'auto' }}
          >
            {activeEntry ? (
              <DailyReviewDetailContent
                entry={activeEntry}
                parsed={getOrParseEntry(activeEntry)}
                getEntryRawText={getEntryRawText}
              />
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
