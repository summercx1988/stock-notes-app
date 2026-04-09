import { ipcMain } from 'electron'
import { stockDatabase, type StockInfo, type SearchResult } from '../services/stock-db'
import { cleanTranscriptText } from '../../shared/text-normalizer'
import { watchlistService } from '../services/watchlist'

ipcMain.handle('stock:search', async (_, query: string, limit?: number): Promise<SearchResult[]> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.search(query, limit)
})

ipcMain.handle('stock:getByCode', async (_, code: string): Promise<StockInfo | null> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.getByCode(code) || null
})

ipcMain.handle('stock:getByCodes', async (_, codes: string[]): Promise<Record<string, StockInfo>> => {
  await stockDatabase.ensureLoaded()
  const result = stockDatabase.getByCodes(codes)
  const record: Record<string, StockInfo> = {}
  for (const [code, stock] of result) {
    record[code] = stock
  }
  return record
})

ipcMain.handle('stock:getByName', async (_, name: string): Promise<StockInfo | null> => {
  await stockDatabase.ensureLoaded()
  return stockDatabase.getByName(name) || null
})

ipcMain.handle('stock:match', async (_, text: string): Promise<SearchResult | null> => {
  await stockDatabase.ensureLoaded()
  const cleaned = cleanTranscriptText(text || '')
  const watchlistCodes = await watchlistService.getCodes()

  if (watchlistCodes.length > 0) {
    for (const code of watchlistCodes) {
      const stock = stockDatabase.getByCode(code)
      if (!stock) continue
      if (cleaned.includes(code) || cleaned.includes(stock.name)) {
        return {
          stock,
          matchType: 'name',
          score: 99
        }
      }
    }
  }
  return stockDatabase.matchStock(cleaned)
})
