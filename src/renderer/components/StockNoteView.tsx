import React, { useState, useEffect } from 'react'
import { Button, Empty, Tag, Spin, Modal, Select, Space, DatePicker, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppStore } from '../stores/app'
import type { NoteCategory, NoteCategoryConfig, OperationTag, TimeEntry, UserSettings, Viewpoint } from '../../shared/types'
import { DEFAULT_NOTE_CATEGORY_CONFIGS, getCategoryConfig, getEnabledOptions, normalizeNoteCategoryConfigs } from '../../shared/note-categories'

const StockNoteView: React.FC = () => {
  const {
    currentStockCode,
    currentStockName,
    stockNotes,
    setStockNote,
    loading,
    setLoading
  } = useAppStore()

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editViewpoint, setEditViewpoint] = useState<Viewpoint | null>(null)
  const [editEventTime, setEditEventTime] = useState<Dayjs | null>(null)
  const [editCategory, setEditCategory] = useState<NoteCategory>('看盘预测')
  const [editOperationTag, setEditOperationTag] = useState<OperationTag>('无')
  const [isAdding, setIsAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newViewpoint, setNewViewpoint] = useState<Viewpoint | null>(null)
  const [newEventTime, setNewEventTime] = useState<Dayjs | null>(null)
  const [newCategory, setNewCategory] = useState<NoteCategory>('看盘预测')
  const [newOperationTag, setNewOperationTag] = useState<OperationTag>('无')
  const [categoryConfigs, setCategoryConfigs] = useState<NoteCategoryConfig[]>(DEFAULT_NOTE_CATEGORY_CONFIGS)

  const categoryOptions = categoryConfigs
    .filter((item) => item.enabled !== false)
    .map((item) => ({ label: item.label, value: item.code }))
  const editCategoryConfig = getCategoryConfig(categoryConfigs, editCategory)
  const newCategoryConfig = getCategoryConfig(categoryConfigs, newCategory)
  const editDirectionOptions = getEnabledOptions(editCategoryConfig?.fields.viewpoint.options || [])
    .map((item) => ({ label: item.label, value: item.code }))
  const newDirectionOptions = getEnabledOptions(newCategoryConfig?.fields.viewpoint.options || [])
    .map((item) => ({ label: item.label, value: item.code }))
  const editHorizonOptions = getEnabledOptions(editCategoryConfig?.fields.timeHorizon.options || [])
    .map((item) => ({ label: item.label, value: item.code }))
  const newHorizonOptions = getEnabledOptions(newCategoryConfig?.fields.timeHorizon.options || [])
    .map((item) => ({ label: item.label, value: item.code }))
  const editOperationOptions = getEnabledOptions(editCategoryConfig?.fields.operationTag.options || [])
    .map((item) => ({ label: item.label, value: item.code }))
  const newOperationOptions = getEnabledOptions(newCategoryConfig?.fields.operationTag.options || [])
    .map((item) => ({ label: item.label, value: item.code }))

  const createViewpoint = (direction: Viewpoint['direction'], timeHorizon: Viewpoint['timeHorizon']): Viewpoint => ({
    direction,
    timeHorizon,
    confidence: direction === '未知' ? 0 : 0.7
  })

  const toDayjs = (value?: Date | string) => {
    if (!value) return null
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed : null
  }

  const applyEntryToState = (entry: TimeEntry) => {
    if (!currentStockCode) return
    setEntries((prev) => prev.map((item) => (item.id === entry.id ? entry : item)))
    const currentNote = stockNotes.get(currentStockCode)
    if (!currentNote) return
    const nextEntries = currentNote.entries.map((item) => (item.id === entry.id ? entry : item))
    setStockNote(currentStockCode, {
      ...currentNote,
      entries: nextEntries
    })
  }

  useEffect(() => {
    if (currentStockCode) {
      const note = stockNotes.get(currentStockCode)
      setEntries(note?.entries || [])
    } else {
      setEntries([])
    }
    setEditingId(null)
    setIsAdding(false)
  }, [currentStockCode, stockNotes])

  useEffect(() => {
    if (!currentStockCode || stockNotes.get(currentStockCode)) return
    loadNote()
  }, [currentStockCode, stockNotes])

  useEffect(() => {
    let cancelled = false
    const loadCategoryConfigs = async () => {
      try {
        const settings = await window.api.config.getAll() as UserSettings
        if (!cancelled) {
          setCategoryConfigs(normalizeNoteCategoryConfigs(settings?.notes?.categoryConfigs))
        }
      } catch {
        if (!cancelled) {
          setCategoryConfigs(normalizeNoteCategoryConfigs(DEFAULT_NOTE_CATEGORY_CONFIGS))
        }
      }
    }
    loadCategoryConfigs()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const directionCodes = editDirectionOptions.map((item) => item.value)
    const horizonCodes = editHorizonOptions.map((item) => item.value)
    const operationCodes = editOperationOptions.map((item) => item.value)
    if (directionCodes.length > 0 && !directionCodes.includes(editViewpoint?.direction || '')) {
      setEditViewpoint(createViewpoint(directionCodes[0], editViewpoint?.timeHorizon || (horizonCodes[0] || '短线')))
    }
    if (operationCodes.length > 0 && !operationCodes.includes(editOperationTag)) {
      setEditOperationTag(operationCodes[0])
    }
    if (horizonCodes.length > 0 && editViewpoint && !horizonCodes.includes(editViewpoint.timeHorizon)) {
      setEditViewpoint(createViewpoint(editViewpoint.direction, horizonCodes[0]))
    }
  }, [editCategory, editDirectionOptions, editHorizonOptions, editOperationOptions])

  useEffect(() => {
    const directionCodes = newDirectionOptions.map((item) => item.value)
    const horizonCodes = newHorizonOptions.map((item) => item.value)
    const operationCodes = newOperationOptions.map((item) => item.value)
    if (directionCodes.length > 0 && !directionCodes.includes(newViewpoint?.direction || '')) {
      setNewViewpoint(createViewpoint(directionCodes[0], newViewpoint?.timeHorizon || (horizonCodes[0] || '短线')))
    }
    if (operationCodes.length > 0 && !operationCodes.includes(newOperationTag)) {
      setNewOperationTag(operationCodes[0])
    }
    if (horizonCodes.length > 0 && newViewpoint && !horizonCodes.includes(newViewpoint.timeHorizon)) {
      setNewViewpoint(createViewpoint(newViewpoint.direction, horizonCodes[0]))
    }
  }, [newCategory, newDirectionOptions, newHorizonOptions, newOperationOptions])

  const loadNote = async () => {
    if (!currentStockCode) return
    try {
      const note = await window.api.notes.getStockNote(currentStockCode)
      if (note) {
        setStockNote(currentStockCode, note)
        setEntries(note.entries || [])
      }
    } catch (error) {
      console.error('Failed to load note:', error)
    }
  }

  const handleSaveEntry = async () => {
    if (!currentStockCode || !editContent.trim()) return

    setLoading(true)
    try {
      if (editingId) {
        const updatedEntry = await window.api.notes.updateEntry(currentStockCode, editingId, {
          content: editContent,
          category: editCategory,
          operationTag: editOperationTag,
          viewpoint: editViewpoint || createViewpoint('未知', '短线'),
          eventTime: (editEventTime || dayjs()).toISOString()
        })
        applyEntryToState(updatedEntry)
        message.success('笔记已更新')
      } else {
        await window.api.notes.addEntry(currentStockCode, {
          content: editContent,
          category: editCategory,
          operationTag: editOperationTag,
          viewpoint: editViewpoint || createViewpoint('未知', '短线'),
          eventTime: (editEventTime || dayjs()).toISOString(),
          inputType: 'manual'
        })
        message.success('笔记已保存')
      }
      if (!editingId) {
        await loadNote()
      }
      setEditingId(null)
      setEditContent('')
      setEditViewpoint(null)
      setEditEventTime(null)
      setEditCategory('看盘预测')
      setEditOperationTag('无')
    } catch (error: any) {
      message.error('保存失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条笔记吗？',
      onOk: async () => {
        try {
          await window.api.notes.deleteEntry(currentStockCode!, entryId)
          message.success('已删除')
          await loadNote()
        } catch (error: any) {
          message.error('删除失败: ' + error.message)
        }
      }
    })
  }

  const handleAddNote = () => {
    setIsAdding(true)
    setNewContent('')
    setNewViewpoint(createViewpoint('未知', '短线'))
    setNewEventTime(dayjs())
    setNewCategory('看盘预测')
    setNewOperationTag('无')
  }

  const handleSaveNewNote = async () => {
    if (!currentStockCode || !newContent.trim()) return

    setLoading(true)
    try {
      await window.api.notes.addEntry(currentStockCode, {
        content: newContent,
        category: newCategory,
        operationTag: newOperationTag,
        viewpoint: newViewpoint || createViewpoint('未知', '短线'),
        eventTime: (newEventTime || dayjs()).toISOString(),
        inputType: 'manual'
      })
      message.success('笔记已保存')
      await loadNote()
      setIsAdding(false)
      setNewContent('')
      setNewViewpoint(null)
      setNewEventTime(null)
      setNewCategory('看盘预测')
      setNewOperationTag('无')
    } catch (error: any) {
      message.error('保存失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (entry: TimeEntry) => {
    setEditingId(entry.id)
    setEditContent(entry.content)
    setEditViewpoint(entry.viewpoint || createViewpoint('未知', '短线'))
    setEditEventTime(toDayjs(entry.eventTime || entry.timestamp) || dayjs())
    setEditCategory(entry.category || '看盘预测')
    setEditOperationTag(entry.operationTag || '无')
    setIsAdding(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
    setEditViewpoint(null)
    setEditEventTime(null)
    setEditCategory('看盘预测')
    setEditOperationTag('无')
  }

  const cancelAdd = () => {
    setIsAdding(false)
    setNewContent('')
    setNewViewpoint(null)
    setNewEventTime(null)
    setNewCategory('看盘预测')
    setNewOperationTag('无')
  }

  const getViewpointTag = (viewpoint?: Viewpoint) => {
    if (!viewpoint) return null
    const colorMap: Record<string, string> = {
      看多: 'red',
      看空: 'green',
      未知: 'default',
      中性: 'blue',
      观望: 'default'
    }
    return <Tag color={colorMap[viewpoint.direction] || 'default'}>观点: {viewpoint.direction}</Tag>
  }

  const getCategoryTag = (category: NoteCategory) => {
    const colorMap: Record<string, string> = {
      看盘预测: 'magenta',
      普通笔记: 'blue'
    }
    const config = categoryConfigs.find((item) => item.code === category)
    return <Tag color={colorMap[category] || 'default'}>类别: {config?.label || category}</Tag>
  }

  const getOperationTag = (operationTag?: OperationTag) => {
    const tag = operationTag || '无'
    if (tag === '买入') return <Tag color="red">操作: 买入</Tag>
    if (tag === '卖出') return <Tag color="green">操作: 卖出</Tag>
    return <Tag>操作: 无</Tag>
  }

  const formatTime = (timestamp: Date | string, eventTime?: Date | string) => {
    const sourceDate = dayjs(eventTime || timestamp)
    return sourceDate.isValid() ? sourceDate.format('YYYY-MM-DD HH:mm') : '-'
  }

  const stockDisplayName = currentStockName && currentStockName !== currentStockCode
    ? `${currentStockName}${currentStockCode}`
    : currentStockCode

  if (!currentStockCode) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <Empty
          description={
            <div className="text-center">
              <p className="text-lg mb-2">点击右上角 🎤 录音按钮开始</p>
              <p className="text-gray-400 text-sm">语音输入 → 纠错和匹配 → 保存笔记</p>
            </div>
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold m-0">
            {stockDisplayName}
          </h2>
          <span className="text-gray-400">盯盘文档</span>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddNote}>
            新增笔记
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        <div className="flex-1 overflow-auto p-4">
          {isAdding && (
            <div className="mb-4 p-4 border border-blue-200 rounded-lg bg-blue-50">
              <div className="mb-3 flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">类别</span>
                  <Select
                    value={newCategory}
                    onChange={(value) => setNewCategory(value)}
                    style={{ width: 120 }}
                    size="small"
                    options={categoryOptions}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">观点</span>
                  <Select
                    value={newViewpoint?.direction || '未知'}
                    onChange={(v) => setNewViewpoint(createViewpoint(v as Viewpoint['direction'], newViewpoint?.timeHorizon || '短线'))}
                    style={{ width: 100 }}
                    size="small"
                    disabled={!newCategoryConfig?.fields.viewpoint.enabled}
                    options={newDirectionOptions}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">周期</span>
                  <Select
                    value={newViewpoint?.timeHorizon || '短线'}
                    onChange={(v) => setNewViewpoint(createViewpoint(newViewpoint?.direction || '未知', v as Viewpoint['timeHorizon']))}
                    style={{ width: 100 }}
                    size="small"
                    disabled={!newCategoryConfig?.fields.timeHorizon.enabled}
                    options={newHorizonOptions}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">操作</span>
                  <Select
                    value={newOperationTag}
                    onChange={(value) => setNewOperationTag(value)}
                    style={{ width: 120 }}
                    size="small"
                    disabled={!newCategoryConfig?.fields.operationTag.enabled}
                    options={newOperationOptions}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500">时间</span>
                  <DatePicker
                    value={newEventTime}
                    onChange={(value) => setNewEventTime(value)}
                    showTime={{ format: 'HH:mm' }}
                    format="YYYY-MM-DD HH:mm"
                    placeholder="事件时间（分钟）"
                    size="small"
                  />
                </div>
              </div>
              <MDEditor
                value={newContent}
                onChange={(val) => setNewContent(val || '')}
                preview="edit"
                height={150}
                visibleDragbar={false}
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button onClick={cancelAdd}>取消</Button>
                <Button type="primary" onClick={handleSaveNewNote}>保存</Button>
              </div>
            </div>
          )}

          {entries.length === 0 && !isAdding ? (
            <Empty description="暂无笔记，点击上方按钮新增" className="mt-8" />
          ) : (
            <div className="space-y-3">
              {entries.map(entry => (
                <div key={entry.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  {editingId === entry.id ? (
                    <div className="p-4 bg-gray-50">
                      <div className="mb-3 flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">类别</span>
                          <Select
                            value={editCategory}
                            onChange={(value) => setEditCategory(value)}
                            style={{ width: 120 }}
                            size="small"
                            options={categoryOptions}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">观点</span>
                          <Select
                            value={editViewpoint?.direction || '未知'}
                            onChange={(v) => setEditViewpoint(createViewpoint(v as Viewpoint['direction'], editViewpoint?.timeHorizon || '短线'))}
                            style={{ width: 100 }}
                            size="small"
                            disabled={!editCategoryConfig?.fields.viewpoint.enabled}
                            options={editDirectionOptions}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">周期</span>
                          <Select
                            value={editViewpoint?.timeHorizon || '短线'}
                            onChange={(v) => setEditViewpoint(createViewpoint(editViewpoint?.direction || '未知', v as Viewpoint['timeHorizon']))}
                            style={{ width: 100 }}
                            size="small"
                            disabled={!editCategoryConfig?.fields.timeHorizon.enabled}
                            options={editHorizonOptions}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">操作</span>
                          <Select
                            value={editOperationTag}
                            onChange={(value) => setEditOperationTag(value)}
                            style={{ width: 120 }}
                            size="small"
                            disabled={!editCategoryConfig?.fields.operationTag.enabled}
                            options={editOperationOptions}
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">时间</span>
                          <DatePicker
                            value={editEventTime}
                            onChange={(value) => setEditEventTime(value)}
                            showTime={{ format: 'HH:mm' }}
                            format="YYYY-MM-DD HH:mm"
                            placeholder="事件时间（分钟）"
                            size="small"
                          />
                        </div>
                      </div>
                      <MDEditor
                        value={editContent}
                        onChange={(val) => setEditContent(val || '')}
                        preview="edit"
                        height={150}
                        visibleDragbar={false}
                      />
                      <div className="mt-3 flex justify-end gap-2">
                        <Button onClick={cancelEdit}>取消</Button>
                        <Button type="primary" onClick={handleSaveEntry}>保存</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">{formatTime(entry.timestamp, entry.eventTime)}</span>
                          {getCategoryTag(entry.category)}
                          {getViewpointTag(entry.viewpoint)}
                          {getOperationTag(entry.operationTag)}
                        </div>
                        <Space size="small">
                          <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(entry)} />
                          <Button size="small" icon={<DeleteOutlined />} danger onClick={() => handleDeleteEntry(entry.id)} />
                        </Space>
                      </div>
                      <div className="prose prose-sm max-w-none">
                        <MDEditor.Markdown source={entry.content} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Spin>
    </div>
  )
}

export default StockNoteView
