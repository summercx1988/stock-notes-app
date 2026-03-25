# Changelog

All notable changes to this project will be documented in this file.

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
