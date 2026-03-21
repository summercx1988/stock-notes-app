# 语音转写技术方案 - 历史归档

**归档日期：** 2025-03-20
**归档原因：** 采用新的 Swift 独立服务方案

---

## 方案一：Node.js + whisper-node（已弃用）

### 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          Electron App                           │
├─────────────────────────────────────────────────────────────────┤
│  Renderer (React)  →  Main Process (Node.js)  →  whisper.cpp   │
│       ↓                        ↓                     ↓          │
│  MediaRecorder API      IPC Handler          本地模型转写       │
│  (WebM/WAV)            preload.ts           ggml-medium.bin    │
└─────────────────────────────────────────────────────────────────┘
```

### 弃用原因

1. **浏览器录音限制**：MediaRecorder API 不支持直接录制 WAV，只能录制 WebM
2. **音频格式问题**：WebM 格式需要 ffmpeg 转换，增加复杂度
3. **转写质量**：非实时转写，用户体验差
4. **中文识别问题**：small 模型中文识别不准确，medium 模型较大

### 相关文件

- `src/main/services/whisper.ts` - Node.js whisper 服务
- `src/renderer/components/RecordingControl.tsx` - 前端录音组件
- `node_modules/whisper-node/` - whisper-node 包

---

## 方案二：AudioContext WAV 录制（已弃用）

### 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          Electron App                           │
├─────────────────────────────────────────────────────────────────┤
│  Renderer (React)                                              │
│       ↓                                                        │
│  AudioContext + ScriptProcessor                                │
│  (直接生成 WAV 16kHz PCM)                                       │
│       ↓                                                        │
│  Main Process → whisper.cpp                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 弃用原因

1. **ScriptProcessor 已废弃**：现代浏览器推荐使用 AudioWorklet
2. **非实时转写**：仍需录音结束后才能转写
3. **延迟较高**：用户需要等待转写完成

---

## 对比总结

| 方案 | 录音方式 | 转写方式 | 延迟 | 中文识别 | 状态 |
|------|----------|----------|------|----------|------|
| Node.js + whisper-node | MediaRecorder (WebM) | 录音后转写 | 高 | 差 | 弃用 |
| AudioContext WAV | ScriptProcessor | 录音后转写 | 高 | 一般 | 弃用 |
| **Swift 服务** | AVAudioEngine | **实时流式** | **低** | **好** | **当前** |

---

## 保留的代码

旧方案的代码保留在以下位置，供参考：

- `src/main/services/whisper.ts` - Node.js whisper 服务（已停用）
- `src/renderer/components/RecordingControl.tsx` - 前端录音组件（待重构）

---

## 迁移说明

新方案采用 Swift 独立服务，详见：
- `docs/TECHNICAL_SPEC_V2.md` - 新技术方案
- `voice-transcriber-service/` - Swift 服务代码
