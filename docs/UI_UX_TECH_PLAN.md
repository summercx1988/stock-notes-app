# 面向对象笔记系统 - UI/UX 与技术方案（v1.1）

**版本：** v1.1  
**日期：** 2026-03-24  
**对应 PRD：** `docs/PRD.md`

---

## 一、范围与设计原则

### 1.1 范围

本方案覆盖 6 个核心诉求：

1. 垂直话题支持（当前 A 股）
2. 一个对象一个文件
3. 事件时间点记录（默认/自定义）
4. 观点配置（看多/看空/未知）
5. 单对象时间轴展示
6. 独立复盘分析模块（K 线对齐 + 胜率）

### 1.2 设计原则

- 先对象后内容：先确定对象，再记录事件
- 先记录后优化：输入体验优先于复杂分析
- 先可解释后智能：判定规则明确、可调、可复现

---

## 二、UI/UX 方案

### 2.1 信息架构

```text
顶部导航
├── 对象笔记
├── 时间轴
├── 复盘分析
└── 设置
```

### 2.2 页面一：对象笔记页

#### 页面结构

- 左栏：对象列表（A 股代码/名称检索）
- 中栏：对象事件流（时间倒序）
- 右栏：对象摘要（观点分布、最近记录、快捷筛选）

#### 关键交互

1. 用户点击 `录音`（或上传音频）。  
2. 系统完成转写 + AI 纠错 + 主题解析（股票、观点、要点）。  
3. 进入“保存页（笔记编辑态）”：
- ASR 原文只读展示（用于回看）
- 笔记正文为可编辑文本框（默认使用纠错后的简体中文文本）
- 股票优先自动预填，失败时支持搜索选择或手动输入 6 位代码
- 事件时间默认当前时间，可改到分钟级
- 观点默认 `未知`，可切换 `看多/看空/中性/未知`
4. 一键保存后写入对象文件并刷新事件流。

#### 交互细节

- 时间输入默认到分钟，展示格式 `YYYY-MM-DD HH:mm`
- 观点用高对比色 `Tag` 展示
- 未知观点默认灰色并显示“待验证”
- 保存标题默认格式：`股票名称+代码`（如 `招商轮船+601872`）
- 股票识别采用双兜底：AI 结构化提取失败 -> 本地股票库文本匹配 -> 用户手动选择/输入

### 2.3 页面二：单对象时间轴页

#### 页面结构

- 顶部：对象选择 + 时间范围 + 观点筛选
- 中部：可滚动时间轴
- 底部：节点详情面板

#### 关键交互

- 节点颜色映射观点：
- 看多：红
- 看空：绿
- 未知：灰
- 点击节点展开详情，支持编辑观点、时间与文本
- 双击节点可跳转到对象笔记页定位原始记录

#### 可用性增强

- 大量节点时启用虚拟列表 + 聚合显示（按日/周）
- 鼠标悬浮显示时间、观点、预测周期

### 2.4 页面三：复盘分析页（独立模块）

#### 页面结构

- 顶部统计范围切换：`单对象` / `全对象综合`
- 控制区：对象、区间、规则模板、参数、K 线周期
- 主图区：K 线图（蜡烛图）+ 事件标记
- 结果区：统计卡片 + 事件判定表

#### 关键交互

1. 选择对象与统计区间。  
2. 选择规则模板（默认 `3D 3%`）。  
3. 图上显示事件点并标注观点。  
4. 点击事件点查看：
- 记录文本
- 观察窗口
- 计算过程
- 命中/未命中结果
5. 切换到 `全对象综合` 后，展示区间内所有股票的综合胜率（简单汇总）。

#### K 线周期

- 支持多周期切换（如 `5m/15m/30m/1D`）
- 最小粒度 `5分钟`

#### 输出指标

- 总样本数
- 命中数
- 胜率
- 看多胜率
- 看空胜率
- 未知占比
- 全对象整体准确率
- 全对象综合胜率（简单命中/样本）

---

## 三、技术方案

### 3.1 领域模型

```ts
type TopicId = "a_share"
type Viewpoint = "bullish" | "bearish" | "unknown"

interface TopicObject {
  topic_id: TopicId
  object_id: string
  object_name: string
}

interface NoteEvent {
  id: string
  event_time: string
  created_at: string
  input_type: "voice" | "manual"
  text: string
  viewpoint: Viewpoint
  horizon?: string
}
```

### 3.2 存储模型（文件即数据库）

目录建议：

```text
data/topics/a_share/objects/{stock_code}.md
```

每个对象文件包含：

- Front Matter：对象元信息与聚合统计
- Body：按时间组织的事件块

### 3.3 应用模块拆分

- `topic-registry`：话题注册与对象解析
- `object-note-repository`：对象文件读写
- `event-service`：录音/手动写入统一入口
- `voice-note-composer`：转写结果编辑态编排（正文可编辑、股票预填、观点/时间确认）
- `timeline-service`：时间轴查询和筛选
- `review-engine`：规则执行与统计
- `market-data-adapter`：K 线数据适配层

### 3.4 K 线与复盘引擎

#### 数据流

```text
对象事件 -> review-engine -> market-data-adapter
                          -> K线时间对齐
                          -> 规则判定
                          -> 统计输出
```

#### 数据源策略（已确认）

- 按需触发 API 拉取 K 线
- 本地持久化缓存
- 后续优先使用本地缓存并按策略刷新

#### 默认判定算法（建议）

- 看多：`(window_close - entry_close) / entry_close >= threshold`
- 看空：`(entry_close - window_close) / entry_close >= threshold`
- 未知：默认不计入胜率

#### 默认参数（已确认）

- 默认窗口：`3D`
- 默认阈值：`3%`
- 默认时间粒度：分钟级
- 未知观点：默认不计入胜率
- K 线最小周期：`5m`

### 3.5 可配置规则结构

```ts
interface ReviewRule {
  id: string
  name: string
  window_days: number
  threshold_pct: number
  base_price: "close"
  include_unknown: boolean
  kline_interval: "5m" | "15m" | "30m" | "1d"
}
```

---

## 四、关键 API 设计（主进程）

### 4.1 对象与事件

- `topic:listObjects(topicId, query)`
- `note:getObjectNote(topicId, objectId)`
- `note:addEvent(topicId, objectId, payload)`
- `note:updateEvent(topicId, objectId, eventId, payload)`

### 4.2 时间轴

- `timeline:getObjectTimeline(topicId, objectId, filters)`

### 4.3 复盘

- `review:getKline(topicId, objectId, range, interval)`
- `review:evaluate(topicId, objectId, range, rule)`
- `review:getStats(topicId, objectId, range, rule)`
- `review:getOverallStats(topicId, range, rule)`

---

## 五、实施分阶段

### Phase 1：模型与录入（P0）

- 完成对象目录与文件读写统一
- 事件字段补齐 `event_time` 与 `viewpoint`
- 录音/手动入口统一走 `addEvent`

### Phase 2：时间轴（P0）

- 完成单对象时间轴页面
- 完成观点筛选与节点详情

### Phase 3：复盘基础（P1）

- 接入 K 线图展示
- 事件与 K 线对齐
- 规则判定与胜率统计
- 完成区间内全对象综合胜率（简单汇总）

### Phase 4：复盘增强（P2）

- 多规则模板
- 批量对象统计
- 报表导出

---

## 六、风险与治理

### 6.1 风险点

- 规则口径不统一导致统计不可比较
- K 线数据源差异导致结果漂移
- 大对象文件性能下降

### 6.2 方案

- 规则配置落盘并版本化
- 数据源统一归一化（时区、停牌、复权）
- 超大数据量采用“最近 N 天保留 + 历史归档”策略，避免主文件无限膨胀

### 6.3 归档策略（已确认）

- 主对象文件仅保留最近 `N` 天事件（`N` 可配置）。
- 历史事件归档到对象归档文件（按归档批次或时间段组织）。
- 归档数据默认不参与日常页面加载，但可在复盘时按需拉取。

---

## 七、需求追踪矩阵

| 核心诉求 | UI落点 | 技术落点 |
|----------|--------|----------|
| 垂直话题 | 对象选择器 | `topic-registry` |
| 单对象单文件 | 对象页与详情页 | `object-note-repository` |
| 时间点记录 | 事件编辑抽屉 | `event_time` 字段 |
| 观点配置 | 观点选择器/Tag | `viewpoint` 枚举 |
| 时间轴展示 | 时间轴页 | `timeline-service` |
| 复盘统计 | 复盘分析页 | `review-engine` |

---

## 八、需要你确认的参数

已确认：

1. 默认判定窗口：`3D`。  
2. 默认阈值：`3%`。  
3. K 线周期支持切换，最小 `5分钟`。  
4. 未知观点默认排除胜率统计。  
5. 事件时间输入粒度：分钟级。
6. K 线数据策略：触发 API 拉取并本地持久化。
