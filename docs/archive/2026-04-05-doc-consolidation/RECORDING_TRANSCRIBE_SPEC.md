# 股票投资语音笔记系统 - 录音转写功能规格 v3.2

**版本：** v3.2
**更新日期：** 2026-03-24

---

## 一、目标

录音转写链路的目标是稳定地完成以下事情：

1. 获取语音输入
2. 产出可用的中文转写文本
3. 做轻量纠错和股票名称匹配
4. 在保存前进入可编辑笔记态并确认后入库

当前版本不再承担复杂观点提炼、摘要生成或结构化分析。

---

## 二、当前链路

### 2.1 录音模式

```text
用户点击“开始录音”
  -> Electron 主进程检查 / 启动 Swift 语音服务
  -> Swift 服务启动 AVAudioEngine
  -> 用户点击“停止录音”
  -> Swift 服务保存完整音频文件
  -> Swift 服务调用 whisper.cpp 做最终转写
  -> 主进程接收最终 transcript
  -> 主进程执行纠错和股票匹配
  -> 前端展示结果
  -> 保存 Markdown 笔记
```

### 2.2 上传音频模式

```text
用户上传音频文件
  -> 前端调用 voice:transcribeFile
  -> Swift 服务调用 whisper.cpp 转写完整文件
  -> 主进程返回最终 transcript
  -> 主进程执行纠错和股票匹配
  -> 前端展示结果
  -> 保存 Markdown 笔记
```

---

## 三、组件职责

### 3.1 Renderer

- 打开录音弹窗
- 控制录音状态和步骤条
- 接收 `transcript`、`audio_saved`、`error` 事件
- 触发保存笔记

### 3.2 Electron Main

- 管理 IPC
- 管理 `VoiceTranscriberClient`
- 转发转写结果到前端
- 执行纠错和股票名称匹配
- 保存笔记文件

### 3.3 Swift 语音服务

- 录制音频
- 保存 WAV 音频
- 调用 `whisper.cpp`
- 通过 WebSocket 返回 `transcript`、`audio_saved`、`error`

---

## 四、协议约定

### 4.1 从主进程到 Swift 服务

```json
{ "type": "start" }
{ "type": "stop" }
{ "type": "ping" }
{ "type": "transcribe_file", "audioPath": "/abs/path/to/file.wav" }
```

### 4.2 从 Swift 服务到主进程

```json
{ "type": "transcript", "text": "中原海能今天尾盘拉升", "isFinal": true }
{ "type": "audio_saved", "audioPath": "/abs/path/to/file.wav" }
{ "type": "error", "errorMessage": "Transcription failed" }
{ "type": "status", "status": { "isRecording": false, "duration": 8.2, "memoryUsage": 123456 } }
```

---

## 五、当前行为约束

### 5.1 语音服务启动

- 应用启动时不再强制自动连接语音服务
- 录音弹窗打开或开始录音时按需启动

### 5.2 `voice:transcribeFile` 语义

当前实现必须满足：

- 不是“只发命令立即返回”
- 而是等待最终 `transcript` 或 `error`
- 返回结构为 `success/text/error`

### 5.3 前端处理逻辑

前端不能依赖旧的 React 状态去判断转写是否完成，必须以本次 IPC 返回的最终文本为准。

### 5.4 文本与展示规范

- 展示与日志中的 transcript 需先去除 whisper 时间戳片段（`[00:00:00.000 --> ...]`）。
- 保存页正文默认使用简体中文纠错文本，并允许用户手动编辑。
- AI 未识别到股票时，需走本地股票库匹配兜底，并保留手动输入 6 位代码入口。

---

## 六、当前数据输出

保存笔记时当前使用的字段：

```ts
{
  title: `${stockName}+${stockCode}`,
  content: editableNoteContent,
  eventTime: noteEventTime,
  viewpoint: noteDirection,
  audioFile: audioPath,
  audioDuration: recordingDuration
}
```

说明：

- `title` 统一为 `股票名称+代码`
- `content` 是实际写入 Markdown 的最终正文（可在保存前编辑）
- `audioFile` 指向原始音频
- `audioDuration` 用于统计和展示

---

## 七、已修复的关键问题

### 7.1 转写调用语义不一致

历史问题：

- `voice:transcribeFile` 在主进程里只是把消息发给 Swift 服务
- 前端却把它当成“已经拿到了转写结果”

修复后：

- 主进程会等待最终 `transcript`
- 前端直接使用这次调用返回的文本

### 7.2 保存笔记字段不匹配

历史问题：

- 录音弹窗保存时传给 `notes:addEntry` 的字段名与 `NotesService` 不一致

修复后：

- 改为传 `content/audioFile/audioDuration`

### 7.3 Swift 服务整文件转写解析不稳

历史问题：

- `WhisperEngine` 的输出解析策略不够稳
- 实时转写支路还存在绝对路径依赖

修复后：

- 补充了更明确的输出解析和错误处理
- 去掉了写死的工作目录路径

---

## 八、后续建议

### 8.1 短期

- 把 Swift 服务源码纳入主仓库或独立仓库管理
- 增加一条可自动化的端到端转写测试
- 明确 `NotesService` 的录音入口数据模型

### 8.2 中期

- 优化股票名称匹配准确率
- 为无语音内容和超短音频增加更清晰的提示
- 统一录音模式和上传模式的错误提示
