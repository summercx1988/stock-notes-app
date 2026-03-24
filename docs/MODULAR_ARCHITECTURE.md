# 模块化架构说明（A 方案首轮落地）

更新时间：2026-03-24

## 1. 当前分层

```text
renderer(UI)
  -> preload(API bridge)
    -> ipc(transport)
      -> application(usecase orchestration)
        -> core(pure logic)
        -> services/adapters(IO implementation)
```

## 2. 已落地模块

1. `src/main/core/review-snapshot.ts`
- 纯函数模块，不依赖 Electron/UI/文件系统
- 提供复盘方向归一化、区间过滤、样本统计

2. `src/main/application/notes-app-service.ts`
- 统一用例入口（笔记 CRUD / 时间轴 / 复盘快照）
- UI 与 CLI 复用同一应用层

3. `src/main/ipc/review.ts`
- 新增 `review:getSnapshot` IPC
- renderer 不再在组件内部实现复盘统计

4. `src/main/cli/review-cli.ts`
- 命令行模式调用同一应用层用例
- 支持 `single/overall` 两种 scope

## 3. 关键复用点

- Electron UI 调用：`window.api.review.getSnapshot(...)`
- CLI 调用：`npm run cli:review -- --scope overall --start ... --end ...`
- 两者底层都走 `NotesAppService#getReviewSnapshot`

## 4. 下一步建议（Phase 3 前后）

1. 抽 `MarketDataProvider` 接口，接入 K 线 API 与本地缓存实现。
2. 抽 `ReviewEngine`（规则判定）为 core 纯逻辑模块。
3. 将 `VoiceTranscriberClient` 进一步去 Electron 化（事件总线/回调注入），形成可独立调用的语音 adapter。
4. 增加 `agent-friendly` CLI 子命令（JSON 输出稳定 schema）。
