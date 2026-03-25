import fs from 'fs/promises'
import { normalizeStockNameText, normalizeToSimplifiedChinese, toHalfWidthText } from '../../shared/text-normalizer'
import { getDataPath } from './data-paths'

export interface StockInfo {
  code: string
  name: string
  market: 'SH' | 'SZ' | 'BJ'
  industry: string
  sector: string
  fullName: string
  description?: string
}

export interface SearchResult {
  stock: StockInfo
  matchType: 'code' | 'name' | 'fuzzy'
  score: number
}

const DATABASE_PATH = getDataPath('stocks-database.json')

class StockDatabase {
  private stocks: Map<string, StockInfo> = new Map()
  private nameIndex: Map<string, StockInfo> = new Map()
  private isLoaded: boolean = false
  private loadPromise: Promise<void> | null = null

  async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return

    if (this.loadPromise) {
      return this.loadPromise
    }

    this.loadPromise = this.loadFromFile().then(() => {
      this.isLoaded = true
    })

    return this.loadPromise
  }

  private async loadFromFile(): Promise<void> {
    try {
      const content = await fs.readFile(DATABASE_PATH, 'utf-8')
      const stocks: StockInfo[] = JSON.parse(content)

      console.log(`[StockDB] 加载 ${stocks.length} 只股票数据`)

      for (const stock of stocks) {
        const normalizedStock = this.normalizeStockInfo(stock)
        this.stocks.set(normalizedStock.code, normalizedStock)
        this.indexStockName(normalizedStock)
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[StockDB] 股票数据库文件不存在，使用内存数据')
      } else {
        console.error('[StockDB] 加载失败:', error.message)
      }
      this.loadDefaultStocks()
    }
  }

  private loadDefaultStocks(): void {
    const defaultStocks: StockInfo[] = [
      { code: '600519', name: '贵州茅台', market: 'SH', industry: '白酒', sector: '食品饮料', fullName: '贵州茅台酒股份有限公司' },
      { code: '000858', name: '五粮液', market: 'SZ', industry: '白酒', sector: '食品饮料', fullName: '宜宾五粮液股份有限公司' },
      { code: '600036', name: '招商银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '招商银行股份有限公司' },
      { code: '601318', name: '中国平安', market: 'SH', industry: '保险', sector: '金融服务', fullName: '中国平安保险股份有限公司' },
      { code: '000001', name: '平安银行', market: 'SZ', industry: '银行', sector: '金融服务', fullName: '平安银行股份有限公司' },
      { code: '600016', name: '民生银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国民生银行股份有限公司' },
      { code: '601166', name: '兴业银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '兴业银行股份有限公司' },
      { code: '600000', name: '浦发银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '上海浦东发展银行股份有限公司' },
      { code: '601398', name: '工商银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国工商银行股份有限公司' },
      { code: '601288', name: '农业银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国农业银行股份有限公司' },
      { code: '601939', name: '建设银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国建设银行股份有限公司' },
      { code: '601988', name: '中国银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '中国银行股份有限公司' },
      { code: '601328', name: '交通银行', market: 'SH', industry: '银行', sector: '金融服务', fullName: '交通银行股份有限公司' },
      { code: '600028', name: '中国石化', market: 'SH', industry: '石油化工', sector: '能源', fullName: '中国石油化工股份有限公司' },
      { code: '601857', name: '中国石油', market: 'SH', industry: '石油化工', sector: '能源', fullName: '中国石油天然气股份有限公司' },
      { code: '600050', name: '中国联通', market: 'SH', industry: '通信', sector: '科技', fullName: '中国联合网络通信股份有限公司' },
      { code: '600030', name: '中信证券', market: 'SH', industry: '证券', sector: '金融服务', fullName: '中信证券股份有限公司' },
      { code: '601012', name: '隆基绿能', market: 'SH', industry: '光伏', sector: '新能源', fullName: '隆基绿能科技股份有限公司' },
      { code: '600900', name: '长江电力', market: 'SH', industry: '电力', sector: '公用事业', fullName: '中国长江电力股份有限公司' },
      { code: '601888', name: '中国中免', market: 'SH', industry: '旅游零售', sector: '消费', fullName: '中国旅游集团中免股份有限公司' },
      { code: '600276', name: '恒瑞医药', market: 'SH', industry: '医药生物', sector: '医疗', fullName: '江苏恒瑞医药股份有限公司' },
      { code: '000333', name: '美的集团', market: 'SZ', industry: '家电', sector: '消费', fullName: '美的集团股份有限公司' },
      { code: '600887', name: '伊利股份', market: 'SH', industry: '乳制品', sector: '消费', fullName: '内蒙古伊利实业集团股份有限公司' },
      { code: '600309', name: '万华化学', market: 'SH', industry: '化工', sector: '原材料', fullName: '万华化学集团股份有限公司' },
      { code: '601899', name: '紫金矿业', market: 'SH', industry: '有色金属', sector: '原材料', fullName: '紫金矿业集团股份有限公司' },
      { code: '600585', name: '海螺水泥', market: 'SH', industry: '建材', sector: '原材料', fullName: '安徽海螺水泥股份有限公司' },
      { code: '002475', name: '立讯精密', market: 'SZ', industry: '消费电子', sector: '科技', fullName: '立讯精密工业股份有限公司' },
      { code: '300750', name: '宁德时代', market: 'SZ', industry: '锂电池', sector: '新能源', fullName: '宁德时代新能源科技股份有限公司' },
      { code: '688981', name: '中芯国际', market: 'SH', industry: '半导体', sector: '科技', fullName: '中芯国际集成电路制造有限公司' },
      { code: '002594', name: '比亚迪', market: 'SZ', industry: '新能源汽车', sector: '新能源', fullName: '比亚迪股份有限公司' },
      { code: '600104', name: '上汽集团', market: 'SH', industry: '汽车', sector: '汽车', fullName: '上海汽车集团股份有限公司' },
      { code: '600837', name: '海通证券', market: 'SH', industry: '证券', sector: '金融服务', fullName: '海通证券股份有限公司' },
      { code: '000725', name: '京东方A', market: 'SZ', industry: '显示面板', sector: '科技', fullName: '京东方科技集团股份有限公司' },
      { code: '601138', name: '工业富联', market: 'SH', industry: '电子制造', sector: '科技', fullName: '富士康工业互联网股份有限公司' },
      { code: '002415', name: '海康威视', market: 'SZ', industry: '安防', sector: '科技', fullName: '杭州海康威视数字技术股份有限公司' },
      { code: '601668', name: '中国建筑', market: 'SH', industry: '建筑', sector: '建筑', fullName: '中国建筑股份有限公司' },
      { code: '600048', name: '保利发展', market: 'SH', industry: '房地产', sector: '房地产', fullName: '保利发展控股集团股份有限公司' },
      { code: '000002', name: '万科A', market: 'SZ', industry: '房地产', sector: '房地产', fullName: '万科企业股份有限公司' },
    ]

    for (const stock of defaultStocks) {
      const normalizedStock = this.normalizeStockInfo(stock)
      this.stocks.set(normalizedStock.code, normalizedStock)
      this.indexStockName(normalizedStock)
    }

    console.log(`[StockDB] 加载了 ${defaultStocks.length} 只默认股票`)
  }

  search(query: string, limit: number = 10): SearchResult[] {
    if (!query.trim()) return []

    const results: SearchResult[] = []
    const normalizedQuery = normalizeStockNameText(query)
    const lowerQuery = normalizedQuery.toLowerCase()

    // 精确代码匹配
    const exactCode = this.stocks.get(query.trim())
    if (exactCode) {
      results.push({ stock: exactCode, matchType: 'code', score: 100 })
      return results
    }

    // 精确名称匹配
    const exactName = this.nameIndex.get(normalizedQuery)
    if (exactName) {
      results.push({ stock: exactName, matchType: 'name', score: 100 })
    }

    // 模糊匹配
    for (const [code, stock] of this.stocks) {
      if (code === query.trim()) continue

      let score = 0
      let matchType: 'code' | 'name' | 'fuzzy' = 'fuzzy'

      // 代码前缀匹配
      if (code.startsWith(query.trim())) {
        score = 80
        matchType = 'code'
      }
      // 名称开头匹配
      else if (normalizeStockNameText(stock.name).startsWith(normalizedQuery)) {
        score = 90
        matchType = 'name'
      }
      // 名称包含匹配
      else if (normalizeStockNameText(stock.name).toLowerCase().includes(lowerQuery)) {
        score = 70
        matchType = 'name'
      }
      // 全名包含匹配
      else if (normalizeStockNameText(stock.fullName).toLowerCase().includes(lowerQuery)) {
        score = 60
        matchType = 'name'
      }

      if (score > 0) {
        results.push({ stock, matchType, score })
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  getByCode(code: string): StockInfo | undefined {
    return this.stocks.get(code)
  }

  getByName(name: string): StockInfo | undefined {
    return this.nameIndex.get(normalizeStockNameText(name))
  }

  matchStock(text: string): SearchResult | null {
    const normalizedText = normalizeToSimplifiedChinese(toHalfWidthText(text || ''))
    const lowerText = normalizeStockNameText(normalizedText).toLowerCase()

    // 尝试匹配 6 位数字代码
    const codeMatch = normalizedText.match(/\b(\d{6})\b/)
    if (codeMatch) {
      const stock = this.stocks.get(codeMatch[1])
      if (stock) {
        return { stock, matchType: 'code', score: 100 }
      }
    }

    // 尝试精确匹配名称
    for (const [name, stock] of this.nameIndex) {
      if (lowerText.includes(name.toLowerCase())) {
        return { stock, matchType: 'name', score: 95 }
      }
    }

    // 尝试模糊匹配（至少 2 个字符）
    if (lowerText.length >= 2) {
      for (const stock of this.stocks.values()) {
        const name = normalizeStockNameText(stock.name).toLowerCase()
        if (name.includes(lowerText) || lowerText.includes(name.substring(0, 2))) {
          return { stock, matchType: 'fuzzy', score: 70 }
        }
      }
    }

    return null
  }

  getAll(): StockInfo[] {
    return Array.from(this.stocks.values())
  }

  getCount(): number {
    return this.stocks.size
  }

  isReady(): boolean {
    return this.isLoaded
  }

  private normalizeStockInfo(stock: StockInfo): StockInfo {
    const code = String(stock.code || '').trim()
    const normalizedName = normalizeStockNameText(stock.name || code) || code
    const normalizedFullName = normalizeStockNameText(stock.fullName || stock.name || code) || normalizedName
    return {
      ...stock,
      code,
      name: normalizedName,
      fullName: normalizedFullName,
      industry: normalizeToSimplifiedChinese(toHalfWidthText(stock.industry || '未知')),
      sector: normalizeToSimplifiedChinese(toHalfWidthText(stock.sector || '未知'))
    }
  }

  private indexStockName(stock: StockInfo): void {
    const aliases = new Set<string>([
      stock.name,
      stock.fullName,
      normalizeStockNameText(stock.name),
      normalizeStockNameText(stock.fullName)
    ])
    for (const alias of aliases) {
      if (alias) {
        this.nameIndex.set(alias, stock)
      }
    }
  }
}

export const stockDatabase = new StockDatabase()
