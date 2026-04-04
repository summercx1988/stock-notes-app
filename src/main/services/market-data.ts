import fs from 'fs/promises'
import path from 'path'
import type { KlineInterval, MarketCandle } from '../../shared/types'
import { getDataPath } from './data-paths'

interface MarketCachePayload {
  stockCode: string
  interval: KlineInterval
  updatedAt: string
  candles: MarketCandle[]
}

export class MarketDataService {
  private readonly cacheDir: string

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || getDataPath('market')
  }

  async getCandles(
    stockCode: string,
    interval: KlineInterval,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    const cached = await this.readCache(stockCode, interval)
    let merged = cached

    try {
      const fetched = await this.fetchFromApi(stockCode, interval, startDate, endDate)
      if (fetched.length > 0) {
        merged = this.mergeCandles(cached, fetched)
        await this.writeCache(stockCode, interval, merged)
      }
    } catch (error) {
      console.warn('[MarketDataService] API fetch failed, fallback to cache:', error)
    }

    return this.filterRange(merged, startDate, endDate)
  }

  private async fetchFromApi(
    stockCode: string,
    interval: KlineInterval,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    const secid = this.buildSecId(stockCode)
    const klt = this.intervalToKlt(interval)
    const beg = this.formatDateForApi(startDate || new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)))
    const end = this.formatDateForApi(endDate || new Date())

    const query = new URLSearchParams({
      secid,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56',
      klt,
      fqt: '1',
      beg,
      end
    })
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${query.toString()}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json,text/plain,*/*'
      }
    }).finally(() => {
      clearTimeout(timeout)
    })
    if (!response.ok) {
      throw new Error(`kline API ${response.status}`)
    }
    const json = await response.json() as { data?: { klines?: string[] } }
    const klines = json?.data?.klines || []

    return klines
      .map((line) => this.parseKlineLine(stockCode, line))
      .filter((item): item is MarketCandle => item !== null)
  }

  private parseKlineLine(stockCode: string, line: string): MarketCandle | null {
    const parts = line.split(',')
    if (parts.length < 6) return null

    const timestamp = this.parseEastMoneyTimestamp(parts[0])
    const open = Number(parts[1])
    const close = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    const volume = Number(parts[5])
    if (!timestamp || ![open, close, high, low, volume].every((value) => Number.isFinite(value))) {
      return null
    }

    return {
      stockCode,
      timestamp,
      open,
      close,
      high,
      low,
      volume
    }
  }

  private parseEastMoneyTimestamp(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return null

    const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dateOnly) {
      return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T15:00:00+08:00`
    }

    const withMinute = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
    if (withMinute) {
      return `${withMinute[1]}-${withMinute[2]}-${withMinute[3]}T${withMinute[4]}:${withMinute[5]}:00+08:00`
    }

    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toISOString()
  }

  private intervalToKlt(interval: KlineInterval): string {
    if (interval === '5m') return '5'
    if (interval === '15m') return '15'
    if (interval === '30m') return '30'
    if (interval === '60m') return '60'
    return '101'
  }

  private buildSecId(stockCode: string): string {
    const normalized = String(stockCode || '').trim().toUpperCase()
    const prefixedMatch = normalized.match(/^(SH|SZ|BJ)(\d{6})$/)
    if (prefixedMatch) {
      const market = prefixedMatch[1]
      const code = prefixedMatch[2]
      if (market === 'SH') return `1.${code}`
      if (market === 'SZ') return `0.${code}`
      return `0.${code}`
    }

    if (normalized.startsWith('6') || normalized.startsWith('5') || normalized.startsWith('9')) {
      return `1.${normalized}`
    }
    if (normalized.startsWith('8') || normalized.startsWith('4')) {
      return `0.${normalized}`
    }
    if (normalized.startsWith('399')) {
      return `0.${normalized}`
    }
    if (normalized === '000001') {
      return `1.${normalized}`
    }
    return `0.${normalized}`
  }

  private formatDateForApi(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  private cacheFile(stockCode: string, interval: KlineInterval): string {
    return path.join(this.cacheDir, `${stockCode}_${interval}.json`)
  }

  private async readCache(stockCode: string, interval: KlineInterval): Promise<MarketCandle[]> {
    try {
      const filePath = this.cacheFile(stockCode, interval)
      const content = await fs.readFile(filePath, 'utf-8')
      const payload = JSON.parse(content) as MarketCachePayload
      return payload.candles || []
    } catch {
      return []
    }
  }

  private async writeCache(stockCode: string, interval: KlineInterval, candles: MarketCandle[]): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    const filePath = this.cacheFile(stockCode, interval)
    const payload: MarketCachePayload = {
      stockCode,
      interval,
      updatedAt: new Date().toISOString(),
      candles
    }
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8')
  }

  private mergeCandles(base: MarketCandle[], incoming: MarketCandle[]): MarketCandle[] {
    const map = new Map<string, MarketCandle>()
    for (const candle of base) {
      map.set(candle.timestamp, candle)
    }
    for (const candle of incoming) {
      map.set(candle.timestamp, candle)
    }
    return Array.from(map.values()).sort((left, right) => {
      const leftTime = new Date(left.timestamp).getTime()
      const rightTime = new Date(right.timestamp).getTime()
      return leftTime - rightTime
    })
  }

  private filterRange(candles: MarketCandle[], startDate?: Date, endDate?: Date): MarketCandle[] {
    if (!startDate && !endDate) return candles

    return candles.filter((candle) => {
      const time = new Date(candle.timestamp).getTime()
      if (!Number.isFinite(time)) return false
      if (startDate && time < startDate.getTime()) return false
      if (endDate && time > endDate.getTime()) return false
      return true
    })
  }
}

export const marketDataService = new MarketDataService()
