# 盯盘笔记系统 - 技术规格 v3.3

**版本：** v3.3  
**更新日期：** 2026-03-24  
**适用范围：** `stock-notes-app` 主仓库当前实现

---

## 一、目标与边界

### 1.1 当前目标

- 以“轻量且快速”的方式完成盯盘笔记录入
- 保障一只股票一个文件，方便长期沉淀与迁移
- 提供可视化 GUI 的导入导出能力，便于备份与迁移

### 1.2 当前边界

- AI 文本处理聚焦纠错与股票名称定位
- 不在保存环节落地 AI 思考链文本
- 复盘能力按分钟级 K 线与时间戳对齐实现

---

## 二、系统架构

### 2.1 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│                    Electron Desktop App                    │
├────────────────────────────────────────────────────────────┤
│ Renderer (React + AntD)                                   │
│  - 录音流程 UI                                              │
│  - 盯盘笔记编辑与时间轴                                      │
│  - 工具菜单（设置 / 自选股 / 导入导出）                      │
├────────────────────────────────────────────────────────────┤
│ Main Process (Node.js + IPC)                              │
│  - NotesService：Markdown 文件持久化                        │
│  - StockDB/Watchlist：股票检索与优先匹配                    │
│  - AI Service：纠错与股票名称提取                           │
│  - ReviewService：复盘统计                                  │
└────────────────────────────────────────────────────────────┘
               │
               ▼
┌────────────────────────────────────────────────────────────┐
│  Swift 子模块: voice-transcriber-service                  │
│  - AVAudioEngine 采集                                      │
│  - whisper.cpp 本地转写                                    │
└────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 18 + TypeScript + Ant Design | 交互界面 |
| 桌面容器 | Electron | 主进程 + 渲染进程 |
| 语音服务 | Swift + AVAudioEngine | 音频采集与转写桥接 |
| ASR | whisper.cpp | 本地语音转文本 |
| 文本处理 | MiniMax/OpenAI 兼容接口 + 本地规则 | 纠错、股票名定位 |
| 存储 | Markdown + YAML Front Matter | 本地文件数据库 |

---

## 三、核心数据模型

### 3.1 一股一文件

- 存储目录：`data/stocks/`
- 命名规范：`股票名称（股票代码）.md`
- 示例：`中远海能（600026）.md`

### 3.2 文件结构（逻辑）

```yaml
---
stock_code: "600026"
stock_name: "中远海能"
created_at: "2026-03-24T10:00:00+08:00"
updated_at: "2026-03-24T10:30:00+08:00"
total_entries: 18
---
```

正文按事件块存储，每条事件最少包含：

- `event_time`（业务时间，可指定）
- `created_at`（写入时间）
- `category`（看盘预测/交易札记/备忘/资讯备忘）
- `viewpoint.direction`（看多/看空/中性/未知）
- `content`（最终可读文本）

### 3.3 文件名兼容策略

`NotesService` 内部实现文件索引，支持解析以下历史命名：

- `600026.md`
- `600026-xxx.md`
- `中远海能（600026）.md`

读取时按代码索引定位；写回时迁移到新命名规范。

---

## 四、关键流程

### 4.1 录音到笔记

```text
录音/上传音频
  -> whisper.cpp 转写
  -> 文本归一化（简体中文、噪声清理）
  -> 股票候选匹配（优先自选股）
  -> 用户确认/编辑
  -> 写入对应股票 Markdown 文件
```

### 4.2 导入导出（GUI）

```text
Header 工具菜单
  -> DataTransferModal
  -> 选择目录(system:pickDirectory)
  -> notes:exportStock | notes:exportAll | notes:importFromDirectory
```

---

## 五、导入导出设计

### 5.1 导出接口

- `notes:exportStock(stockCode, outputDir)`
- `notes:exportAll(outputDir)`

导出目录结构：

```text
stock-notes-export-.../
├── manifest.json
├── stocks/
└── audio/
```

`manifest.json` 包含：

- `schema_version`
- `exported_at`
- `scope`
- `stock_codes`
- `file_naming`

### 5.2 导入接口

- `notes:importFromDirectory(sourceDir, mode)`
- `mode`：
  - `skip`：同代码跳过
  - `replace`：同代码覆盖

导入支持：

- 根目录包含 `stocks/` 的标准导出包
- 直接选择存放 `.md` 的目录

音频目录 `audio/{stockCode}` 同步拷贝到本地 `data/audio/{stockCode}`。

---

## 六、IPC 与 Preload 暴露

### 6.1 新增 IPC

- `system:pickDirectory`
- `notes:exportStock`
- `notes:exportAll`
- `notes:importFromDirectory`

### 6.2 Preload API

在 `window.api` 中新增：

- `api.system.pickDirectory(defaultPath?)`
- `api.notes.exportStock(stockCode, outputDir)`
- `api.notes.exportAll(outputDir)`
- `api.notes.importFromDirectory(sourceDir, mode)`

---

## 七、UI 结构更新

### 7.1 顶部栏

- 保留高频 `录音` 按钮
- 新增 `工具` 下拉菜单，聚合低频能力

### 7.2 工具菜单项

- 偏好设置
- 自选股设置
- 笔记导入导出（四种模式）

设置弹窗支持按 tab 打开（文本模型、ASR、笔记风格、自选股）。

---

## 八、模块化与复用

核心模块按职责解耦，可用于后续 CLI/Agent 复用：

- `NotesService`：文件数据库抽象（增删改查 + 导入导出）
- `StockDatabase/WatchlistService`：股票数据与兴趣集合
- `ReviewService`：独立复盘统计
- `voice-transcriber-service`：独立 ASR 服务（子模块）

---

## 九、验证与回归

建议最小验证命令：

```bash
npm run typecheck
npm run build
npm run cli:regression
```

重点回归场景：

- 股票文件命名迁移是否正确
- 导入模式（跳过/覆盖）行为是否符合预期
- 导出包结构是否完整（`manifest/stocks/audio`）
- 录音转写后保存文本是否为最终结果而非思考过程
