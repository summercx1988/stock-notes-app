import React, { useState, useEffect, useCallback } from 'react'
import { Input, List, Tag, Empty, Spin, message } from 'antd'
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
    const stockCodes = [...new Set(timeline.map((item) => item.stockCode))]
    const stockList = stockCodes.map((code) => {
      const item = timeline.find((timelineItem) => timelineItem.stockCode === code)
      return {
        code,
        name: item?.stockName || code,
        market: 'SH' as const
      }
    })
    setStocks(stockList)
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
    setCurrentStock(stockCode, stockName)
    setSearchText('')
    clearSearchResults()
    message.success(`已选择: ${stockName || stockCode}`)
  }

  const getNoteCount = (stockCode: string) => {
    return timeline.filter(n => n.stockCode === stockCode).length
  }

  const getDisplayName = (item: { code: string; name: string }) => (
    item.name && item.name !== item.code ? `${item.name}+${item.code}` : item.code
  )

  const displayItems = searchText.trim()
    ? searchResults.map(r => ({
        code: r.stock.code,
        name: r.stock.name,
        market: r.stock.market,
        isFromSearch: true
      }))
    : stocks.map(s => ({
        code: typeof s === 'string' ? s : s.code,
        name: typeof s === 'string' ? s : s.name,
        market: 'SH' as const,
        isFromSearch: false
      }))

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-3 border-b border-gray-200">
        <Input
          placeholder="搜索股票..."
          prefix={localSearching ? <Spin size="small" /> : <SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </div>

      <div className="flex-1 overflow-auto">
        {displayItems.length > 0 ? (
          <List
            dataSource={displayItems}
            renderItem={(item: any) => (
              <List.Item
                className={`px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                  currentStockCode === item.code ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                }`}
                onClick={() => handleSelectStock(item.code, item.name)}
              >
                <div className="flex justify-between items-center w-full">
                  <div>
                      <div className="font-medium">{getDisplayName(item)}</div>
                      <div className="text-xs text-gray-400">
                      {getNoteCount(item.code)} 条事件 · {item.market === 'SH' ? '沪' : item.market === 'SZ' ? '深' : '北'}
                      </div>
                    </div>
                  {!item.isFromSearch && getNoteCount(item.code) > 0 && (
                    <Tag color="blue" className="text-xs">{getNoteCount(item.code)}</Tag>
                  )}
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description="搜索股票开始记录" className="mt-8" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>

      <div className="p-2 border-t border-gray-200 text-xs text-gray-400 text-center">
        {stocks.length} 只股票 · {timeline.length} 条笔记
      </div>
    </div>
  )
}

export default Sidebar
