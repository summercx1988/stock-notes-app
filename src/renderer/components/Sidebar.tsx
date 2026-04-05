import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Input, List, Empty, Spin, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'
import type { StockNoteSummary } from '../../shared/types'

const Sidebar: React.FC = () => {
  const {
    stocks,
    currentStockCode,
    setCurrentStock,
    setStocks,
    searchResults,
    setSearchResults,
    clearSearchResults
  } = useAppStore()

  const [searchText, setSearchText] = useState('')
  const [localSearching, setLocalSearching] = useState(false)
  const [stockSummaries, setStockSummaries] = useState<StockNoteSummary[]>([])
  const [summariesLoading, setSummariesLoading] = useState(false)

  const normalizeStockCode = (value: string) => {
    const normalized = String(value || '').trim()
    const matched = normalized.match(/(\d{6})/)
    return matched ? matched[1] : normalized
  }

  const normalizeStockName = (name: string, code: string) => {
    const normalized = String(name || '').trim()
    if (!normalized) return ''
    if (!code) return normalized
    return normalized
      .replace(new RegExp(`（\\s*${code}\\s*）$`), '')
      .replace(new RegExp(`\\(\\s*${code}\\s*\\)$`), '')
      .trim()
  }

  const refreshStockSummaries = useCallback(async () => {
    setSummariesLoading(true)
    try {
      const summaries = await window.api.notes.getStockSummaries()
      setStockSummaries(summaries)
      const nextStocks = summaries.map((item) => ({
        code: item.stockCode,
        name: item.stockName,
        market: item.market
      }))
      setStocks(nextStocks)
      if (!currentStockCode && nextStocks.length > 0) {
        setCurrentStock(nextStocks[0].code, nextStocks[0].name)
      }
    } catch (error) {
      console.error('Failed to refresh stock summaries:', error)
    } finally {
      setSummariesLoading(false)
    }
  }, [currentStockCode, setCurrentStock, setStocks])

  useEffect(() => {
    void refreshStockSummaries()
  }, [refreshStockSummaries])

  useEffect(() => {
    const unsubscribe = window.api.notes.onChanged(() => {
      void refreshStockSummaries()
    })
    return () => { unsubscribe() }
  }, [refreshStockSummaries])

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      clearSearchResults()
      return
    }

    setLocalSearching(true)
    try {
      const results = await window.api.stock.search(query, 10)
      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLocalSearching(false)
    }
  }, [clearSearchResults, setSearchResults])

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      handleSearch(searchText)
    }, 300)

    return () => clearTimeout(debounceTimer)
  }, [searchText, handleSearch])

  const handleSelectStock = (stockCode: string, stockName?: string) => {
    const normalizedCode = normalizeStockCode(stockCode)
    const normalizedName = normalizeStockName(stockName || '', normalizedCode) || stockName
    setCurrentStock(normalizedCode, normalizedName)
    setSearchText('')
    clearSearchResults()
    message.success(`已选择: ${normalizedName || normalizedCode}`)
  }

  const getNoteCount = (stockCode: string) => {
    const normalizedCode = normalizeStockCode(stockCode)
    return noteCountByCode.get(normalizedCode) || 0
  }

  const noteCountByCode = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of stockSummaries) {
      const code = normalizeStockCode(item.stockCode)
      map.set(code, Number(item.noteCount || 0))
    }
    return map
  }, [stockSummaries])

  const totalNoteCount = useMemo(() => {
    return stockSummaries.reduce((sum, item) => sum + Number(item.noteCount || 0), 0)
  }, [stockSummaries])

  const getDisplayName = (item: { code: string; name: string }) => {
    const normalizedCode = normalizeStockCode(item.code)
    const normalizedName = normalizeStockName(item.name, normalizedCode)
    return normalizedName && normalizedName !== normalizedCode
      ? `${normalizedName}${normalizedCode}`
      : normalizedCode
  }

  const rawDisplayItems = searchText.trim()
    ? searchResults.map(r => ({
        code: normalizeStockCode(r.stock.code),
        name: normalizeStockName(r.stock.name, normalizeStockCode(r.stock.code)),
        market: r.stock.market,
        isFromSearch: true
      }))
    : stocks.map(s => ({
        code: normalizeStockCode(typeof s === 'string' ? s : s.code),
        name: normalizeStockName(typeof s === 'string' ? s : s.name, normalizeStockCode(typeof s === 'string' ? s : s.code)),
        market: (typeof s === 'string' ? 'SH' : s.market) as 'SH' | 'SZ' | 'BJ',
        isFromSearch: false
      }))

  const displayItems = Array.from(
    rawDisplayItems.reduce((map, item) => {
      const existing = map.get(item.code)
      if (!existing || item.name.length > existing.name.length) {
        map.set(item.code, item)
      }
      return map
    }, new Map<string, typeof rawDisplayItems[number]>()).values()
  )

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="p-3 border-b border-slate-200">
        <Input
          placeholder="搜索股票..."
          prefix={localSearching ? <Spin size="small" /> : <SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </div>

      <div className="flex-1 overflow-auto p-2">
        <Spin spinning={summariesLoading}>
          {displayItems.length > 0 ? (
            <List
              dataSource={displayItems}
              renderItem={(item: any) => (
                <List.Item
                  className={`px-1 py-1 border-none bg-transparent cursor-pointer ${
                    currentStockCode === item.code ? '' : ''
                  }`}
                  onClick={() => handleSelectStock(item.code, item.name)}
                >
                  <div
                    className={`w-full rounded-xl border px-3 py-3 text-center transition-all ${
                      currentStockCode === item.code
                        ? 'border-blue-300 bg-blue-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-medium text-slate-800">{getDisplayName(item)}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      共 {getNoteCount(item.code)} 条事件 · {item.market === 'SH' ? '沪' : item.market === 'SZ' ? '深' : '北'}
                    </div>
                  </div>
                </List.Item>
              )}
            />
          ) : (
            <Empty description="搜索股票开始记录" className="mt-8" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Spin>
      </div>

      <div className="p-2 border-t border-slate-200 text-xs text-slate-400 text-center">
        {stocks.length} 只股票 · {totalNoteCount} 条笔记
      </div>
    </div>
  )
}

export default Sidebar
