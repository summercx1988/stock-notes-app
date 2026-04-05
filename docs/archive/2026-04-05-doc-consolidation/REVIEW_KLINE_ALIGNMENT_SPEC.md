# 复盘分析 K 线对齐展示技术方案（评审稿）

## 1. 背景与目标

当前复盘页已具备：
- 规则参数（`D`、`%`）
- 统计指标（预测胜率、操作归因）
- 明细表格（事件级结果）

但缺少“可视化验证层”，无法直观看到：
- 笔记事件在 K 线中的位置
- 事件与后续走势关系
- 多条笔记落在同一根 K 线上的聚合关系

本方案目标是在**指标区与明细区之间**新增“K 线 + 笔记打标”可视化区域，用于辅助验证复盘结果，并保证性能与可维护性。

---

## 2. 需求映射（来自你当前要求）

### 2.1 必做
- 在复盘页面增加 K 线可视化区，展示笔记与 K 线对齐结果
- 在图上打标“预测笔记观点”（看多/看空/中性/未知）
- 支持 `5m / 15m / 30m / 60m` 切换
- 当同一蜡烛上有多条笔记时，进行聚合展示（小框/计数）
- 明确 API 缓存方案
- 明确快速对齐算法与复杂度
- 兼顾 UI/UX 与响应速度

### 2.2 本期不改（建议）
- 不改变既有胜率判定逻辑（继续沿用 `review-evaluator`）
- 不在本期引入多数据源切换
- 不在本期引入复杂绘图编辑能力（拖拽注释、画线）

---

## 3. 现状评估（代码基线）

### 3.1 复盘页现状
- 组件：[ReviewAnalysisView.tsx](/Users/xudan/Documents/trae_projects/stock-notes-app/src/renderer/components/ReviewAnalysisView.tsx)
- 当前仅有统计卡片 + 表格，无图表容器
- interval 当前支持 `5m/15m/30m/1d`（需改为包含 `60m`）

### 3.2 核心服务现状
- 复盘入口：[notes-app-service.ts](/Users/xudan/Documents/trae_projects/stock-notes-app/src/main/application/notes-app-service.ts)
- 评估逻辑：[review-evaluator.ts](/Users/xudan/Documents/trae_projects/stock-notes-app/src/main/core/review-evaluator.ts)
- 行情服务：[market-data.ts](/Users/xudan/Documents/trae_projects/stock-notes-app/src/main/services/market-data.ts)

### 3.3 缓存现状
- 已有磁盘缓存：`data/market/{stockCode}_{interval}.json`
- 当前为“读缓存 -> 拉 API -> merge -> 回写”
- 尚无：
  - 内存级复盘可视化缓存
  - 针对“区间缺口”的增量拉取策略
  - marker 聚合缓存

---

## 4. 技术选型建议

## 4.1 图表库选择

推荐：`lightweight-charts`

理由：
- K 线渲染性能好（分钟级数据量可控）
- Electron + React 兼容性稳定
- 对时间轴交互、缩放、跨区间切换响应快
- marker 能力可满足“单点打标 + 聚合计数”基础需求

备选：`echarts`
- 优点：生态丰富、定制多
- 缺点：在频繁区间切换和高密度标注下开销更高，且开发复杂度偏高

结论：本项目强调轻量与响应速度，优先 `lightweight-charts`。

---

## 5. 模块化架构设计

新增/扩展模块（不破坏现有模块）：

1. `main/core/review-alignment.ts`（新增）
- 纯函数：事件与 candle 对齐、聚合、排序
- 不依赖 Electron/IO，便于单测

2. `main/application/notes-app-service.ts`（扩展）
- 新增 use-case：`getReviewVisualData(...)`
- 复用现有 `marketDataService + collectReviewEvents`

3. `main/ipc/review.ts`（扩展）
- 新增 IPC：`review:getVisualData`

4. `renderer/components/ReviewKlinePanel.tsx`（新增）
- 独立图表组件，避免 `ReviewAnalysisView` 继续膨胀

5. `shared/types.ts`（扩展）
- 增加可视化请求/响应类型、marker 与聚合结构

---

## 6. 数据契约（建议）

## 6.1 请求

```ts
interface ReviewVisualRequest {
  scope: 'single' | 'overall'
  stockCode?: string           // scope=single 必填；overall 下为“图表锚点股票”
  startDate?: string
  endDate?: string
  interval?: '5m' | '15m' | '30m' | '60m'
  includeCategories?: string[] // 默认按 reviewEligible 过滤
}
```

## 6.2 返回

```ts
interface ReviewVisualResponse {
  scope: 'single' | 'overall'
  stockCode: string
  interval: '5m' | '15m' | '30m' | '60m'
  candles: MarketCandle[]
  markers: ReviewMarker[]              // 展示级 marker（已对齐）
  clusters: ReviewMarkerCluster[]      // 每根 candle 的聚合信息
  stats: {
    totalMarkers: number
    clusteredCandles: number
    maxClusterSize: number
    outOfRangeMarkers: number
  }
  generatedAt: string
}
```

---

## 7. 对齐与聚合算法

## 7.1 对齐原则（与当前评估逻辑保持一致）

为避免“图和表结论不一致”，采用与 `review-evaluator` 相同基准：
- 对每条事件，寻找第一根 `candle.timestamp >= eventTime` 的 K 线作为对齐点

好处：
- 与现有胜率判定入口一致
- 用户理解成本低（图上点位与明细行一一对应）

## 7.2 性能实现

对齐算法优化为：
- candles 先升序
- 事件时间转毫秒
- 用二分查找定位 `lower_bound`（而不是线性 `findIndex`）

复杂度：
- 当前：`O(E * C)`
- 优化后：`O(E * logC)`，E=事件数，C=K线数

## 7.3 聚合规则（同一蜡烛多事件）

按 `alignedCandleTs` 分组：
- `count = 1`：单 marker（方向色）
- `count > 1`：聚合 marker（计数小框/徽标）

聚合对象保留：
- 总数
- 看多/看空/中性/未知分布
- 对应 entryId 列表（支持点击联动明细表）

---

## 8. 缓存与加载策略

## 8.1 磁盘缓存（行情）

沿用现有 `data/market/{code}_{interval}.json`，并增强元数据：
- `updatedAt`
- `coverageStart`
- `coverageEnd`
- `schemaVersion`

策略：
- 请求区间完全覆盖且新鲜度命中：直接返回
- 存在区间缺口：仅增量拉取缺失片段并 merge
- API 失败：回退本地缓存，页面给“缓存数据”提示

## 8.2 内存缓存（可视化）

在主进程增加 LRU（建议上限 50 key）：
- key: `stock + interval + start + end + categoryHash + notesVersion`
- value: `ReviewVisualResponse`
- TTL：5 分钟（命中优先）

`notesVersion` 建议来源：
- 对应股票笔记文件 `mtimeMs`（或 entries hash）

## 8.3 前端缓存

组件内短缓存（session 级）：
- 切 interval 时优先显示上次结果（避免白屏）
- 后台静默刷新并替换

---

## 9. UI/UX 方案（复盘页）

## 9.1 布局

复盘页从上到下：
1. 参数区（scope/range/interval/rule）
2. 指标卡片
3. **K 线对齐区（新增核心）**
4. 事件明细表 + 操作明细表

## 9.2 K 线区交互

- interval 切换：`5m / 15m / 30m / 60m`
- marker hover：显示该点笔记摘要（时间、方向、命中结果）
- cluster hover：显示聚合详情（例：共 4 条，看多2/看空1/中性1）
- marker click：联动滚动到对应明细行并高亮
- 明细行 click：反向定位图上 marker

### 9.4 overall 模式展示建议（评审结论）

`overall` 模式默认使用**上证指数**作为市场基准图（用于观察市场背景），同时保留“个股验证入口”：
- 图表主体：上证指数 K 线（默认）
- 图上标记：默认展示“全股票事件密度/方向分布聚合”，不直接把所有个股观点映射为指数涨跌结论
- 辅助入口：支持从整体统计中选择一只股票，切换到该股票的“严格对齐视图”验证细节

这样做的原因：
- 全股票观点直接投射到指数 K 线，语义容易失真
- 先给市场背景，再进入个股核验，符合“先总览再钻取”的复盘习惯

## 9.3 视觉编码

- 看多：红
- 看空：绿
- 中性：蓝灰
- 未知：灰
- 聚合：中性底色 + 计数数字（如 `3`）

---

## 10. API 与模块改动清单（评审用）

1. `shared/types.ts`
- `KlineInterval` 增加 `60m`（并评估是否保留 `1d`）
- 新增 `ReviewVisualRequest/Response` 等类型

2. `main/services/market-data.ts`
- `intervalToKlt` 增加 `60m` 映射
- 增强缓存元数据 + 缺口增量逻辑

3. `main/application/notes-app-service.ts`
- 新增 `getReviewVisualData(request)`
- 复用 `collectReviewEvents`，增加对齐/聚合调用

4. `main/ipc/review.ts`
- 新增 `review:getVisualData`

5. `renderer/components/ReviewAnalysisView.tsx`
- 接入新图表区，分离到 `ReviewKlinePanel`

6. `renderer/components/ReviewAnalysisView.tsx`（overall 交互增强）
- 新增“基准图：上证指数”说明
- 新增“切换到个股验证”入口（从统计结果跳转）

---

## 10.1 interval 可扩展策略（回答“后续能否拓展”）

可以扩展。为避免笔记增多后图表卡顿，建议从第一版就按“可扩展层级”设计：

1. interval 注册表化
- UI 与服务都走统一枚举注册（当前启用 `5/15/30/60`）
- 后续可无痛增加 `1m/120m/1d`

2. 渲染上限保护
- 单次渲染设置 candle 上限（建议 3000~5000）
- 超限时自动提示并建议切换更大周期或缩小时间范围

3. 可见区优先加载
- 优先渲染当前视窗所需区间，非可见区延迟加载
- 切换周期时先显示缓存快照，再异步补齐

4. 多级聚合
- 缩放过远时，marker 从“按 candle 聚合”升级为“按像素桶聚合”
- 避免密集标记造成遮挡与性能下降

5. 后端缓存分层
- 磁盘缓存（行情原始）
- 内存 LRU（可视化结果）
- 可选：由 `5m` 本地派生 `15/30/60`，减少重复 API 依赖

---

## 11. 性能预算（目标）

- 复盘页首次图表加载（缓存命中）：`< 500ms`
- 复盘页首次图表加载（缓存未命中）：`< 2s`
- interval 切换（已缓存）：`< 300ms`
- 2000 根 candle + 300 marker 渲染：保持交互流畅（无明显卡顿）

---

## 12. 风险与规避

1. 非交易时段事件对齐偏差
- 规避：使用“下一根可交易 candle”规则并在 tooltip 明示

2. overall 模式图表语义不清（全股票无法共用一张 K 线）
- 规避：overall 仅统计综合指标；图表必须指定“锚点股票”

3. API 波动导致空图
- 规避：回退本地缓存 + UI 明示“当前为缓存数据”

4. 组件复杂度膨胀
- 规避：图表组件独立，数据处理放 main/core

---

## 13. 分阶段实施建议（评审后执行）

### Phase A（后端可视化数据链路）
- 增类型 + IPC + `getReviewVisualData`
- 对齐聚合纯函数与单测

### Phase B（前端图表基础）
- 接入 K 线图
- 单 marker 展示 + interval 切换

### Phase C（聚合与联动）
- 聚合计数 marker
- 图表与明细双向联动
- 提示与异常态完善

---

## 14. 待你确认的关键点

1. `overall` 模式默认以上证指数作为基准图，并提供“切换到个股验证”入口，是否确认？
2. interval 先固定 `5/15/30/60`，并按 10.1 预留扩展能力，是否确认？
3. 聚合 marker 的默认文案采用：`总数 + 多空分布`（如 `4条：多2 空1 中1`），是否确认？

---

## 15. 结论

该方案在不破坏现有复盘统计逻辑的前提下，新增“可视化验证闭环”，重点解决：
- 图表化验证
- 分钟级切换
- 同蜡烛多笔记聚合
- 缓存效率与对齐性能

待你确认第 14 节后，可进入实现阶段。
