import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Input, List, Empty, Spin, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app'

const Sidebar: React.FC = () => {
  const {
    stocks,
    stockNotes,
    currentStockCode,
    setCurrentStock,
    timeline,
    setTimeline,
    setStocks,
    searchResults,
    setSearchResults,
    clearSearchResults
  } = useAppStore()

  const [searchText, setSearchText] = useState('')
  const [localSearching, setLocalSearching] = useState(false)

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

  const refreshTimeline = useCallback(async () => {
    try {
      const items = await window.api.notes.getTimeline()
      setTimeline(items)
    } catch (error) {
      console.error('Failed to refresh timeline:', error)
    }
  }, [setTimeline])

  useEffect(() => {
    refreshTimeline()
  }, [refreshTimeline, stockNotes])

  useEffect(() => {
    let cancelled = false

    const syncStocks = async () => {
      const stockCodes = [...new Set(timeline.map((item) => item.stockCode))]
      const stockList = await Promise.all(stockCodes.map(async (code) => {
        const item = timeline.find((timelineItem) => timelineItem.stockCode === code)
        const timelineName = item?.stockName || code
        if (timelineName && timelineName !== code) {
          return {
            code,
            name: timelineName,
            market: 'SH' as const
          }
        }
        try {
          const dbStock = await window.api.stock.getByCode(code)
          return {
            code,
            name: dbStock?.name || code,
            market: (dbStock?.market || 'SH') as 'SH' | 'SZ' | 'BJ'
          }
        } catch {
          return {
            code,
            name: code,
            market: 'SH' as const
          }
        }
      }))

      if (!cancelled) {
        const uniqueByCode = new Map<string, { code: string; name: string; market: 'SH' | 'SZ' | 'BJ' }>()
        for (const stock of stockList) {
          const normalizedCode = normalizeStockCode(stock.code)
          const normalizedName = normalizeStockName(stock.name, normalizedCode)
          const existing = uniqueByCode.get(normalizedCode)
          if (!existing || normalizedName.length > existing.name.length) {
            uniqueByCode.set(normalizedCode, {
              code: normalizedCode,
              name: normalizedName || normalizedCode,
              market: stock.market
            })
          }
        }
        setStocks(Array.from(uniqueByCode.values()))
      }
    }

    syncStocks().catch((error) => {
      console.error('Failed to sync stocks:', error)
    })

    return () => {
      cancelled = true
    }
  }, [setStocks, timeline])

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
    for (const item of timeline) {
      const code = normalizeStockCode(item.stockCode)
      map.set(code, (map.get(code) || 0) + 1)
    }
    return map
  }, [timeline])

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
      </div>

      <div className="p-2 border-t border-slate-200 text-xs text-slate-400 text-center">
        {stocks.length} 只股票 · {timeline.length} 条笔记
      </div>
    </div>
  )
}

export default Sidebar
