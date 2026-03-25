import fs from 'fs/promises'
import path from 'path'
import { stockDatabase, type StockInfo } from './stock-db'
import type { WatchlistImportResult } from '../../shared/types'
import { getDataPath } from './data-paths'

interface WatchlistPayload {
  codes: string[]
  updatedAt: string
}

const WATCHLIST_PATH = getDataPath('watchlist.json')

class WatchlistService {
  private cache: WatchlistPayload | null = null
  private loadingPromise: Promise<WatchlistPayload> | null = null

  async getCodes(): Promise<string[]> {
    const payload = await this.ensureLoaded()
    return [...payload.codes]
  }

  async getStocks(): Promise<Array<StockInfo & { inDatabase: boolean }>> {
    await stockDatabase.ensureLoaded()
    const payload = await this.ensureLoaded()
    return payload.codes.map((code) => {
      const stock = stockDatabase.getByCode(code)
      if (stock) {
        return { ...stock, inDatabase: true }
      }
      return {
        code,
        name: code,
        market: 'SH',
        industry: '未知',
        sector: '未知',
        fullName: code,
        inDatabase: false
      }
    })
  }

  async importFromText(rawInput: string, mode: 'append' | 'replace' = 'append'): Promise<WatchlistImportResult> {
    const parsed = this.parseCodes(rawInput)
    const current = await this.ensureLoaded()
    const currentSet = new Set(current.codes)
    const importedCodes: string[] = []
    const duplicatedCodes: string[] = []

    const nextCodes: string[] = mode === 'replace' ? [] : [...current.codes]
    const nextSet = new Set(nextCodes)

    for (const code of parsed.codes) {
      if (nextSet.has(code)) {
        if (currentSet.has(code)) {
          duplicatedCodes.push(code)
        }
        continue
      }
      nextCodes.push(code)
      nextSet.add(code)
      importedCodes.push(code)
    }

    const nextPayload: WatchlistPayload = {
      codes: nextCodes,
      updatedAt: new Date().toISOString()
    }
    await this.persist(nextPayload)

    await stockDatabase.ensureLoaded()
    const knownStocks = nextCodes.reduce((sum, code) => sum + (stockDatabase.getByCode(code) ? 1 : 0), 0)

    return {
      mode,
      totalCodes: nextCodes.length,
      importedCodes,
      duplicatedCodes,
      invalidTokens: parsed.invalidTokens,
      knownStocks
    }
  }

  async clear(): Promise<void> {
    await this.persist({
      codes: [],
      updatedAt: new Date().toISOString()
    })
  }

  private async ensureLoaded(): Promise<WatchlistPayload> {
    if (this.cache) return this.cache
    if (this.loadingPromise) return this.loadingPromise

    this.loadingPromise = this.loadFromFile()
    const payload = await this.loadingPromise
    this.cache = payload
    this.loadingPromise = null
    return payload
  }

  private async loadFromFile(): Promise<WatchlistPayload> {
    try {
      const content = await fs.readFile(WATCHLIST_PATH, 'utf-8')
      const raw = JSON.parse(content) as Partial<WatchlistPayload>
      const codes = Array.isArray(raw.codes)
        ? raw.codes.map((code) => String(code).trim()).filter((code) => /^\d{6}$/.test(code))
        : []
      return {
        codes: [...new Set(codes)],
        updatedAt: raw.updatedAt || new Date().toISOString()
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.error('[Watchlist] load failed:', error?.message || String(error))
      }
      const emptyPayload: WatchlistPayload = {
        codes: [],
        updatedAt: new Date().toISOString()
      }
      await this.persist(emptyPayload)
      return emptyPayload
    }
  }

  private parseCodes(rawInput: string): { codes: string[]; invalidTokens: string[] } {
    const source = String(rawInput || '').trim()
    if (!source) {
      return { codes: [], invalidTokens: [] }
    }

    const tokenCandidates = source
      .split(/[\s,，;；、\n\r\t]+/g)
      .map((token) => token.trim())
      .filter(Boolean)

    const codeMatches = source.match(/\d{6}/g) || []
    const codes = [...new Set(codeMatches)]
    const codeSet = new Set(codes)

    const invalidTokens = tokenCandidates
      .filter((token) => !codeSet.has(token))
      .filter((token) => !/^\d{6}$/.test(token))

    return {
      codes,
      invalidTokens: [...new Set(invalidTokens)]
    }
  }

  private async persist(payload: WatchlistPayload): Promise<void> {
    await fs.mkdir(path.dirname(WATCHLIST_PATH), { recursive: true })
    await fs.writeFile(WATCHLIST_PATH, JSON.stringify(payload, null, 2), 'utf-8')
    this.cache = payload
  }
}

export const watchlistService = new WatchlistService()
