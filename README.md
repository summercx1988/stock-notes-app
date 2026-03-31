# 盯盘笔记系统（stock-notes-app）

面向 A 股场景的轻量桌面笔记工具，核心目标是“快速记录 + 时间轴沉淀 + 复盘纠错”。

当前实现基线：`v3.6`（2026-03-31）

## 核心能力

- 录音或上传音频后，本地 `whisper.cpp` 转写
- 本地录音与飞书远程录入都已接入“极速解析”链路
- 股票识别优先使用本地规则、自选股与股票库，必要时才触发 1 次 LLM
- 一只股票一个 Markdown 文件（文件即数据库）
- 事件按时间轴写入，支持观点、类别与操作打标（无/买入/卖出）
- 类别简化为 `看盘预测` + `普通笔记`
- 操盘行为通过“操作打标（买入/卖出）”记录，不再单独使用操盘类别
- 复盘模块只解析 `reviewEligible=true` 的类别（默认仅 `看盘预测`）
- 飞书远程录入支持 JSON 2.0 卡片确认、编辑与候选股票确认
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
- 主进程：IPC、笔记存储、股票数据库、飞书机器人、复盘分析
- 解析层：`ParseOrchestrator`（完整链路）+ `FeishuFastParseOrchestrator`（极速链路）
- 语音服务：Git 子模块 `voice-transcriber-service`（Swift）
- 存储：`~/Library/Application Support/stock-notes-app/data/`

## 数据存储

应用数据统一存储在用户目录，与项目代码分离：

```text
~/Library/Application Support/stock-notes-app/data/
├── stocks/                # 股票 Markdown 笔记
├── audio/                 # 录音与导入音频
├── config/                # 配置文件
├── market/                # 市场数据缓存
└── stocks-database.json   # 股票名称与代码数据库
```

**优点：**
- 开发与部署使用同一数据源
- 重装应用不会丢失数据
- 项目代码不包含用户数据，安全上传 Git

**访问方式：**
- 访达中按 `Cmd+Shift+G`，输入 `~/Library/Application Support/stock-notes-app`
- 或终端执行 `open ~/Library/Application\ Support/stock-notes-app/`

## 目录说明

```text
stock-notes-app/
├── src/
│   ├── main/                  # Electron 主进程、IPC、服务
│   ├── renderer/              # React UI
│   └── shared/                # 共享类型
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
- 飞书卡片交互经验：[docs/FEISHU_CARD_INTERACTION_LESSONS.md](./docs/FEISHU_CARD_INTERACTION_LESSONS.md)
- 飞书机器人配置教程：[docs/飞书机器人配置教程.md](./docs/飞书机器人配置教程.md)

## 打包发布

### 开发环境打包

```bash
# 1. 编译语音服务（Release 版本）
cd voice-transcriber-service
swift build -c release
cp .build/release/voice-transcriber-service ./voice-transcriber-service
cd ..

# 2. 打包应用（生成 DMG 和 ZIP）
npm run electron:build
```

### 输出文件

打包完成后，在 `release/` 目录下生成：

| 文件 | 说明 |
|------|------|
| `股票投资笔记-x.x.x-arm64.dmg` | Apple Silicon (M1/M2/M3) 安装包 |
| `股票投资笔记-x.x.x.dmg` | Intel Mac 安装包 |
| `股票投资笔记-x.x.x-arm64-mac.zip` | Apple Silicon 压缩包 |
| `股票投资笔记-x.x.x-mac.zip` | Intel Mac 压缩包 |

### 安装使用

1. 双击 DMG 文件打开
2. 将应用拖到 Applications 文件夹
3. 首次打开时，如提示"无法验证开发者"：
   - 右键点击应用 → 选择"打开" → 点击"打开"确认
   - 或在系统设置 → 隐私与安全性 → 仍要打开

### 注意事项

- 打包前确保语音服务已编译（`voice-transcriber-service/voice-transcriber-service`）
- 用户数据存储在 `~/Library/Application Support/stock-notes-app/data/`，不会被打包
- 首次运行会自动创建数据目录
