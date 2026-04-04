# Changelog

All notable changes to this project will be documented in this file.

## 2026-04-03 (每日复盘链路重构与可用性修复)

### Changed
- 每日复盘页面重构为“左侧日志列表 + 右侧详情面板”：
  - 复盘日志成为页面主体，不再依赖弹窗查看详情。
  - 日志展示范围改为固定最近 30 天，和“近 3 天分析窗口”彻底解耦。
  - 页面补充 `notes:changed` 监听，普通笔记或复盘笔记变更后会自动刷新。
- 每日总结/盘前复习生成链路改为“本地先落草稿，AI 再增强”：
  - 点击按钮后先生成一条本地可读复盘日志，避免长时间无结果。
  - AI 增强失败时保留本地结果并标记失败原因，不再整条生成报错丢失。
  - 同日重复生成默认更新当日已有日志，而不是静默复用或无提示跳过。
- 每日复盘数据采集从全量 `TimelineExplorer` 扫描切换为轻量“最近笔记候选”读取：
  - 仅解析最近时间窗口内有变更的股票笔记文件。
  - `notesLastUpdatedAt` 初始化改为读取普通笔记文件修改时间，避免页面打开即触发全量扫描。
- 每日总结提示词新增“近期优先”约束：
  - T0/T-1 作为主体。
  - T-2/T-3 只做延续性提醒，避免旧笔记稀释当日复盘重点。

### Fixed
- 修复“点击生成今日复盘反馈很慢、最后也未必生成笔记”的核心问题：
  - 生成过程中会先写入本地日志。
  - AI 不可用时仍会保留可读复盘。
- 修复“历史日志容易消失”的问题：
  - 历史列表不再跟随分析窗口缩短到仅近 3 天。
- 修复“无变化”逻辑的误导体验：
  - 页面继续展示更新时间状态，但不再静默复用旧结果冒充新生成。

## 2026-04-03 (每日总结无变化跳过与状态可视化)

### Added
- 新增每日总结生成状态存储：`runtime/review-generation-state.json`
  - 记录 `notesLastUpdatedAt`
  - 记录 `dailySummaryLastGeneratedAt`
  - 记录 `dailySummaryLastGeneratedFromUpdatedAt`
- 新增 `daily-review:get-generation-status` IPC 接口，前端可展示上述三项时间状态。

### Changed
- 每当股票笔记发生新增/编辑/删除（排除 `__DAILY_REVIEW__` 系统笔记）时，自动更新 `notesLastUpdatedAt`。
- 每日总结生成前增加“无变化门禁”：
  - 当检测到笔记未变化时，复用最近一次每日总结，不重复生成。
  - 生成成功后回写本次生成基准时间。
- Daily Review 页面新增“更新时间状态卡”，并将生成按钮改为小尺寸，突出复盘内容主体。

## 2026-04-03 (每日复盘聚焦与详情兼容修复)

### Changed
- 每日复盘历史数据改为仅返回“每日总结 / 盘前复习”，默认不再展示“周回顾 / 月回顾”颗粒度。
- 停用 `daily-review:generate-weekly` 生成功能，统一回传“仅保留每日总结与盘前复习”的提示。
- 预加载层移除 `dailyReview.generateWeekly` 暴露，避免前端误调用周回顾接口。

### Fixed
- 修复历史条目详情弹窗“可弹出但无内容”的兼容问题：
  - 对老格式 JSON、普通文本、非结构化条目增加回退渲染。
  - 无法按结构化字段解析时，展示原始内容或完整 JSON，避免空白弹窗。

## 2026-04-02 (每日复盘性能与管理能力补齐)

### Added
- 每日复盘生成进度事件通道 `daily-review:generation-progress`：
  - 覆盖“今日总结 / 盘前复习 / 周回顾 / 重新生成 / 收录到笔记”。
  - 前端新增进度条展示，减少长耗时操作“无反馈”问题。
- 每日复盘管理能力补齐：
  - 新增单条删除 `daily-review:delete-entry`。
  - 新增批量删除 `daily-review:delete-entries`。
  - 页面新增历史记录勾选与批量管理操作。

### Changed
- 每日复盘分析范围改为受设置驱动（默认近 3 天）：
  - `DailyReviewService.collectDayNotes()` 支持 `analysisLookbackDays` 与 `analysisMaxItems`。
  - 默认仅分析近 T-3，并限制送入 AI 的条数，避免长历史数据导致耗时过久。
- 每日复盘页面历史加载改为按设置范围查询（默认近 3 天），避免全量历史读取。
- 盘前提醒调度器改为完全受配置控制：
  - 支持 `enabled`、`time`、`weekdaysOnly`、`autoGeneratePreMarket`。
  - 提醒弹窗内容支持 `includeSections` 勾选控制（昨日概要/待跟进/关键位/观察列表/风险提醒）。
- 提醒弹窗内容结构增强，补充“关键位”和“观察列表”展示。

## 2026-04-02 (每日复盘提醒与卡片收录改进)

### Added
- 新增主进程离线文件日志能力：
  - 统一将 `console.log/info/warn/error/debug` 写入 `~/Library/Application Support/stock-notes-app/data/logs/app.log`。
  - 新增日志敏感字段脱敏（`apiKey/token/secret` 等）与按大小轮转（保留最近 3 份历史日志）。
- 新增每日复盘盘前提醒调度器（主进程）：
  - 工作日 09:00 后自动检查并触发盘前复习提醒。
  - 当日无盘前复习卡片时自动生成，并通过 `daily-review:reminder` 推送到前端。
- 新增全局盘前提醒弹窗卡片：
  - 支持查看昨日概要、待跟进事项、风险提醒。
  - 支持“标记已读”“收录到笔记”“查看每日复盘”操作。
- 新增每日复盘卡片“收录到笔记”能力：
  - 支持从“每日总结/盘前复习/周回顾”抽取关联股票。
  - 自动写入对应股票的普通笔记，进入现有笔记编辑与管理链路。

### Changed
- 为关键业务链路补充结构化日志（便于离线排障）：
  - `DailyReviewService`：生成每日总结/盘前复习/周回顾、收录到笔记的开始/完成/失败日志。
  - `CloudAIAdapter`：文本分析/语音识别请求的开始、响应状态、异常归一化日志。
  - `IPC`（daily-review/ai/notes）：调用入口统一记录耗时与错误上下文。
  - `NotesService`、`AppConfigService`、`WatchlistService`：关键读写操作与失败场景日志补齐。
- 每日复盘数据采集由 timeline 摘要改为 explorer 数据源，AI 总结可读取正文预览信息，提升生成质量。
- 每日复盘写入与已读状态变更时，补齐 `notes:changed` 通知，确保界面联动更新。
- `DailyReviewView` 操作区新增“收录到笔记”入口，并修复风险提醒渲染逻辑。
- 主布局接入提醒监听与启动检查，应用在 09:00 后启动也可展示当日未读盘前提醒。
- 默认将 `__DAILY_REVIEW__` 系统股票从通用 timeline/explorer/Sidebar 数据流中排除，减少对其它模块的干扰。

### Fixed
- 修复每日复盘页面的编译错误（类型引用路径、变量作用域、未使用变量等）。
- 修复主进程与公共服务中的 TypeScript 报错，恢复 `npm run typecheck` 与 `npm run build` 通过。
- 修复“生成今日总结”报 `fetch failed`：
  - `CloudAIAdapter` 改为读取设置页中的文本分析配置（`baseUrl/model/apiKey`），不再硬编码 OpenAI 默认地址。
  - 网络不可达时提供可读错误信息，提示检查网络与服务地址配置。
- 修复每日复盘 JSON 解析失败（`Unexpected token '<', "<think>..."`）：
  - 解析器新增对 `<think>...</think>`、Markdown 代码块、前后自然语言包裹的容错提取。
  - 支持从响应文本中提取首个完整 JSON 对象，避免模型额外输出导致生成失败。

### Removed
- 删除旧版每日复盘需求文档：`docs/features/daily-review-feature-spec.md`
- 删除旧版每日复盘方案草案：`plans/daily-review-feature.md`

## 2026-03-31 (v3.6 应用打包发布)

### Added
- 新增 macOS 应用打包支持：
  - 配置 `electron-builder` 生成 DMG 和 ZIP 安装包。
  - 支持 Apple Silicon (arm64) 和 Intel (x64) 双架构。
  - 语音服务自动打包到应用资源目录。
- 新增 macOS 权限配置 `build/entitlements.mac.plist`：
  - 麦克风权限、网络访问、文件读写权限。
- 更新 `.gitignore` 防止敏感文件和构建产物上传。
- 新增批量股票查询接口 `stock:getByCodes`，减少 IPC 调用次数。

### Changed
- **数据存储路径统一**：
  - 开发与部署统一使用 `~/Library/Application Support/stock-notes-app/data/`。
  - 首次运行自动创建数据目录。
  - 重装应用不会丢失用户数据。
  - 项目代码不包含用户数据，安全上传 Git。
- **启动性能优化**：
  - 主进程后台任务延迟 200ms 执行，窗口先显示。
  - 观点迁移添加标记文件，只执行一次。
  - 前端使用批量查询替代逐个查询。
- README 新增打包发布章节，包含完整的打包流程和安装说明。
- 版本基线更新为 `v3.6`。

### Fixed
- 修复打包后应用无法启动的问题（路径编码、sandbox 配置）。
- 修复打包后语音服务路径错误的问题。
- 修复删除笔记后 sidebar 笔记数量不更新的问题（添加 `notifyNotesChanged` 调用）。
- 修复退出时后台进程未完全停止的问题（改进 `before-quit` 处理）。

### Added
- 新增应用菜单，支持 `Cmd+Q` 快捷键退出。
- 新增退出时清理所有后台服务的逻辑。

### Notes
- 首次打开应用时，如提示"无法验证开发者"，需右键点击应用选择"打开"确认。

## 2026-03-27 (事件纵览板块矩阵与侧边栏股票信息增强)

### Added
- 事件纵览页新增行业板块维度：
  - 横向按 `sector` 板块分组，并在板块内按观点（看多 / 震荡 / 看空 / 未知）分列。
  - 事件详情抽屉展示股票的板块 / 行业信息。
- 左侧股票 sidebar 在标题下方补充板块 / 行业信息，便于快速识别标的所属赛道。

### Changed
- 事件纵览页 marker 尺寸改为随近期记录密度变化：
  - 以当前可视时间窗内近 14 天记录数作为“关注度”信号。
  - 近期记录更多的股票，marker 更大；最新一条记录会再轻微放大。
- 事件纵览图表容器改为原生滚动：
  - 支持纵向滚动条浏览长时间序列。
  - 当板块列过多时自动出现横向滚动条。
- 事件纵览查询在旧笔记未写入 `industry/sector` 时，增加股票库兜底补全，避免因历史数据缺字段导致分组缺失。

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
