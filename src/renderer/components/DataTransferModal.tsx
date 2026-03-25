import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Modal, Space, message } from 'antd'
import { FolderOpenOutlined, ImportOutlined, ExportOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'
import type { NotesExportResult, NotesImportResult } from '../../shared/types'

export type TransferMode = 'export-current' | 'export-all' | 'import-skip' | 'import-replace'

interface DataTransferModalProps {
  open: boolean
  mode: TransferMode
  onClose: () => void
}

const DataTransferModal: React.FC<DataTransferModalProps> = ({ open, mode, onClose }) => {
  const { currentStockCode, currentStockName } = useAppStore()
  const [directory, setDirectory] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultText, setResultText] = useState('')

  const title = useMemo(() => {
    if (mode === 'export-current') return '导出当前股票笔记'
    if (mode === 'export-all') return '导出全部笔记'
    if (mode === 'import-skip') return '导入笔记（跳过重复）'
    return '导入笔记（覆盖重复）'
  }, [mode])

  useEffect(() => {
    if (!open) return
    setResultText('')
    setDirectory('')
  }, [open, mode])

  const handlePickDirectory = async () => {
    const picked = await window.api.system.pickDirectory(directory || undefined)
    if (picked) {
      setDirectory(picked)
    }
  }

  const handleRun = async () => {
    if (!directory.trim()) {
      message.warning('请先选择目录')
      return
    }

    try {
      setLoading(true)
      if (mode === 'export-current') {
        if (!currentStockCode) {
          message.warning('请先在左侧选择一只股票')
          return
        }
        const result = await window.api.notes.exportStock(currentStockCode, directory.trim())
        setResultText(renderExportResult(result))
        message.success('导出完成')
        return
      }

      if (mode === 'export-all') {
        const result = await window.api.notes.exportAll(directory.trim())
        setResultText(renderExportResult(result))
        message.success('导出完成')
        return
      }

      const importMode = mode === 'import-replace' ? 'replace' : 'skip'
      const result = await window.api.notes.importFromDirectory(directory.trim(), importMode)
      setResultText(renderImportResult(result))
      message.success('导入完成')
    } catch (error: any) {
      message.error(`执行失败: ${error?.message || String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const currentStockHint = currentStockCode
    ? `${currentStockName && currentStockName !== currentStockCode ? `${currentStockName}${currentStockCode}` : currentStockCode}`
    : '未选择股票'

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={handleRun}
      okText="执行"
      cancelText="关闭"
      confirmLoading={loading}
      maskClosable={false}
      width={760}
    >
      {mode === 'export-current' && (
        <Alert
          showIcon
          type={currentStockCode ? 'info' : 'warning'}
          className="mb-3"
          message={`当前股票：${currentStockHint}`}
        />
      )}

      <div className="mb-3">
        <div className="mb-1 text-sm text-gray-500">
          {mode.startsWith('import') ? '导入来源目录' : '导出目标目录'}
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder={mode.startsWith('import') ? '选择包含 stocks/ 的目录，或直接选择 md 文件目录' : '选择导出目录'}
          />
          <Button icon={<FolderOpenOutlined />} onClick={handlePickDirectory}>
            浏览
          </Button>
        </Space.Compact>
      </div>

      <Alert
        showIcon
        type="info"
        className="mb-3"
        message={mode.startsWith('import')
          ? (mode === 'import-replace' ? '覆盖模式：同代码笔记会被覆盖。' : '跳过模式：同代码笔记会被跳过。')
          : '会按应用内部格式导出（仅包含 manifest 与 stocks 目录）。'}
        icon={mode.startsWith('import') ? <ImportOutlined /> : <ExportOutlined />}
      />

      {resultText && (
        <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap">
          {resultText}
        </pre>
      )}
    </Modal>
  )
}

const renderExportResult = (result: NotesExportResult): string => {
  return [
    `scope: ${result.scope}`,
    `stockCode: ${result.stockCode || '-'}`,
    `exportDir: ${result.exportDir}`,
    `manifest: ${result.manifestPath}`,
    `exportedStocks: ${result.exportedStocks.length}`,
    `exportedFiles: ${result.exportedFiles}`
  ].join('\n')
}

const renderImportResult = (result: NotesImportResult): string => {
  return [
    `sourceDir: ${result.sourceDir}`,
    `mode: ${result.mode}`,
    `imported: ${result.imported}`,
    `skipped: ${result.skipped}`,
    `failed: ${result.failed}`,
    `importedStocks: ${result.importedStocks.join(', ') || '-'}`,
    `skippedStocks: ${result.skippedStocks.join(', ') || '-'}`,
    `failedFiles: ${result.failedFiles.map((item) => `${item.fileName}(${item.reason})`).join(', ') || '-'}`
  ].join('\n')
}

export default DataTransferModal
