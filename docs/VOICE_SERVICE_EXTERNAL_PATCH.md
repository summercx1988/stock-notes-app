# 外部 Swift 语音服务同步说明

当前开发环境依赖同级目录下的外部服务：

```text
../voice-transcriber-service
```

该目录不属于当前 `stock-notes-app` git 仓库，因此以下修复不会随本仓库 `git push` 自动同步：

## 本次已在外部服务本地完成的修复

### 1. 去掉实时转写支路中的绝对路径依赖

文件：

- `Sources/AudioRecorder.swift`

修复内容：

- 不再把 `process.currentDirectoryURL` 写死到本机绝对路径
- 改为根据 `Config.shared.whisperCppPath` 计算工作目录

### 2. 整文件转写改为更稳的解析方式

文件：

- `Sources/WhisperEngine.swift`

修复内容：

- 为 `whisper.cpp` 设置明确的工作目录
- 捕获 `stdout` 和 `stderr`
- 退出码非 0 时返回明确错误
- 过滤日志行后再提取真正的转写文本
- 空文本时明确抛错

## 建议

- 将 `voice-transcriber-service` 纳入独立 git 仓库管理，或作为子模块 / 子目录纳入主仓库
- 在后续版本中补一条针对该服务的构建与回归测试流程
