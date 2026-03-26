# 盯盘笔记系统 - 技术规格 v3.5

**版本：** v3.5  
**更新日期：** 2026-03-26  
**适用范围：** `stock-notes-app` 主仓库当前实现

---

## 一、目标与边界

### 1.1 当前目标

- 以“轻量且快速”的方式完成盯盘笔记录入
- 保障一只股票一个文件，方便长期沉淀与迁移
- 提供可视化 GUI 的导入导出能力，便于备份与迁移
- 让飞书远程录入与本地录音都具备可接受的响应速度

### 1.2 当前边界

- AI 文本处理聚焦股票识别、观点打标、操作打标与卡片预填
- 不在保存环节落地 AI 思考链文本
- 复盘能力按分钟级 K 线与时间戳对齐实现
- AI 助理类扩展暂未接入主链路，避免影响核心录入与落库

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
│  - 复盘分析与 K 线联动                                       │
│  - 工具菜单（设置 / 自选股 / 导入导出）                      │
├────────────────────────────────────────────────────────────┤
│ Main Process (Node.js + IPC)                              │
│  - NotesService：Markdown 文件持久化                        │
│  - StockDB/Watchlist：股票检索与优先匹配                    │
│  - ParseOrchestrator：完整解析链路                          │
│  - FeishuFastParseOrchestrator：极速解析链路                │
│  - FeishuBot：飞书消息、卡片回调、JSON 2.0 表单交互          │
│  - ReviewService：复盘统计                                  │
│  - VoiceTranscriberClient：Swift 服务拉起与 WS 状态管理      │
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
| 文本处理 | MiniMax/OpenAI 兼容接口 + 本地规则 | 完整解析与极速解析 |
| 卡片交互 | 飞书卡片 JSON 2.0 | 确认、编辑、候选股票确认 |
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

- `event_time`：业务时间，可指定
- `created_at`：写入时间
- `category`：看盘预测 / 普通笔记
- `viewpoint.direction`：看多 / 看空 / 中性 / 未知
- `operation_tag`：无 / 买入 / 卖出
- `content`：最终可读文本

### 3.3 文件名兼容策略

`NotesService` 内部实现文件索引，支持解析以下历史命名：

- `600026.md`
- `600026-xxx.md`
- `中远海能（600026）.md`

读取时按代码索引定位；写回时迁移到新命名规范。

---

## 四、关键流程

### 4.1 本地录音到笔记

```text
录音/上传音频
  -> whisper.cpp 转写
  -> 极速解析（规则优先，必要时 1 次 LLM）
  -> 用户确认/编辑
  -> 写入对应股票 Markdown 文件
```

当前本地链路实现说明：

- 优先调用 `ai:extractFast`
- 仍保留一次本地 `stock.match(...)` 兜底，避免空结果直接落到手工填写
- `VoiceTranscriberClient` 在开始录音前会先确认 WS 已连接，停止录音改为幂等

### 4.2 飞书远程录入到笔记

```text
飞书消息
  -> FeishuBot 接收 im.message.receive_v1
  -> 极速解析（规则优先，必要时 1 次 LLM）
  -> 发送 JSON 2.0 确认卡 / 候选股票卡 / 编辑表单卡
  -> 接收 card.action.trigger
  -> schema 校验 + 幂等校验
  -> 写入对应股票 Markdown 文件
```

飞书链路关键点：

- 编辑卡片已统一为 JSON 2.0 `form`
- 表单项均带唯一 `name`
- 卡片回调统一使用 `behaviors.callback.value`
- 低置信股票优先走候选股票卡，而不是强制猜测
- 普通笔记与看盘预测共享同一保存按钮，通过“笔记类型”下拉传递类别

### 4.3 解析架构

#### 完整解析链路

适用场景：

- 复杂文本
- 后续更强调结构化抽取与解释性的入口

实现模块：

- `ParseOrchestrator`

处理步骤：

- `Normalize`
- `Extract`
- `Verify`
- `CardDraft`
- `Finalize`

LLM 预算：

- 最多 2 次

#### 极速解析链路

适用场景：

- 飞书远程录入
- 本地录音后的速记保存

实现模块：

- `FeishuFastParseOrchestrator`

处理策略：

- 本地规则优先
- 有明确股票：0 次 LLM
- 有候选但歧义：0 次 LLM，直接候选确认
- 完全无候选：1 次轻量 LLM 兜底
- 不做正文改写，不做关键点提炼，不做二次补全

### 4.4 导入导出（GUI）

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

### 6.1 IPC

- `system:pickDirectory`
- `notes:exportStock`
- `notes:exportAll`
- `notes:importFromDirectory`
- `ai:extractFast`

### 6.2 Preload API

在 `window.api` 中暴露：

- `api.system.pickDirectory(defaultPath?)`
- `api.notes.exportStock(stockCode, outputDir)`
- `api.notes.exportAll(outputDir)`
- `api.notes.importFromDirectory(sourceDir, mode)`
- `api.ai.extractFast(text)`

---

## 七、UI 结构更新

### 7.1 顶部栏

- 保留高频 `录音` 按钮
- 新增 `工具` 下拉菜单，聚合低频能力

### 7.2 工具菜单项

- 偏好设置
- 自选股设置
- 笔记导入导出

### 7.3 飞书卡片交互

- 确认卡片
- 候选股票卡片
- 编辑表单卡片
- 成功 / 失败反馈卡片

当前主链路卡片已统一迁移到 JSON 2.0。

---

## 八、模块化与复用

核心模块按职责解耦，可用于后续 CLI / Agent 复用：

- `NotesService`：文件数据库抽象（增删改查 + 导入导出）
- `StockDatabase/WatchlistService`：股票数据与兴趣集合
- `ParseOrchestrator`：完整解析能力
- `FeishuFastParseOrchestrator`：极速解析能力
- `FeishuBot`：飞书接入与卡片交互
- `ReviewService`：独立复盘统计
- `voice-transcriber-service`：独立 ASR 服务（子模块）
- `VoiceTranscriberClient`：主进程与 Swift 服务之间的 WS 桥接

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
- 飞书 JSON 2.0 编辑卡片是否能正常保存
- 同一飞书消息/卡片动作是否被幂等拦截
- 本地录音开始/停止时语音服务断连是否还能优雅降级
