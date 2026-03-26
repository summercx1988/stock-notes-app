import { distance } from 'fastest-levenshtein'
import fs from 'fs'
import { normalizeStockNameText, normalizeToSimplifiedChinese, toHalfWidthText } from '../../shared/text-normalizer'
import { getDataPath } from './data-paths'

interface Stock {
  code: string
  name: string
  pinyin?: string
}

interface StockArrayItem {
  code: string
  name: string
  pinyin?: string
  pinyinShort?: string
}

interface MatchResult {
  original: string
  matched: Stock | null
  distance: number
  confidence: number
}

class StockNameMatcher {
  private stocks: Stock[] = []
  private nameSet: Set<string> = new Set()
  private loaded: boolean = false

  async load(): Promise<void> {
    if (this.loaded) return

    const dbPath = getDataPath('stocks-database.json')
    
    try {
      const data = fs.readFileSync(dbPath, 'utf-8')
      const raw = JSON.parse(data) as StockArrayItem[] | Record<string, { name: string; pinyin?: string }>

      if (Array.isArray(raw)) {
        this.stocks = raw
          .filter((item) => item?.code && item?.name)
          .map((item) => ({
            code: String(item.code).trim(),
            name: normalizeStockNameText(item.name),
            pinyin: item.pinyin || item.pinyinShort
          }))
      } else {
        this.stocks = Object.entries(raw).map(([code, info]) => ({
          code: String(code).trim(),
          name: normalizeStockNameText(info.name),
          pinyin: info.pinyin
        }))
      }
      
      this.stocks.forEach(s => this.nameSet.add(s.name))
      this.loaded = true
      
      console.log(`[StockMatcher] Loaded ${this.stocks.length} stocks`)
    } catch (error) {
      console.error('[StockMatcher] Failed to load stocks:', error)
    }
  }

  extractChineseSegments(text: string): string[] {
    const normalizedText = normalizeToSimplifiedChinese(toHalfWidthText(text || ''))
    const segments: string[] = []
    const regex = /[\u4e00-\u9fa5]{2,6}/g
    let match
    
    while ((match = regex.exec(normalizedText)) !== null) {
      segments.push(match[0])
    }
    
    return [...new Set(segments)]
  }

  findBestMatch(segment: string): MatchResult {
    const normalizedSegment = normalizeStockNameText(segment)
    if (normalizedSegment.length < 3) {
      return {
        original: segment,
        matched: null,
        distance: Infinity,
        confidence: 0
      }
    }
    let bestMatch: Stock | null = null
    let minDistance = Infinity

    for (const stock of this.stocks) {
      const d = distance(normalizedSegment, stock.name)
      
      if (d < minDistance) {
        minDistance = d
        bestMatch = stock
      }
    }

    const maxDistance = Math.max(1, Math.floor(normalizedSegment.length * 0.3))
    const confidence = Math.max(0, 1 - minDistance / Math.max(1, normalizedSegment.length))

    if (minDistance <= maxDistance && minDistance <= 2) {
      return {
        original: normalizedSegment,
        matched: bestMatch,
        distance: minDistance,
        confidence
      }
    }

    return {
      original: segment,
      matched: null,
      distance: minDistance,
      confidence: 0
    }
  }

  correctText(text: string): { text: string; matches: MatchResult[] } {
    const normalizedText = normalizeToSimplifiedChinese(toHalfWidthText(text || ''))
    const segments = this.extractChineseSegments(normalizedText)
    const matches: MatchResult[] = []
    let correctedText = normalizedText

    for (const segment of segments) {
      if (this.nameSet.has(segment)) {
        continue
      }

      const result = this.findBestMatch(segment)
      
      if (result.matched && result.distance > 0) {
        matches.push(result)
        correctedText = correctedText.replace(segment, result.matched.name)
        console.log(`[StockMatcher] Corrected: "${segment}" -> "${result.matched.name}" (distance: ${result.distance})`)
      }
    }

    return { text: correctedText, matches }
  }

  findStockInText(text: string): { stock: Stock; confidence: number } | null {
    const segments = this.extractChineseSegments(text)

    for (const segment of segments) {
      if (this.nameSet.has(segment)) {
        const stock = this.stocks.find(s => s.name === segment)!
        return { stock, confidence: 1.0 }
      }
    }

    for (const segment of segments) {
      const result = this.findBestMatch(segment)
      if (result.matched && result.confidence > 0.7) {
        return { stock: result.matched, confidence: result.confidence }
      }
    }

    return null
  }

  findAllCandidates(text: string): { segment: string; stock: Stock; distance: number; confidence: number }[] {
    const segments = this.extractChineseSegments(text)
    const candidates: { segment: string; stock: Stock; distance: number; confidence: number }[] = []

    for (const segment of segments) {
      if (this.nameSet.has(segment)) {
        const stock = this.stocks.find(s => s.name === segment)!
        candidates.push({ segment, stock, distance: 0, confidence: 1.0 })
        continue
      }

      const result = this.findBestMatch(segment)
      if (result.matched && result.distance <= 2) {
        candidates.push({
          segment,
          stock: result.matched,
          distance: result.distance,
          confidence: result.confidence
        })
      }
    }

    return candidates
  }

  findByName(name: string): { code: string; name: string; confidence: number } | null {
    const normalizedName = normalizeStockNameText(name)
    const start = Date.now()

    const exactMatch = this.stocks.find(s => s.name === normalizedName)
    if (exactMatch) {
      console.log(`[StockMatcher] findByName exact match: ${Date.now() - start}ms`)
      return { code: exactMatch.code, name: exactMatch.name, confidence: 1.0 }
    }

    if (normalizedName.length < 3) {
      console.log(`[StockMatcher] findByName skip fuzzy for short name: ${Date.now() - start}ms`)
      return null
    }

    for (const stock of this.stocks) {
      const d = distance(normalizedName, stock.name)
      if (d <= 2) {
        const confidence = Math.max(0, 1 - d / Math.max(1, normalizedName.length))
        console.log(`[StockMatcher] findByName fuzzy match: ${Date.now() - start}ms`)
        return { code: stock.code, name: stock.name, confidence }
      }
    }

    console.log(`[StockMatcher] findByName not found: ${Date.now() - start}ms`)
    return null
  }
}

export const stockNameMatcher = new StockNameMatcher()
