# 运行与排障手册（整合版）

更新时间：2026-04-05

## 1. 本地开发启动

### 1.1 应用

```bash
npm install
npm run electron:dev
```

### 1.2 语音子模块

```bash
git submodule update --init --recursive
cd voice-transcriber-service
./scripts/setup-whisper.sh
swift build
cp .build/debug/voice-transcriber-service ./voice-transcriber-service
```

## 2. 飞书机器人配置（WebSocket 模式）

### 2.1 平台侧

1. 在飞书开放平台创建“企业自建应用”。
2. 获取 `App ID` 和 `App Secret`。
3. 权限至少包含：
- `im:message`
- `im:message:send_as_bot`
4. 事件订阅至少包含：
- `im.message.receive_v1`
- `card.action.trigger`
5. 发布应用版本使配置生效。

### 2.2 应用侧

1. 打开设置页，填写飞书凭据。
2. 打开 Header 的“远程录入”开关。
3. 观察连接状态与主进程日志。

## 3. 常见故障速查

### 3.1 `fetch failed` / AI 调用失败

- 检查设置中的文本分析 `baseUrl/model/apiKey`。
- 检查网络连通性和服务可达性。
- 查看 `app.log` 对应请求错误上下文。

### 3.2 飞书编辑卡片保存失败（典型 `200530`）

- 检查卡片是否 JSON 2.0 `form`。
- 检查表单交互项 `name` 是否唯一、非空。
- 检查提交按钮是否 `form_action_type: submit`。
- 排查旧 Electron 进程是否仍在处理回调。

### 3.3 点击后界面无响应

- 先看主进程日志是否进入 IPC。
- 再看 Daily Review 进度事件是否有回传。
- 检查是否命中“无变化跳过”门禁。

### 3.4 复盘 K 线不刷新

- 检查 `review:getVisualData` / `review:getSnapshot` 返回。
- 检查行情缓存与 API 超时日志。
- 切换标的后确认请求参数是否更新。

## 4. 日志与定位

### 4.1 离线日志路径

```text
~/Library/Application Support/stock-notes-app/data/logs/app.log
```

### 4.2 排障建议

1. 先复现一次，记录操作时间点。
2. 在日志中按模块关键字检索：
- `DailyReview`
- `NotesService`
- `IPC`
- `CloudAIAdapter`
- `Feishu`
3. 对齐“前端报错时间”和“主进程错误时间”。

## 5. 数据安全与备份

### 5.1 导入导出

- 入口：工具 -> 笔记导入导出
- 模式：
- `跳过重复`
- `覆盖重复`

### 5.2 子模块更新约定

当语音子模块更新后：

```bash
git add voice-transcriber-service .gitmodules
git commit -m "chore: bump voice-transcriber-service submodule"
```

## 6. 发布前检查清单

1. `npm run build` 通过。
2. 每日复盘生成、删除、归档流程可用。
3. 复盘分析切换标的后 K 线正常刷新。
4. 飞书远程录入链路可收发并可保存。
5. `docs/CHANGELOG.md` 已更新。
