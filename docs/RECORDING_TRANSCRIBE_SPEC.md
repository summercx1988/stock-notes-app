# 股票投资语音笔记系统 - 录音转写功能规格

**版本：** v2.0
**更新日期：** 2025-03-19

---

## 一、功能概述

录音转写是股票投资笔记系统的核心功能，用户通过语音快速记录投资想法，系统自动完成转写、实体识别、观点提炼，最终生成结构化笔记。

### 1.1 核心流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        录音转写完整流程 v2.0                      │
└─────────────────────────────────────────────────────────────────┘

用户操作                    系统处理                      AI 处理
────────────────────────────────────────────────────────────────────
1. 点击"录音"     →      请求麦克风权限（首次确认）
2. 说话           →      实时录音
3. 点击"停止"    →      保存音频文件
                          ↓
                   ┌──────────────────────────────┐
                   │     Whisper 本地模型转写      │
                   │     (语音 → 文字)            │
                   │     模型: ggml-small.bin     │
                   └──────────────────────────────┘
                          ↓
                   ┌──────────────────────────────┐
                   │     智谱 GLM-4-Flash 分析     │
                   │     - 识别股票名称/代码       │
                   │     - 提取投资观点            │
                   │     - 提取时间戳              │
                   │     - 优化文本                │
                   └──────────────────────────────┘
                          ↓
4. 展示结果       ←    AI 提炼结果
   - 转写文本
   - 识别股票
   - 提取观点
   - 提取时间
                          ↓
5. 用户确认/修改   →    追加到股票 MD 文件
```

---

## 二、技术方案

### 2.1 语音转文字

| 项目 | 方案 |
|------|------|
| **模型** | Whisper Small (ggml-small.bin) |
| **大小** | 465 MB |
| **运行方式** | 本地 CPU/GPU (whisper.cpp) |
| **支持语言** | 中文 |
| **实时性** | 录音结束后转写 |

### 2.2 AI 分析

| 项目 | 方案 |
|------|------|
| **服务** | 智谱 GLM-4-Flash |
| **API** | https://open.bigmodel.cn/api/paas/v4 |
| **功能** | 股票识别、观点提取、时间戳提取、文本优化 |

### 2.3 股票数据库

| 项目 | 方案 |
|------|------|
| **数据源** | AKShare |
| **数据量** | 5490 只 A 股 |
| **存储** | 本地 JSON 文件 |
| **更新** | 手动触发 |

---

## 三、输入方式

### 3.1 语音录入（核心亮点）

```
┌────────────────────────────────────────────────────────────┐
│  📝 新增投资笔记                                           │
├────────────────────────────────────────────────────────────┤
│  [🎤 语音录入]  [✏️ 手动输入]                              │
│────────────────────────────────────────────────────────────│
│                                                            │
│                    ⏱️ 00:45                                │
│                                                            │
│         🔴 录音中...                                      │
│                                                            │
│              [ 停止录音 ]                                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.2 手动输入（备选）

```
┌────────────────────────────────────────────────────────────┐
│  📝 新增投资笔记                                           │
├────────────────────────────────────────────────────────────┤
│  [🎤 语音录入]  [✏️ 手动输入]                              │
│────────────────────────────────────────────────────────────│
│                                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 今天看好贵州茅台，认为白酒板块有反弹机会...          │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│              [ AI 分析 ]                                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 四、AI 提取内容

### 4.1 数据结构

```typescript
interface AIExtractResult {
  // 股票信息
  stock?: {
    code: string       // 股票代码，如 "600519"
    name: string       // 股票名称，如 "贵州茅台"
    confidence: number // 置信度 0-1
  }

  // 投资观点
  viewpoint: {
    direction: '看多' | '看空' | '中性'
    confidence: number
    timeHorizon: '短线' | '中线' | '长线'
    reasoning?: string
    keyFactors?: string[]
  }

  // 时间戳（新增）
  timestamp: {
    type: 'absolute' | 'relative' | 'none'
    value?: Date
    originalText?: string  // 如 "昨天"、"3月15日"
  }

  // 文本
  optimizedText: string
  originalText: string
}
```

### 4.2 时间戳处理

| 用户输入 | 识别结果 | 时间值 |
|----------|----------|--------|
| "今天看好..." | relative | 当前日期 |
| "昨天观察到..." | relative | 当前日期 - 1 |
| "上周三分析..." | relative | 当前日期 - 7 |
| "3月15日买入..." | absolute | 2025-03-15 |
| 无时间词 | none | 当前日期 |

---

## 五、笔记存储

### 5.1 文件结构

```
data/
├── stocks/
│   ├── 600519.md          # 贵州茅台笔记
│   ├── 000858.md          # 五粮液笔记
│   └── ...
├── audio/
│   ├── 600519/
│   │   ├── 20250319-0930.webm
│   │   └── 20250319-1430.webm
│   └── ...
└── stocks-database.json   # 股票数据库
```

### 5.2 Markdown 格式

```markdown
---
stock_code: "600519"
stock_name: "贵州茅台"
created_at: "2025-03-19T09:30:00+08:00"
updated_at: "2025-03-19T14:30:00+08:00"
total_entries: 5
---

# 贵州茅台投资笔记

## 📅 2025-03-19

### 🕐 09:30 盘前观察

> **观点**: 看多 (信心: 0.8) | **周期**: 中线
>
> **理由**: 午后继续走强，成交量持续放大
>
> **因素**: ["量价配合良好", "北向资金流入"]

今日观察贵州茅台，午后继续走强，成交量持续放大，建议持仓待涨。

*💾 自动生成 | 🎤 45秒*

---

### 🕐 14:30 盘后总结

> **观点**: 中性 (信心: 0.6) | **周期**: 短线

尾盘有所回落，但整体趋势仍保持向上。

*💾 自动生成 | 🎤 30秒*
```

---

## 六、安装配置

### 6.1 系统要求

- Node.js 18+
- ffmpeg（音频格式转换）
- macOS / Windows / Linux

### 6.2 安装步骤

```bash
# 1. 安装依赖
npm install

# 2. 安装 ffmpeg（macOS）
brew install ffmpeg

# 3. 下载 Whisper 模型（国内镜像）
curl -L -o node_modules/whisper-node/lib/whisper.cpp/models/ggml-small.bin \
  "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

# 4. 更新股票数据库
npm run update-stocks

# 5. 启动应用
GLM_API_KEY=your_api_key npm run electron:dev
```

### 6.3 环境变量

| 变量 | 说明 |
|------|------|
| `GLM_API_KEY` | 智谱 API Key（必需） |

---

## 七、API 接口

### 7.1 Whisper API

```typescript
// 检查模型是否可用
window.api.whisper.isAvailable(): Promise<boolean>

// 转写音频文件
window.api.whisper.transcribe(audioPath: string): Promise<TranscribeResult>

// 转写音频 Buffer
window.api.whisper.transcribeBuffer(buffer: ArrayBuffer): Promise<TranscribeResult>
```

### 7.2 AI API

```typescript
// 提取股票和观点
window.api.ai.extract(text: string): Promise<AIExtractResult>

// 优化文本
window.api.ai.optimizeText(text: string): Promise<string>
```

### 7.3 笔记 API

```typescript
// 添加笔记条目
window.api.notes.addEntry(stockCode: string, data: {
  content: string
  viewpoint?: Viewpoint
  timestamp?: string
  audioFile?: string
  audioDuration?: number
}): Promise<void>

// 获取股票笔记
window.api.notes.getStockNote(stockCode: string): Promise<StockNote>
```

---

## 八、后续扩展

### 8.1 v2.1 计划

- [ ] 实时转写显示（边说边显示）
- [ ] 批量导入音频
- [ ] 多语言支持

### 8.2 v2.2 计划

- [ ] 语音命令控制
- [ ] 自动股票代码朗读
- [ ] 语音提醒功能
