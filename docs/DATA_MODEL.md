# 数据模型设计 v2.0

> 状态说明：本文件包含早期数据建模设想，其中 SQLite 等内容已不代表当前实现。当前落盘方式请以 `docs/TECHNICAL_SPEC.md` 和实际代码为准。

## 核心设计理念

**一个股票 = 一个Markdown文件**
- 每个股票的所有笔记记录在一个文件中
- 文件内按时间轴组织，每次语音录入是一个时间节点
- 每个时间节点有精确到分钟的时间戳
- 每个时间节点必须带有笔记类别
- 新增事件后按 `event_time` 排序重写整个文档

## 文件组织结构

```
stock-notes/
├── stocks/                          # 股票笔记目录
│   ├── 600519-贵州茅台.md            # 一只股票一个文件
│   ├── 000858-五粮液.md
│   └── ...
├── audio/                           # 音频文件目录
│   ├── 600519/                      # 按股票代码组织
│   │   ├── 20240115-0930.wav        # 日期-时间.wav
│   │   ├── 20240115-1030.wav
│   │   └── ...
│   └── ...
├── data/                            
│   └── index.db                     # SQLite索引库
└── config/
    └── settings.yaml
```

## Markdown文件格式

```markdown
---
# === 股票基本信息 ===
stock_code: "600519"
stock_name: "贵州茅台"
market: "SH"
industry: "白酒"
sector: "消费"

# === 文档属性 ===
created_at: "2024-01-15T09:30:00+08:00"
updated_at: "2024-01-16T15:20:00+08:00"
total_entries: 12                    # 总记录条数
total_audio_duration: 1850           # 音频总时长(秒)

# === 统计信息 ===
statistics:
  viewpoint_distribution:
    bullish: 8
    bearish: 2
    neutral: 2
  action_summary:
    buy: 3
    sell: 1
    hold: 8

# === 标签云 ===
tags:
  - name: "突破"
    count: 5
  - name: "放量"
    count: 3
---

# 贵州茅台投资笔记

---

## 📅 2024-01-16

### 🕐 15:20 午盘观察

> **观点**: 看多 (信心: 0.8) | **周期**: 短线
> 
> **关键词**: 放量, 突破, 加仓

午后继续走强，成交量持续放大，突破1860元关键阻力位。

**技术分析**:
- 突破1860元阻力，确认有效
- 成交量较上午继续放大
- MACD红柱加长，动能强劲

**操作计划**:
- 建议加仓至200股
- 止损上移至1845元
- 目标价位1950元

**风险提示**: 需关注大盘走势，若大盘走弱可能影响个股表现。

*音频: [20240116-1520.wav](../audio/600519/20240116-1520.wav) (45秒)*

---

### 🕐 10:30 开盘观察

> **观点**: 看多 (信心: 0.75) | **周期**: 短线
> 
> **关键词**: 高开, 放量

今日高开于1850元，开盘后快速上冲，成交量明显放大。

**盘面观察**:
- 高开幅度约1.5%
- 5分钟成交量较昨日同期放大80%
- 买盘积极，卖压较轻

**操作计划**:
- 持有观望
- 若突破1860元可考虑加仓

*音频: [20240116-1030.wav](../audio/600519/20240116-1030.wav) (32秒)*

---

## 📅 2024-01-15

### 🕐 14:00 尾盘分析

> **观点**: 中性 (信心: 0.6) | **周期**: 中线
> 
> **关键词**: 震荡, 观望

全天震荡整理，尾盘略有回升，收盘于1835元。

**盘面总结**:
- 全天振幅约2%
- 成交量较昨日萎缩
- 尾盘有资金流入迹象

**后市展望**:
- 短期可能继续震荡
- 关注1850元阻力位
- 中线趋势仍然向好

*音频: [20240115-1400.wav](../audio/600519/20240115-1400.wav) (58秒)*

---

### 🕐 09:35 开盘笔记

> **观点**: 看多 (信心: 0.7) | **周期**: 短线
> 
> **关键词**: 低开, 抄底

今日低开于1820元，较昨日收盘下跌约0.8%。

**操作记录**:
- **买入**: 100股 @ 1825元
- **理由**: 技术面支撑位附近，有反弹需求

*音频: [20240115-0935.wav](../audio/600519/20240115-0935.wav) (28秒)*
```

## 时间节点数据结构

```typescript
type NoteCategory = '看盘预测' | '交易札记' | '备忘' | '资讯备忘'

interface TimeEntry {
  id: string                    // UUID
  timestamp: Date               // 精确时间戳（精确到分钟）
  category: NoteCategory        // 笔记类别
  title: string                 // 时间节点标题
  content: string               // 内容正文
  
  // 观点信息
  viewpoint?: {
    direction: '看多' | '看空' | '中性'
    confidence: number          // 0-1
    timeHorizon: '短线' | '中线' | '长线'
  }
  
  // 操作记录
  action?: {
    type: '买入' | '卖出' | '持有'
    price: number
    quantity: number
    reason: string
  }
  
  // 关键词标签
  keywords: string[]
  
  // 音频信息
  audioFile?: string            // 音频文件路径
  audioDuration?: number        // 音频时长(秒)
  
  // AI处理信息
  aiProcessed: boolean
  transcriptionConfidence?: number
}

interface StockNote {
  // YAML元数据
  stockCode: string
  stockName: string
  market: 'SH' | 'SZ' | 'BJ'
  industry?: string
  sector?: string
  
  // 文档属性
  createdAt: Date
  updatedAt: Date
  
  // 统计信息
  totalEntries: number
  totalAudioDuration: number
  
  // 时间轴条目
  entries: TimeEntry[]
}
```

## 复盘统计约束

- 只有 `看盘预测` 类别进入复盘引擎
- `交易札记`、`备忘`、`资讯备忘` 只参与检索、展示与经验沉淀

## SQLite索引设计

```sql
-- 股票信息表
CREATE TABLE stocks (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL,
    market TEXT,
    industry TEXT,
    sector TEXT,
    note_file TEXT,                    -- 笔记文件路径
    total_entries INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 时间节点索引表（用于快速检索）
CREATE TABLE time_entries (
    id TEXT PRIMARY KEY,
    stock_code TEXT NOT NULL,
    timestamp DATETIME NOT NULL,       -- 精确时间戳
    title TEXT,
    content TEXT,                      -- 用于全文搜索
    viewpoint_direction TEXT,
    viewpoint_confidence REAL,
    action_type TEXT,
    action_price REAL,
    keywords TEXT,                     -- JSON数组
    audio_file TEXT,
    audio_duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stock_code) REFERENCES stocks(stock_code)
);

-- 全文搜索索引
CREATE VIRTUAL TABLE entries_fts USING fts5(
    title,
    content,
    keywords,
    content='time_entries',
    content_rowid='rowid'
);

-- 创建索引
CREATE INDEX idx_entries_stock ON time_entries(stock_code);
CREATE INDEX idx_entries_timestamp ON time_entries(timestamp);
CREATE INDEX idx_entries_viewpoint ON time_entries(viewpoint_direction);
```

## 核心API设计

```typescript
// 添加时间节点
async function addEntry(
  stockCode: string,
  entry: {
    content: string
    viewpoint?: Viewpoint
    action?: Action
    audioFile?: string
  }
): Promise<TimeEntry>

// 获取股票的所有时间节点
async function getEntries(stockCode: string): Promise<TimeEntry[]>

// 获取时间范围内的节点
async function getEntriesByTimeRange(
  stockCode: string,
  startDate: Date,
  endDate: Date
): Promise<TimeEntry[]>

// 更新时间节点
async function updateEntry(
  stockCode: string,
  entryId: string,
  data: Partial<TimeEntry>
): Promise<TimeEntry>

// 删除时间节点
async function deleteEntry(
  stockCode: string,
  entryId: string
): Promise<void>

// 获取时间轴视图
async function getTimeline(
  filters?: {
    stockCode?: string
    startDate?: Date
    endDate?: Date
    viewpoint?: string
  }
): Promise<TimelineItem[]>
```

## 时间轴展示逻辑

```
时间轴视图：

2024-01-16
├── 15:20 午盘观察 (看多)
│   └── 放量突破1860元...
├── 10:30 开盘观察 (看多)
│   └── 高开高走，成交量放大...
│
2024-01-15
├── 14:00 尾盘分析 (中性)
│   └── 全天震荡整理...
├── 09:35 开盘笔记 (看多)
│   └── 低开抄底，买入100股...
```

## 与原方案的区别

| 维度 | 原方案 | 新方案 |
|------|--------|--------|
| 文件粒度 | 每次录入一个文件 | 一个股票一个文件 |
| 时间组织 | 文件名包含时间 | 文件内时间轴组织 |
| 数据管理 | 分散在多个文件 | 集中在单一文件 |
| 检索效率 | 需遍历多个文件 | SQLite索引快速检索 |
| 用户视角 | 文件列表 | 时间轴视图 |
| 适用场景 | 独立记录 | 连续跟踪 |
