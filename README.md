# 股票投资语音笔记系统

基于 Electron + React + TypeScript 的智能投资笔记管理工具，支持语音录入和AI文本处理。

## 功能特性

- 🎤 **语音录入**：实时录音，自动转文字
- 🤖 **AI处理**：本地/云端双模式，智能文本优化
- 📊 **时间轴视图**：按时间维度组织笔记
- 📝 **Markdown编辑**：结构化笔记，YAML元数据
- 💾 **本地存储**：数据安全，隐私保护

## 技术栈

- **前端**：React 18 + TypeScript + Ant Design + TailwindCSS
- **桌面**：Electron 32
- **AI**：
  - 本地：Ollama + Qwen2.5-7B + whisper.cpp
  - 云端：DeepSeek / OpenAI / 通义千问 API
- **存储**：SQLite + YAML + Markdown

## 项目结构

```
stock-notes-app/
├── src/
│   ├── main/           # Electron主进程
│   │   ├── main.ts     # 入口文件
│   │   ├── preload.ts  # 预加载脚本
│   │   ├── ipc/        # IPC通信
│   │   └── services/   # 后端服务
│   │       ├── ai/     # AI服务（本地/云端）
│   │       ├── notes.ts # 笔记服务
│   │       └── audio.ts # 音频服务
│   ├── renderer/       # React渲染进程
│   │   ├── components/ # UI组件
│   │   ├── layouts/    # 布局组件
│   │   └── stores/     # 状态管理
│   └── shared/         # 共享类型定义
├── data/               # 数据存储目录
│   ├── stocks/         # 股票笔记文件
│   ├── audio/          # 音频文件
│   └── index.db        # SQLite索引
└── resources/          # 资源文件
    ├── models/         # AI模型
    └── bin/            # 二进制工具
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 安装Ollama（本地AI模式）

```bash
# macOS
brew install ollama

# 启动Ollama服务
ollama serve

# 下载Qwen2.5模型
ollama pull qwen2.5:7b
```

### 3. 下载whisper.cpp

```bash
# 从GitHub下载预编译版本
# https://github.com/ggerganov/whisper.cpp/releases

# 下载模型
# https://huggingface.co/ggerganov/whisper.cpp
```

### 4. 启动开发服务器

```bash
npm run electron:dev
```

## 配置

### AI模式配置

在 `data/config/settings.yaml` 中配置：

```yaml
ai:
  mode: auto  # local / cloud / auto
  
  local:
    asrEngine: whisper-cpp
    llmEngine: ollama
    model: qwen2.5:7b
    
  cloud:
    defaultProvider: deepseek
    providers:
      deepseek:
        enabled: true
        model: deepseek-chat
```

### API Key配置

在应用设置中配置云端API Key，或设置环境变量：

```bash
export DEEPSEEK_API_KEY=your-api-key
export OPENAI_API_KEY=your-api-key
```

## 数据格式

### 笔记文件格式

```markdown
---
stock_code: "600519"
stock_name: "贵州茅台"
timestamp: "2024-01-15T09:30:45+08:00"
title: "开盘突破前高"
summary: "观察开盘突破情况"
keywords:
  - "突破"
  - "放量"
viewpoint:
  direction: "看多"
  confidence: 0.75
  timeHorizon: "短线"
---

# 开盘突破前高

今日开盘后，贵州茅台快速突破前期高点...
```

## 开发命令

```bash
# 开发模式
npm run dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 构建渲染进程
npm run build

# 构建Electron应用
npm run electron:build
```

## 许可证

MIT
