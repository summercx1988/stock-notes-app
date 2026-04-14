import fs from 'fs/promises'
import path from 'path'
import type { KlineInterval, MarketCandle, ReviewMarketDataStatus } from '../../shared/types'
import { getDataPath } from './data-paths'

interface MarketCachePayload {
  stockCode: string
  interval: KlineInterval
  updatedAt: string
  candles: MarketCandle[]
}

interface MarketCandlesResult {
  candles: MarketCandle[]
  status: ReviewMarketDataStatus
}

const FETCH_TIMEOUT_MS = 8000
const MINUTE_PAGE_SIZE = 800
const DAILY_MAX_COUNT = 400
const DAY_MS = 24 * 60 * 60 * 1000
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000

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
    const result = await this.getCandlesWithStatus(stockCode, interval, startDate, endDate)
    return result.candles
  }

  async getCandlesWithStatus(
    stockCode: string,
    interval: KlineInterval,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandlesResult> {
    const cachedPayload = await this.readCachePayload(stockCode, interval)
    const cached = cachedPayload?.candles || []
    let merged = cached
    let status: ReviewMarketDataStatus = {
      source: 'live',
      stale: false,
      cacheUpdatedAt: cachedPayload?.updatedAt || null
    }

    try {
      const fetched = await this.fetchFromApi(stockCode, interval, startDate, endDate)
      if (fetched.length > 0) {
        merged = this.mergeCandles(cached, fetched)
        const updatedAt = new Date().toISOString()
        await this.writeCache(stockCode, interval, merged, updatedAt)
        status = {
          source: 'live',
          stale: false,
          cacheUpdatedAt: updatedAt
        }
      }
    } catch (error) {
      console.warn('[MarketDataService] API fetch failed, fallback to cache:', error)
      const lastError = error instanceof Error ? error.message : String(error)
      status = {
        source: 'cache',
        stale: true,
        cacheUpdatedAt: cachedPayload?.updatedAt || null,
        lastError,
        message: cached.length > 0
          ? '行情刷新失败，当前展示的是本地缓存数据。'
          : '行情刷新失败，当前没有可用缓存数据。'
      }
    }

    return {
      candles: this.filterRange(merged, startDate, endDate),
      status
    }
  }

  private async fetchFromApi(
    stockCode: string,
    interval: KlineInterval,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    try {
      return await this.fetchFromTencentApi(stockCode, interval, startDate, endDate)
    } catch (tencentError) {
      console.warn('[MarketDataService] Tencent fetch failed, fallback to EastMoney:', tencentError)
      return this.fetchFromEastMoneyApi(stockCode, interval, startDate, endDate)
    }
  }

  private async fetchFromTencentApi(
    stockCode: string,
    interval: KlineInterval,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    if (interval === '1d') {
      return this.fetchTencentDailyCandles(stockCode, startDate, endDate)
    }
    return this.fetchTencentMinuteCandles(stockCode, interval, startDate, endDate)
  }

  private async fetchTencentMinuteCandles(
    stockCode: string,
    interval: Exclude<KlineInterval, '1d'>,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    const collected = new Map<string, MarketCandle>()
    const requiredBars = this.estimateRequiredBars(interval, startDate, endDate)
    const maxPages = Math.max(1, Math.min(8, Math.ceil(requiredBars / MINUTE_PAGE_SIZE)))
    const anchorOffsetMs = this.intervalToMs(interval)
    const useLatestPage = !endDate || this.formatDateForTencentDaily(endDate) >= this.formatDateForTencentDaily(new Date())
    let anchor = useLatestPage ? '' : this.toTencentMinuteAnchor(new Date(endDate.getTime() + anchorOffsetMs))

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const page = await this.fetchTencentMinutePage(stockCode, interval, anchor, MINUTE_PAGE_SIZE)
      if (page.candles.length === 0) {
        break
      }

      for (const candle of page.candles) {
        collected.set(candle.timestamp, candle)
      }

      if (!startDate) {
        break
      }

      const earliestTimestamp = new Date(page.candles[0].timestamp).getTime()
      if (!Number.isFinite(earliestTimestamp) || earliestTimestamp <= startDate.getTime()) {
        break
      }

      if (!page.firstKey) {
        break
      }

      anchor = page.firstKey
    }

    return Array.from(collected.values()).sort((left, right) => {
      const leftTime = new Date(left.timestamp).getTime()
      const rightTime = new Date(right.timestamp).getTime()
      return leftTime - rightTime
    })
  }

  private async fetchTencentMinutePage(
    stockCode: string,
    interval: Exclude<KlineInterval, '1d'>,
    anchor: string,
    count: number
  ): Promise<{ candles: MarketCandle[]; firstKey: string | null }> {
    const symbol = this.buildTencentSymbol(stockCode)
    const period = this.intervalToTencentPeriod(interval)
    const param = `${symbol},${period},${anchor || ''},${count}`
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${encodeURIComponent(param)}`
    const response = await this.fetchJson(url) as { data?: Record<string, Record<string, unknown[]>> }
    const payload = response?.data?.[symbol]
    const rows = Array.isArray(payload?.[period]) ? payload[period] as unknown[] : []
    const candles = rows
      .map((row) => this.parseTencentMinuteLine(stockCode, row))
      .filter((item): item is MarketCandle => item !== null)

    const firstKey = Array.isArray(rows[0]) ? String((rows[0] as unknown[])[0] || '').trim() || null : null
    return { candles, firstKey }
  }

  private async fetchTencentDailyCandles(
    stockCode: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<MarketCandle[]> {
    const symbol = this.buildTencentSymbol(stockCode)
    const start = startDate ? this.formatDateForTencentDaily(startDate) : ''
    const end = endDate ? this.formatDateForTencentDaily(endDate) : ''
    const param = `${symbol},day,${start},${end},${DAILY_MAX_COUNT},qfq`
    const url = `https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(param)}`
    const response = await this.fetchJson(url) as { data?: Record<string, Record<string, unknown[]>> }
    const payload = response?.data?.[symbol]
    const rows = Array.isArray(payload?.qfqday) ? payload.qfqday as unknown[] : []

    return rows
      .map((row) => this.parseTencentDailyLine(stockCode, row))
      .filter((item): item is MarketCandle => item !== null)
  }

  private async fetchFromEastMoneyApi(
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
    const response = await this.fetchJson(url) as { data?: { klines?: string[] } }
    const klines = response?.data?.klines || []

    return klines
      .map((line) => this.parseKlineLine(stockCode, line))
      .filter((item): item is MarketCandle => item !== null)
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
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
    return response.json()
  }

  private parseTencentMinuteLine(stockCode: string, raw: unknown): MarketCandle | null {
    if (!Array.isArray(raw) || raw.length < 6) return null

    const timestamp = this.parseTencentMinuteTimestamp(raw[0])
    const open = Number(raw[1])
    const close = Number(raw[2])
    const high = Number(raw[3])
    const low = Number(raw[4])
    const volume = Number(raw[5])
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

  private parseTencentDailyLine(stockCode: string, raw: unknown): MarketCandle | null {
    if (!Array.isArray(raw) || raw.length < 6) return null

    const timestamp = this.parseTencentDailyTimestamp(raw[0])
    const open = Number(raw[1])
    const close = Number(raw[2])
    const high = Number(raw[3])
    const low = Number(raw[4])
    const volume = Number(raw[5])
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

  private parseTencentMinuteTimestamp(value: unknown): string | null {
    const text = String(value || '').trim()
    const matched = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/)
    if (!matched) return null
    return `${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}:${matched[5]}:00+08:00`
  }

  private parseTencentDailyTimestamp(value: unknown): string | null {
    const text = String(value || '').trim()
    const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!matched) return null
    return `${matched[1]}-${matched[2]}-${matched[3]}T15:00:00+08:00`
  }

  private intervalToKlt(interval: KlineInterval): string {
    if (interval === '5m') return '5'
    if (interval === '15m') return '15'
    if (interval === '30m') return '30'
    if (interval === '60m') return '60'
    return '101'
  }

  private intervalToTencentPeriod(interval: Exclude<KlineInterval, '1d'>): string {
    if (interval === '5m') return 'm5'
    if (interval === '15m') return 'm15'
    if (interval === '30m') return 'm30'
    return 'm60'
  }

  private intervalToMs(interval: Exclude<KlineInterval, '1d'>): number {
    if (interval === '5m') return 5 * 60 * 1000
    if (interval === '15m') return 15 * 60 * 1000
    if (interval === '30m') return 30 * 60 * 1000
    return 60 * 60 * 1000
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

  private buildTencentSymbol(stockCode: string): string {
    const normalized = String(stockCode || '').trim().toUpperCase()
    const prefixedMatch = normalized.match(/^(SH|SZ|BJ)(\d{6})$/)
    if (prefixedMatch) {
      return `${prefixedMatch[1].toLowerCase()}${prefixedMatch[2]}`
    }

    if (normalized.startsWith('6') || normalized.startsWith('5') || normalized.startsWith('9')) {
      return `sh${normalized}`
    }
    if (normalized.startsWith('8') || normalized.startsWith('4')) {
      return `bj${normalized}`
    }
    return `sz${normalized}`
  }

  private formatDateForApi(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }

  private formatDateForTencentDaily(date: Date): string {
    const shifted = new Date(date.getTime() + EIGHT_HOURS_MS)
    const year = shifted.getUTCFullYear()
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
    const day = String(shifted.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private toTencentMinuteAnchor(date: Date): string {
    const shifted = new Date(date.getTime() + EIGHT_HOURS_MS)
    const year = shifted.getUTCFullYear()
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
    const day = String(shifted.getUTCDate()).padStart(2, '0')
    const hour = String(shifted.getUTCHours()).padStart(2, '0')
    const minute = String(shifted.getUTCMinutes()).padStart(2, '0')
    return `${year}${month}${day}${hour}${minute}`
  }

  private estimateRequiredBars(interval: Exclude<KlineInterval, '1d'>, startDate?: Date, endDate?: Date): number {
    if (!startDate || !endDate) {
      return MINUTE_PAGE_SIZE
    }

    const calendarDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1)
    const tradingDays = Math.max(1, Math.ceil(calendarDays * 5 / 7) + 2)
    return Math.max(MINUTE_PAGE_SIZE, tradingDays * this.barsPerTradingDay(interval))
  }

  private barsPerTradingDay(interval: Exclude<KlineInterval, '1d'>): number {
    if (interval === '5m') return 48
    if (interval === '15m') return 16
    if (interval === '30m') return 8
    return 4
  }

  private cacheFile(stockCode: string, interval: KlineInterval): string {
    return path.join(this.cacheDir, `${stockCode}_${interval}.json`)
  }

  private async readCachePayload(stockCode: string, interval: KlineInterval): Promise<MarketCachePayload | null> {
    try {
      const filePath = this.cacheFile(stockCode, interval)
      const content = await fs.readFile(filePath, 'utf-8')
      const payload = JSON.parse(content) as MarketCachePayload
      return {
        stockCode,
        interval,
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
        candles: payload.candles || []
      }
    } catch {
      return null
    }
  }

  private async writeCache(
    stockCode: string,
    interval: KlineInterval,
    candles: MarketCandle[],
    updatedAt: string = new Date().toISOString()
  ): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true })
    const filePath = this.cacheFile(stockCode, interval)
    const payload: MarketCachePayload = {
      stockCode,
      interval,
      updatedAt,
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
