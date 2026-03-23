# Swift 语音服务子模块说明

`voice-transcriber-service` 已独立为仓库并接入主仓子模块：

- 子模块路径：`voice-transcriber-service`
- 子模块仓库：`https://github.com/summercx1988/voice-transcriber-service.git`

## 初始化

```bash
git submodule update --init --recursive
```

## 首次本地准备

```bash
cd voice-transcriber-service
./scripts/setup-whisper.sh
swift build
cp .build/debug/voice-transcriber-service ./voice-transcriber-service
```

## 主仓开发流程

当子模块有更新后，在主仓中执行：

```bash
git add voice-transcriber-service .gitmodules
git commit -m "chore: bump voice-transcriber-service submodule"
```

## 子模块仓开发流程

在 `voice-transcriber-service` 目录中单独提交并推送：

```bash
git add .
git commit -m "..."
git push origin main
```

然后回到主仓更新子模块指针并提交。

## 当前已纳入子模块的关键修复

- `Sources/AudioRecorder.swift`
  - 去掉了实时转写分支中的绝对路径依赖，改为依据 `Config.shared.whisperCppPath` 计算工作目录。
- `Sources/WhisperEngine.swift`
  - 整文件转写补充了更稳的输出解析与错误处理。
- `Sources/Config.swift`
  - 默认路径同时兼容“子模块内运行”和“历史同级目录运行”两种场景。
