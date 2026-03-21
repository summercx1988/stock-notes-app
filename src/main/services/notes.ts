import { v4 as uuidv4 } from 'uuid'
import yaml from 'js-yaml'
import fs from 'fs/promises'
import path from 'path'
import type { StockNote, TimeEntry, TimelineItem, Viewpoint, Action } from '../../shared/types'

export class NotesService {
  private notesDir: string
  private cache: Map<string, StockNote> = new Map()
  
  constructor(notesDir?: string) {
    this.notesDir = notesDir || path.join(process.cwd(), 'data', 'stocks')
  }
  
  async addEntry(
    stockCode: string,
    data: {
      content: string
      viewpoint?: Viewpoint
      action?: Action
      audioFile?: string
      audioDuration?: number
      transcriptionConfidence?: number
    }
  ): Promise<TimeEntry> {
    const id = uuidv4()
    const now = new Date()
    
    const entry: TimeEntry = {
      id,
      timestamp: now,
      title: this.generateTitle(data.content),
      content: data.content,
      viewpoint: data.viewpoint,
      action: data.action,
      keywords: [],
      audioFile: data.audioFile,
      audioDuration: data.audioDuration,
      aiProcessed: false,
      transcriptionConfidence: data.transcriptionConfidence
    }
    
    await this.appendEntryToStockFile(stockCode, entry)
    
    return entry
  }
  
  async getStockNote(stockCode: string): Promise<StockNote | null> {
    const cached = this.cache.get(stockCode)
    if (cached) return cached
    
    const filePath = this.getStockFilePath(stockCode)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const note = await this.parseStockNote(content)
      this.cache.set(stockCode, note)
      return note
    } catch {
      return null
    }
  }
  
  async getEntries(stockCode: string): Promise<TimeEntry[]> {
    const note = await this.getStockNote(stockCode)
    return note?.entries || []
  }
  
  async getEntriesByTimeRange(
    stockCode: string,
    startDate: Date,
    endDate: Date
  ): Promise<TimeEntry[]> {
    const entries = await this.getEntries(stockCode)
    return entries.filter(e => {
      const t = new Date(e.timestamp)
      return t >= startDate && t <= endDate
    })
  }
  
  async updateEntry(
    stockCode: string,
    entryId: string,
    data: Partial<TimeEntry>
  ): Promise<TimeEntry> {
    const entries = await this.getEntries(stockCode)
    const entry = entries.find(e => e.id === entryId)
    
    if (!entry) throw new Error(`Entry not found: ${entryId}`)
    
    const updated: TimeEntry = {
      ...entry,
      ...data,
      id: entry.id,
      timestamp: entry.timestamp
    }
    
    await this.rewriteStockFile(stockCode)
    
    return updated
  }
  
  async deleteEntry(stockCode: string, _entryId: string): Promise<void> {
    await this.rewriteStockFile(stockCode)
  }
  
  async getTimeline(filters?: {
    stockCode?: string
    startDate?: Date
    endDate?: Date
    viewpoint?: string
  }): Promise<TimelineItem[]> {
    const stockCodes = await this.getAllStockCodes()
    const items: TimelineItem[] = []
    
    for (const code of stockCodes) {
      if (filters?.stockCode && code !== filters.stockCode) continue
      
      const note = await this.getStockNote(code)
      if (!note) continue
      
      for (const entry of note.entries) {
        if (filters?.viewpoint && entry.viewpoint?.direction !== filters.viewpoint) continue
        if (filters?.startDate && new Date(entry.timestamp) < filters.startDate) continue
        if (filters?.endDate && new Date(entry.timestamp) > filters.endDate) continue
        
        items.push({
          id: entry.id,
          stockCode: code,
          stockName: note.stockName,
          timestamp: new Date(entry.timestamp),
          title: entry.title,
          viewpoint: entry.viewpoint,
          hasAudio: !!entry.audioFile
        })
      }
    }
    
    return items.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  }
  
  private generateTitle(content: string): string {
    const firstLine = content.split('\n')[0]
    return firstLine.slice(0, 50) || '无标题'
  }
  
  private async appendEntryToStockFile(stockCode: string, entry: TimeEntry): Promise<void> {
    const filePath = this.getStockFilePath(stockCode)

    let existingContent = ''
    try {
      existingContent = await fs.readFile(filePath, 'utf-8')
    } catch {
      await this.createStockFile(stockCode, entry)
      return
    }

    const entryMarkdown = this.entryToMarkdown(entry, stockCode)

    const frontMatterEnd = existingContent.indexOf('---\n\n')
    if (frontMatterEnd !== -1) {
      const insertPos = frontMatterEnd + 4
      const updatedContent = existingContent.slice(0, insertPos) + entryMarkdown + '\n\n' + existingContent.slice(insertPos)
      await fs.writeFile(filePath, updatedContent, 'utf-8')
    } else {
      await fs.appendFile(filePath, '\n\n' + entryMarkdown, 'utf-8')
    }

    this.cache.delete(stockCode)
  }
  
  private async createStockFile(stockCode: string, entry?: TimeEntry): Promise<void> {
    const filePath = this.getStockFilePath(stockCode)
    await fs.mkdir(path.dirname(filePath), { recursive: true })

    const stockInfo = await this.getStockInfo(stockCode)

    const frontMatter = {
      stock_code: stockCode,
      stock_name: stockInfo?.name || stockCode,
      market: stockInfo?.market || 'SH',
      industry: stockInfo?.industry,
      sector: stockInfo?.sector,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_entries: entry ? 1 : 0,
      total_audio_duration: entry?.audioDuration || 0
    }

    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1 })
    let content = `---\n${yamlStr}---\n\n# ${stockInfo?.name || stockCode} 投资笔记\n`

    if (entry) {
      content += '\n\n' + this.entryToMarkdown(entry, stockCode)
    }

    await fs.writeFile(filePath, content, 'utf-8')
  }
  
  private async rewriteStockFile(stockCode: string): Promise<void> {
    const stockNote = await this.getStockNote(stockCode)
    if (!stockNote) return
    
    const filePath = this.getStockFilePath(stockCode)
    
    const frontMatter = {
      stock_code: stockNote.stockCode,
      stock_name: stockNote.stockName,
      market: stockNote.market,
      industry: stockNote.industry,
      sector: stockNote.sector,
      created_at: stockNote.createdAt.toISOString(),
      updated_at: new Date().toISOString(),
      total_entries: stockNote.entries.length,
      total_audio_duration: stockNote.entries.reduce((sum, e) => sum + (e.audioDuration || 0), 0)
    }
    
    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1 })
    let content = `---\n${yamlStr}---\n\n# ${stockNote.stockName} 投资笔记\n`
    
    let currentDate = ''
    for (const entry of stockNote.entries) {
      const timestamp = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp)
      const entryDate = timestamp.toISOString().split('T')[0]
      if (entryDate !== currentDate) {
        content += `\n---\n\n## 📅 ${entryDate}\n`
        currentDate = entryDate
      }
      content += this.entryToMarkdown(entry, stockNote.stockCode)
    }
    
    await fs.writeFile(filePath, content, 'utf-8')
    this.cache.delete(stockNote.stockCode)
  }
  
  private entryToMarkdown(entry: TimeEntry, stockCode?: string): string {
    const ts = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp)
    const time = ts.toTimeString().slice(0, 5)
    
    let md = `\n### 🕐 ${time} ${entry.title}\n\n`
    
    if (entry.viewpoint) {
      md += `> **观点**: ${entry.viewpoint.direction} (信心: ${entry.viewpoint.confidence}) | **周期**: ${entry.viewpoint.timeHorizon}\n`
    }
    
    if (entry.keywords.length > 0) {
      md += `> \n> **关键词**: ${entry.keywords.join(', ')}\n`
    }
    
    md += `\n${entry.content}\n`
    
    if (entry.action) {
      md += `\n**操作记录**:\n- **${entry.action.type}**: ${entry.action.quantity}股 @ ${entry.action.price}元\n- **理由**: ${entry.action.reason}\n`
    }
    
    if (entry.audioFile && stockCode) {
      md += `\n*音频: [${path.basename(entry.audioFile)}](../audio/${stockCode}/${path.basename(entry.audioFile)}) (${entry.audioDuration || 0}秒)*\n`
    }
    
    return md
  }
  
  private async parseStockNote(content: string): Promise<StockNote> {
    const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
    if (!match) throw new Error('Invalid note format')
    
    const frontMatter = yaml.load(match[1]) as any
    const body = match[2]
    
    const entries = this.parseEntries(body)
    
    return {
      stockCode: frontMatter.stock_code,
      stockName: frontMatter.stock_name,
      market: frontMatter.market,
      industry: frontMatter.industry,
      sector: frontMatter.sector,
      createdAt: new Date(frontMatter.created_at),
      updatedAt: new Date(frontMatter.updated_at),
      totalEntries: frontMatter.total_entries || entries.length,
      totalAudioDuration: frontMatter.total_audio_duration || 0,
      entries
    }
  }
  
  private parseEntries(body: string): TimeEntry[] {
    const entries: TimeEntry[] = []
    const sections = body.split(/### 🕐 /)
    
    for (const section of sections.slice(1)) {
      const lines = section.split('\n')
      const titleLine = lines[0]
      const timeMatch = titleLine.match(/^(\d{2}:\d{2})\s+(.+)/)
      
      if (timeMatch) {
        entries.push({
          id: uuidv4(),
          timestamp: new Date(),
          title: timeMatch[2].trim(),
          content: lines.slice(1).join('\n').trim(),
          keywords: [],
          aiProcessed: false
        })
      }
    }
    
    return entries
  }
  
  private async getAllStockCodes(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.notesDir)
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => f.replace('.md', ''))
    } catch {
      return []
    }
  }
  
  private getStockFilePath(stockCode: string): string {
    return path.join(this.notesDir, `${stockCode}.md`)
  }
  
  private async getStockInfo(stockCode: string): Promise<{
    name: string
    market: string
    industry?: string
    sector?: string
  } | null> {
    const mockData: Record<string, any> = {
      '600519': { name: '贵州茅台', market: 'SH', industry: '白酒', sector: '消费' },
      '000858': { name: '五粮液', market: 'SZ', industry: '白酒', sector: '消费' },
      '000001': { name: '平安银行', market: 'SZ', industry: '银行', sector: '金融' }
    }
    
    return mockData[stockCode] || { name: stockCode, market: 'SH' }
  }
}
