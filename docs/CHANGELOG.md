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
