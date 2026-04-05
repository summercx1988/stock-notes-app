# 工程技术总览（整合版）

更新时间：2026-04-05  
适用分支：`main`

## 1. 目标与边界

- 目标：稳定、快速地完成“记录 -> 管理 -> 复盘”的日常闭环。
- 优先级：录入速度和可靠落盘优先于复杂 AI 花活。
- 边界：当前以 A 股笔记为核心场景，聚焦桌面单机数据管理。

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
- 主进程服务：`src/main/services`
- 业务编排：`src/main/application/notes-app-service.ts`
- 共享类型：`src/shared/types.ts`

## 3. 数据模型与存储

### 3.1 存储设计

- 一只股票一个 Markdown 文件（文件即数据库）。
- 文件命名：`股票名称（股票代码）.md`。
- 应用数据路径：`~/Library/Application Support/stock-notes-app/data/`。

### 3.2 核心目录

```text
data/
├── stocks/                # 股票笔记（含 __DAILY_REVIEW__ 系统笔记）
├── audio/                 # 录音文件
├── logs/                  # 离线日志
├── config/                # 设置
└── market/                # 行情缓存
```

### 3.3 关键数据约束

- `eventTime` 作为业务时间轴排序基准。
- `createdAt` 作为写入时间保留。
- 类别以当前实现为准：普通笔记、看盘预测、每日总结、盘前复习等。
- 历史命名文件可读，写回时会迁移到新命名格式。

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

- `voice:transcribeFile` 返回“最终结果”而不是仅发起命令。
- 录音与上传都以“可保存的最终文本”为统一输出。
- 转写异常和服务状态走统一事件回传。

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

- 编辑卡片使用 JSON 2.0 `form`，表单项 `name` 必须唯一且非空。
- 回调参数统一走 `behaviors.callback.value`。
- 排障优先确认是否存在旧 Electron 进程占用长连接。

## 6. 复盘分析与 K 线

### 6.1 复盘模块

- 包含复盘分析页（统计 + 图表）与每日复盘页（日志 + 详情）。
- 每日复盘聚焦“每日总结/盘前复习”，日志管理支持删除与归档。

### 6.2 K 线对齐原则

- 事件对齐采用“第一根 `candle.timestamp >= eventTime`”的规则。
- 图表展示与评估逻辑保持同一对齐口径，减少“图表和统计不一致”。

### 6.3 缓存策略

- 行情缓存：`data/market/{code}_{interval}.json`。
- API 异常时优先回退本地缓存，保证页面可用性。

## 7. 每日复盘实现要点

- 数据来源：普通笔记候选（按最近窗口和上限裁剪）。
- 默认分析窗口：近 3 天（T-3）。
- 生成策略：先本地可读草稿，再尝试 AI 增强；AI 失败时保留本地结果。
- 提醒策略：支持 09:00 提醒、未读管理、归档管理。

## 8. 可观测性与日志

- 主进程支持离线文件日志落盘。
- 关键链路日志覆盖：IPC、AI 调用、笔记读写、每日复盘生成。
- 日志包含基础脱敏与轮转策略，便于本地排障。

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
- 设计长期版本以本文件为技术主入口，避免继续分裂成多份并行规格。
- 历史方案/评审稿统一归档到 `docs/archive/`，不再作为当前实现依据。
