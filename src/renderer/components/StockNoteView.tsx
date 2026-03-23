import React, { useState, useEffect } from 'react'
import { Button, Empty, Tag, Spin, Modal, Select, Space, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import MDEditor from '@uiw/react-md-editor'
import { useAppStore } from '../stores/app'
import type { TimeEntry, Viewpoint } from '../../shared/types'

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
  const [isAdding, setIsAdding] = useState(false)
  const [newContent, setNewContent] = useState('')

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
        await window.api.notes.updateEntry(currentStockCode, editingId, {
          content: editContent,
          viewpoint: editViewpoint || undefined
        })
        message.success('笔记已更新')
      } else {
        await window.api.notes.addEntry(currentStockCode, {
          content: editContent,
          viewpoint: editViewpoint || undefined
        })
        message.success('笔记已保存')
      }
      await loadNote()
      setEditingId(null)
      setEditContent('')
      setEditViewpoint(null)
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
    setEditViewpoint(null)
  }

  const handleSaveNewNote = async () => {
    if (!currentStockCode || !newContent.trim()) return

    setLoading(true)
    try {
      await window.api.notes.addEntry(currentStockCode, {
        content: newContent,
        viewpoint: editViewpoint || undefined
      })
      message.success('笔记已保存')
      await loadNote()
      setIsAdding(false)
      setNewContent('')
      setEditViewpoint(null)
    } catch (error: any) {
      message.error('保存失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const startEdit = (entry: TimeEntry) => {
    setEditingId(entry.id)
    setEditContent(entry.content)
    setEditViewpoint(entry.viewpoint || null)
    setIsAdding(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent('')
    setEditViewpoint(null)
  }

  const cancelAdd = () => {
    setIsAdding(false)
    setNewContent('')
    setEditViewpoint(null)
  }

  const getViewpointTag = (viewpoint?: Viewpoint) => {
    if (!viewpoint) return null
    const color = viewpoint.direction === '看多' ? 'red' : viewpoint.direction === '看空' ? 'green' : 'default'
    return <Tag color={color}>{viewpoint.direction}</Tag>
  }

  const formatTime = (timestamp: Date | string) => {
    const date = new Date(timestamp)
    return `${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const createViewpoint = (direction: Viewpoint['direction'], timeHorizon: Viewpoint['timeHorizon']): Viewpoint => ({
    direction,
    timeHorizon,
    confidence: 0.7
  })

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
            {currentStockName || currentStockCode}
          </h2>
          <span className="text-gray-400">{currentStockCode}</span>
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
                <Select
                  value={editViewpoint?.direction || '中性'}
                  onChange={(v) => setEditViewpoint(createViewpoint(v as any, editViewpoint?.timeHorizon || '中线'))}
                  style={{ width: 100 }}
                  size="small"
                >
                  <Select.Option value="看多">看多</Select.Option>
                  <Select.Option value="看空">看空</Select.Option>
                  <Select.Option value="中性">中性</Select.Option>
                </Select>
                <Select
                  value={editViewpoint?.timeHorizon || '中线'}
                  onChange={(v) => setEditViewpoint(createViewpoint(editViewpoint?.direction || '中性', v as any))}
                  style={{ width: 100 }}
                  size="small"
                >
                  <Select.Option value="短线">短线</Select.Option>
                  <Select.Option value="中线">中线</Select.Option>
                  <Select.Option value="长线">长线</Select.Option>
                </Select>
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
                        <Select
                          value={editViewpoint?.direction || '中性'}
                          onChange={(v) => setEditViewpoint(createViewpoint(v as any, editViewpoint?.timeHorizon || '中线'))}
                          style={{ width: 100 }}
                          size="small"
                        >
                          <Select.Option value="看多">看多</Select.Option>
                          <Select.Option value="看空">看空</Select.Option>
                          <Select.Option value="中性">中性</Select.Option>
                        </Select>
                        <Select
                          value={editViewpoint?.timeHorizon || '中线'}
                          onChange={(v) => setEditViewpoint(createViewpoint(editViewpoint?.direction || '中性', v as any))}
                          style={{ width: 100 }}
                          size="small"
                        >
                          <Select.Option value="短线">短线</Select.Option>
                          <Select.Option value="中线">中线</Select.Option>
                          <Select.Option value="长线">长线</Select.Option>
                        </Select>
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
                          <span className="text-sm text-gray-500">{formatTime(entry.timestamp)}</span>
                          {getViewpointTag(entry.viewpoint)}
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
