# Changelog

All notable changes to this project will be documented in this file.

## 2026-03-26 (盯盘笔记状态编辑与标签展示优化)

### Added
- 盯盘笔记页支持编辑 `trackingStatus`：
  - 新增笔记时可选择状态（`关注` / `已取关`）。
  - 编辑笔记时可直接更新状态并保存。

### Changed
- 盯盘笔记页标签文案简化为“仅显示标签值”：
  - 例如显示 `看盘预测`，不再显示 `类别: 看盘预测`。
  - 观点 / 操作 / 状态标签统一采用相同风格。
- 盯盘笔记页新增与编辑表单的字段行改为自动换行，避免字段过多时挤压布局。

## 2026-03-26 (AI解析编排与飞书卡片增强)

### Added
- 新增 `ParseOrchestrator` 轻量编排器（Normalize/Extract/Verify/CardDraft/Finalize 五步）：
  - `AI` 解析结果新增可解释字段：`stockCandidates`、`stockConfidence`、`decisionReason`、`needsUserDisambiguation`。
  - 提供结构化卡片草稿 `cardDraft`，用于飞书确认卡片组装。
  - 固化单次解析调用预算：最多 2 次 LLM 请求。
- 新增飞书候选股票点选交互：
  - 当股票识别不确定时，卡片展示 Top3 候选股票按钮。
  - 保留手动回复股票名称/代码的兜底流程。

### Changed
- 飞书卡片动作 payload 升级：
  - 主链路卡片统一使用 `schemaVersion: '2.0'` 回调协议。
  - 动作幂等键从 `messageId + actionType` 升级为 `messageId + actionType + payloadHash`。
- `save_edit` 严格 schema 校验：
  - `viewpoint` 仅支持 `看多/看空/震荡/未知`（兼容输入 `中性` 并归一为 `震荡`）。
  - `operationTag` 仅支持 `买入/卖出/无`。
  - `eventTime` 必须可解析为合法时间。
  - 非法字段直接拒绝落库并返回错误卡片。
- 保存幂等增强：
  - 新增保存前去重（`messageId + 内容哈希`），避免重复写入同一条笔记。
- 飞书编辑卡片升级为标准 JSON 2.0 表单：
  - 所有表单交互组件补齐唯一 `name`。
  - 提交按钮改为 `form_action_type: "submit"` + `behaviors.callback`。
  - 编辑保存回调改为优先读取 `form_value` 中的真实用户输入。
  - 笔记类型改为下拉选择，统一为单个“保存笔记”按钮。
  - “普通笔记”不再复用预测笔记的严格观点/操作校验。
- 飞书确认卡片、候选股票卡片、成功/失败提示卡片统一迁移到 JSON 2.0：
  - 移除旧式 `action` 容器。
  - 按钮回调统一改为 `behaviors.callback`。
- 新增飞书极速解析链路：
  - 飞书消息改走独立 `FeishuFastParseOrchestrator`，不影响本地录音与通用 `extract()`。
  - 优先使用本地规则识别股票/观点/操作标签。
  - 当本地规则已形成候选股票时，不再调用 LLM，直接进入确认卡片或候选卡片。
  - 仅在本地规则完全无法形成候选时，才触发 1 次轻量 LLM 兜底。
  - 飞书场景不再执行文本改写、简繁转换补偿、关键点提炼、二次补全等重步骤。
- 本地录音保存链路开始复用极速解析接口：
  - `RecordingControl` 改为调用 `ai:extractFast`。
  - 先以录音保存链路做最小范围验证，不影响其它文本分析入口。
- `VoiceTranscriberClient` 连接状态管理增强：
  - 启动录音前先确保 WS 可用。
  - 停止录音改为幂等，避免断连时直接抛出保存失败。
  - `isConnected/isRunning` 判定改为基于真实连接状态。
- 清理飞书卡片交互冗余逻辑：
  - 删除 `confirm -> save_edit` 的历史兼容回退。
  - 删除 `SessionManager` 中未使用的冗余方法。

### Removed
- 删除早期且已明显过时的 `docs/TEST_GUIDE.md`，统一以当前技术规格和录音专项文档为准。

### Notes
- 当前环境离线时，编排器会自动降级到规则+本地库流程，仍保持不超过 2 次 LLM 调用尝试。
- 新增飞书卡片交互经验文档：
  - `docs/FEISHU_CARD_INTERACTION_LESSONS.md`

## 2026-03-25

### Added
- Review visual data pipeline for K-line alignment:
  - Added review visual request/response types and marker/cluster models.
  - Added backend alignment core module for event-to-candle matching with binary search.
  - Added IPC bridge `review:getVisualData`.
- New review K-line panel:
  - Candlestick rendering with marker overlays.
  - Cluster badge display when multiple notes land on the same candle.
  - Marker/cluster interaction and detail selection.
- Bidirectional linkage between chart and detail tables:
  - Click marker to jump to and highlight corresponding detail row.
  - Click detail row to focus and highlight corresponding marker.

### Changed
- Review interval options now include `60m`.
- Market data interval mapping now supports `60m`.
- Review visual stock code resolution supports prefixed symbols (e.g. `SH000001`).
- `overall` review visualization defaults to benchmark `SH000001`.

### Notes
- `1d` interval type remains in shared types for compatibility, but the review UI uses minute-level intervals (`5m/15m/30m/60m`).

## 2026-03-25 (K线交互重构)

### Added
- 新增独立复盘 K 线模块 `src/renderer/components/review/ReviewKlineWorkbench.tsx`:
  - 接入 `klinecharts` 专业 K 线引擎（非手写 SVG）。
  - 模块内独立周期切换：`5m / 15m / 30m / 1d`。
  - 鼠标悬停反馈：实时展示蜡烛 `OHLC` 与同蜡烛笔记数量。
  - 支持点击蜡烛锚定时间，并通过“添加笔记”弹窗直接保存“看盘预测”笔记。
  - 保存后自动刷新 K 线与打标数据，并保留与明细联动能力。

### Changed
- 复盘页接入独立 K 线模块，不再由复盘主页面管理图表数据加载与渲染细节。
- 保持复盘统计参数区与表格逻辑不变，避免影响非图表主流程。

### Dependency
- 新增依赖：`klinecharts@9.8.12`（Apache-2.0）。
