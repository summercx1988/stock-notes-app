# 工程技术总览（整合版）

更新时间：2026-04-05  
适用分支：`main`

## 1. 目标与边界

- 目标：稳定、快速地完成“记录 -> 管理 -> 复盘”的日常闭环。
- 优先级：录入可靠落盘优先于复杂 AI 交互。
- 边界：当前以 A 股本地桌面场景为核心，采用单机数据存储，不引入中心化服务依赖。

## 2. 系统架构

```text
renderer (React + AntD)
  -> preload (API bridge)
    -> ipc (transport)
      -> application (usecase orchestration)
        -> core (pure logic)
        -> services/adapters (IO)
```

关键实现位置：

- UI：`src/renderer`
- 业务编排：`src/main/application/notes-app-service.ts`
- 主进程服务：`src/main/services`
- 纯逻辑：`src/main/core`
- 共享类型：`src/shared/types.ts`

## 3. 数据模型与存储

### 3.1 主存储（Markdown）

- 一只股票一个 Markdown 文件（文件即数据库）。
- 文件命名：`股票名称（股票代码）.md`。
- 主数据路径：`~/Library/Application Support/stock-notes-app/data/stocks/`。
- 核心业务时间：`eventTime`（排序与复盘口径基准）。

### 3.2 Sidecar 索引（新增）

- 复盘查询引入轻量索引文件：`data/runtime/notes-index.json`。
- 索引项主键口径：`stockCode + entryId`（逻辑唯一）。
- 索引字段：`eventTime / category / operationTag / trackingStatus / viewpointDirection / stockName` 等。
- 目标：保留 Markdown 作为唯一主存储，同时避免复盘时每次全量解析正文。

索引维护策略：

- 新增/编辑/删除/导入笔记时标记对应股票索引为脏并增量刷新。
- 启动时先加载已持久化索引，再按需补齐缺失股票。

### 3.3 核心目录

```text
data/
├── stocks/                # 股票笔记（含 __DAILY_REVIEW__ 系统笔记）
├── audio/                 # 录音文件
├── logs/                  # 离线日志
├── config/                # 设置
├── market/                # 行情缓存
└── runtime/               # 运行时状态与索引（notes-index/review-generation-state）
```

## 4. 录音与转写链路

```text
录音/上传
  -> Swift 语音服务
  -> whisper.cpp 转写
  -> 主进程轻量处理（纠错/匹配）
  -> 用户确认
  -> NotesService 落盘
```

关键原则：

- `voice:transcribeFile` 返回“最终结果”而非仅发起命令。
- 录音与上传统一输出可保存文本。
- 转写异常与状态走统一事件回传。

## 5. 飞书远程录入链路

```text
飞书消息
  -> FeishuBot 接收
  -> 规则优先解析（必要时 1 次 LLM 兜底）
  -> JSON 2.0 卡片确认/编辑
  -> card.action.trigger 回调
  -> 主进程校验并落盘
```

关键要点：

- 编辑卡片使用 JSON 2.0 `form`，表单项 `name` 必须唯一。
- 回调参数统一走 `behaviors.callback.value`。
- 排障优先确认旧 Electron 进程是否占用长连接。

## 6. 观点追踪模块（当前架构）

### 6.1 双场景 UI（互不影响）

- 单股观点追踪（`single`）：
  - K 线工作台 + 事件明细 + 操作归因明细。
  - 适合单票择时与事件回放。
- 全市场观点追踪（`overall`）：
  - 质量总览 + 每日质量趋势图 + 每日明细表。
  - 支持买点/卖点维度、当日执行明细展开、名称(代码)展示。

### 6.2 观点追踪计算链路

```text
review:evaluate
  -> NotesAppService.getReviewEvaluation
    -> NotesService.getReviewIndexedEntries (优先走 sidecar 索引)
    -> 统一产出 events + actionEvents
    -> MarketDataService.getCandles
    -> review-evaluator（预处理K线 + 二分定位）
    -> review-daily-quality（按日聚合）
    -> 返回 summary/actionSummary/dailyQuality/perfStats
```

### 6.3 对齐与口径

- 事件对齐仍采用“第一根 `candle.timestamp >= eventTime`”规则。
- 图表口径与统计口径保持一致，避免“图表和统计不同步”。
- 全市场观点追踪默认时间范围：近两周（`T-13 ~ T`）。
- 日维统计仅保留有预测样本日期（`predictionSamples > 0`）。

### 6.4 性能策略（已落地）

- 查询层：索引优先，减少全量 Markdown 解析。
- 采集层：单次扫描同时产出预测/操作事件。
- 计算层：每只股票 K 线预处理一次，事件定位改为二分查找。
- 展示层：全市场观点追踪提供“本次计算性能”卡片（总耗时、索引命中量、参与股票数等）。

## 7. 每日复盘模块

- 聚焦“每日总结 / 盘前复习”。
- 数据源为普通笔记候选，按窗口裁剪。
- 生成策略：先本地可读草稿，再做 AI 增强；AI 失败时保留本地结果。
- 支持 09:00 提醒、未读管理、归档与删除。

## 8. 可观测性与日志

- 主进程日志落盘：`data/logs/app.log`。
- 关键链路日志覆盖：IPC、AI 调用、笔记读写、复盘评估、每日复盘。
- 日志包含敏感字段脱敏与轮转策略，支持离线排障。

## 9. 构建与发布

常用命令：

```bash
npm run electron:dev
npm run build
npm run electron:build
npm run cli:review
npm run cli:regression
```

语音子模块准备：

```bash
git submodule update --init --recursive
cd voice-transcriber-service
./scripts/setup-whisper.sh
swift build
```

## 10. 维护约定

- 功能变更统一记录到 `docs/CHANGELOG.md`。
- 本文档是“当前实现”的技术主入口，避免再次分裂为并行规格。
- 历史方案与评审稿统一归档至 `docs/archive/`，不作为当前实现依据。
