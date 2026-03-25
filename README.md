# 盯盘笔记系统（stock-notes-app）

面向 A 股场景的轻量桌面笔记工具，核心目标是“快速记录 + 时间轴沉淀 + 复盘纠错”。

当前实现基线：`v3.4`（2026-03-25）

## 核心能力

- 录音或上传音频后，本地 `whisper.cpp` 转写
- 文本纠错与股票名称匹配（优先结合自选股）
- 一只股票一个 Markdown 文件（文件即数据库）
- 事件按时间轴写入，支持观点、类别与操作打标（无/买入/卖出）
- 新增 `操盘打标` 类别，用于复盘阶段的行为归因
- 类别 Schema 仅内置 `看盘预测`、`操盘打标`（只读锁定）
- 其他类别通过 JSON 草稿灵活配置，可按类别独立控制观点/操作/周期字段
- 复盘模块只解析 `reviewEligible=true` 的类别（默认仅 `看盘预测`）
- 提供 GUI 笔记导入/导出（单股/全部，跳过或覆盖重复）

## 文件命名规则（已统一）

股票笔记文件统一为：

```text
股票名称（6位代码）.md
```

示例：

```text
中远海能（600026）.md
```

## 架构概览

- 前端：Electron + React + TypeScript + Ant Design
- 主进程：IPC、笔记存储、股票数据库、文本处理
- 语音服务：Git 子模块 `voice-transcriber-service`（Swift）
- 存储：`data/stocks/*.md`、`data/audio/*`、`data/stocks-database.json`

## 目录说明

```text
stock-notes-app/
├── src/
│   ├── main/                  # Electron 主进程、IPC、服务
│   ├── renderer/              # React UI
│   └── shared/                # 共享类型
├── data/
│   ├── stocks/                # 股票 Markdown 笔记（名称+代码）
│   ├── audio/                 # 录音与导入音频
│   └── stocks-database.json   # 股票名称与代码数据库
├── voice-transcriber-service/ # Swift 子模块
└── docs/
    ├── README.md
    ├── PRD.md
    ├── TECHNICAL_SPEC.md
    └── MODULAR_ARCHITECTURE.md
```

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 初始化语音子模块

```bash
git submodule update --init --recursive
cd voice-transcriber-service
./scripts/setup-whisper.sh
swift build
cp .build/debug/voice-transcriber-service ./voice-transcriber-service
```

3. 启动应用

```bash
npm run electron:dev
```

## GUI 入口说明

- 常用入口：顶部按钮 `录音`
- 进阶入口：顶部 `工具` 下拉菜单
- `工具` 菜单包含：
  - 偏好设置
  - 自选股设置
  - 笔记导入导出（导出当前、导出全部、导入跳过、导入覆盖）

## 文档索引

- 使用与开发说明：[docs/README.md](./docs/README.md)
- 产品需求文档：[docs/PRD.md](./docs/PRD.md)
- 技术规格说明：[docs/TECHNICAL_SPEC.md](./docs/TECHNICAL_SPEC.md)
- 模块化架构说明：[docs/MODULAR_ARCHITECTURE.md](./docs/MODULAR_ARCHITECTURE.md)
- 录音转写专项说明：[docs/RECORDING_TRANSCRIBE_SPEC.md](./docs/RECORDING_TRANSCRIBE_SPEC.md)
