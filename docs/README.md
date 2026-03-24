# 股票投资语音笔记系统 - 使用与开发说明 v3.1

**版本：** v3.1
**更新日期：** 2026-03-23
**适用范围：** 当前主仓库 `stock-notes-app`

---

## 一、当前实现概览

当前版本聚焦于一条稳定、简单的链路：

```text
录音 / 上传音频
  -> 本地 whisper.cpp 转写
  -> 文本纠错 + 股票名称匹配
  -> 保存到股票 Markdown 笔记
```

说明：

- 录音能力由仓库内子模块 `voice-transcriber-service` 提供
- 转写优先使用本地 `whisper.cpp`
- AI 不再做观点提炼和长文本分析
- 云端能力主要用于纠错和股票名修正

---

## 二、环境要求

- macOS 13+
- Node.js 18+ 与 npm
- Swift 5.9+
- 已编译好的 `whisper.cpp`
- `ggml-medium.bin` 模型文件

---

## 三、开发环境启动

### 3.1 前端与 Electron

```bash
cd stock-notes-app
npm install
npm run electron:dev
```

### 3.1.1 复盘 CLI（Agent/脚本可调用）

```bash
npm run cli:review -- --mode evaluate --scope overall --start 2026-03-01T00:00:00+08:00 --end 2026-03-24T23:59:59+08:00 --interval 5m
```

### 3.2 Swift 语音服务

```bash
git submodule update --init --recursive
cd voice-transcriber-service
./scripts/setup-whisper.sh
swift build
cp .build/debug/voice-transcriber-service ./voice-transcriber-service
```

默认开发环境会从以下相对路径启动语音服务：

```text
voice-transcriber-service/voice-transcriber-service
```

### 3.3 Whisper 模型

确认以下文件存在：

```text
voice-transcriber-service/whisper.cpp/main
voice-transcriber-service/whisper.cpp/models/ggml-medium.bin
```

---

## 四、使用流程

### 4.1 录音录入

1. 点击主界面右上角的 `录音` 按钮。
2. 弹窗打开后，应用按需检查并启动语音服务。
3. 点击 `开始录音`。
4. 说完后点击 `停止录音`。
5. 应用等待最终转写结果返回。
6. 进行纠错和股票匹配。
7. 点击 `保存笔记`，写入对应股票的 Markdown 文件。

### 4.2 上传音频

支持以下格式：

- WAV
- MP3
- M4A
- AAC

上传后会直接触发整文件转写，再进入纠错和股票匹配。

---

## 五、当前 UI 状态

录音弹窗当前分为四步：

1. 录音
2. 转写
3. 处理
4. 保存

其中“处理”表示：

- 纠错错别字和同音字
- 根据候选股票列表修正常见股票名称
- 给出最可能的股票匹配结果

---

## 六、数据落盘位置

```text
data/
├── stocks/
│   ├── 600519.md
│   ├── 000544.md
│   └── ...
└── audio/
    └── temp/
```

笔记以 Markdown 文件保存，音频临时文件保存在 `data/audio/temp/`。

---

## 七、常见问题

### Q1：点开录音弹窗后无法开始录音

优先检查：

- Swift 语音服务是否已编译
- 麦克风权限是否已授予
- 端口 `8765` 是否被其他进程占用

### Q2：录音能保存，但一直没有转写结果

优先检查：

- `whisper.cpp/main` 是否可执行
- 模型 `ggml-medium.bin` 是否存在
- 音频文件是否实际包含语音

### Q3：股票名称识别不准

当前策略是：

- 先做本地候选匹配
- 再把候选列表交给纠错环节辅助修正

专有名词仍可能识别错误，后续可继续优化股票匹配策略。

---

## 八、文档地图

当前实现基线：

- `docs/TECHNICAL_SPEC.md`
- `docs/README.md`
- `docs/RECORDING_TRANSCRIBE_SPEC.md`
- `docs/MODULAR_ARCHITECTURE.md`（模块化解耦现状与演进路线）

下一阶段规划：

- `docs/PRD.md`（面向对象笔记系统 v2.0 需求）
- `docs/UI_UX_TECH_PLAN.md`（UI/UX 与技术实施方案）

历史资料（参考）：

- `docs/DATA_MODEL.md`
- `docs/TEST_GUIDE.md`
