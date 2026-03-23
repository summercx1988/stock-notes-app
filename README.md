# 股票投资语音笔记系统

当前实现以 `v3.1` 技术方案为准：面向 macOS 的股票语音笔记工具，核心流程是录音或上传音频、使用本地 `whisper.cpp` 转写、做轻量纠错和股票匹配、最后保存为 Markdown 笔记。

## 当前目标

- 让用户在看盘时快速记录口述想法
- 尽量使用本地语音转写，减少网络依赖
- AI 仅做辅助纠错和股票名称匹配，不做重分析
- 以股票为单位保存本地 Markdown 笔记，便于复盘

## 当前架构

- 前端：Electron 32 + React 18 + TypeScript + Ant Design
- 主进程：Electron IPC、笔记存储、股票数据库、轻量 AI 处理
- 语音服务：外部 Swift 服务 `../voice-transcriber-service`
- 语音转写：`whisper.cpp` + `ggml-medium.bin`
- 数据存储：`data/stocks/*.md` + `data/stocks-database.json`

## 目录说明

```text
stock-notes-app/
├── src/
│   ├── main/                 # Electron 主进程、IPC、服务适配
│   ├── renderer/             # React 界面
│   └── shared/               # 共享类型
├── data/
│   ├── stocks/               # 股票 Markdown 笔记
│   ├── audio/                # 临时/导入音频
│   └── stocks-database.json  # 股票数据库
└── docs/
    ├── TECHNICAL_SPEC.md
    ├── README.md
    └── RECORDING_TRANSCRIBE_SPEC.md
```

## 依赖说明

本仓库默认依赖同级目录下的 Swift 语音服务：

```text
../voice-transcriber-service
```

该服务不在当前 git 仓库内，但开发环境下会被 Electron 主进程按相对路径启动。

## 快速开始

### 1. 安装前端依赖

```bash
npm install
```

### 2. 准备 Swift 语音服务

```bash
cd ../voice-transcriber-service
swift build
```

确保以下文件可用：

- `../voice-transcriber-service/voice-transcriber-service` 或 `.build` 中的可执行产物
- `../voice-transcriber-service/whisper.cpp/main`
- `../voice-transcriber-service/whisper.cpp/models/ggml-medium.bin`

### 3. 可选配置云端纠错

如果希望启用纠错和股票名修正，可设置：

```bash
export MINIMAX_API_KEY=your-api-key
export OPENAI_BASE_URL=https://api.minimaxi.com/v1
export MINIMAX_MODEL=MiniMax-M2.7-highspeed
```

未配置时，应用仍可完成本地转写和本地股票匹配，只是不会调用云端纠错。

### 4. 启动开发环境

```bash
npm run electron:dev
```

## 当前录音流程

1. 打开录音弹窗。
2. 按需启动 Swift 语音服务。
3. 开始录音或上传音频文件。
4. 录音结束后，由 `whisper.cpp` 返回最终转写文本。
5. 主进程执行纠错和股票候选匹配。
6. 结果保存到对应股票的 Markdown 笔记。

## 主要文档

- 最新技术实现：[docs/TECHNICAL_SPEC.md](./docs/TECHNICAL_SPEC.md)
- 用户与开发说明：[docs/README.md](./docs/README.md)
- 录音转写专项说明：[docs/RECORDING_TRANSCRIBE_SPEC.md](./docs/RECORDING_TRANSCRIBE_SPEC.md)
- 外部 Swift 服务同步说明：[docs/VOICE_SERVICE_EXTERNAL_PATCH.md](./docs/VOICE_SERVICE_EXTERNAL_PATCH.md)

## 文档状态说明

`docs/PRD.md`、`docs/DATA_MODEL.md`、`docs/TEST_GUIDE.md` 中仍保留早期规划内容，当前实现请以 `docs/TECHNICAL_SPEC.md` 为准。
