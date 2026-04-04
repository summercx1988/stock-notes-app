# 股票操盘训练与风格建模系统 - 路线图

**版本：** v0.1  
**状态：** 规划草案  
**日期：** 2026-03-27

## 一、目标

用 4 个阶段把 `trading-trainer` 从文档推进到可用系统：

1. 先做可训练闭环
2. 再做可复盘闭环
3. 再做可建模闭环
4. 最后做可迭代优化闭环

## 二、阶段划分

### Phase 0：文档与规则冻结

目标：

- 冻结标签语义
- 冻结 v1 匿名化规则
- 冻结数据版本和模型版本命名规则

产出：

- PRD
- TECH_SELECTION
- ARCHITECTURE
- DATA_MODEL
- 全部模块 spec

### Phase 1：Blind Replay Trainer MVP

目标：

- 做出匿名训练工作台最小闭环

范围：

1. 样本池
2. 匿名化
3. bar-by-bar 会话引擎
4. 会话动作持久化
5. 会话评分
6. 基础复盘页

验收：

- 能随机抽样并开始训练
- 能逐根推进并记录动作
- 能输出收益和基础复盘

### Phase 2：Style Labeling MVP

目标：

- 做出风格打标和审核最小闭环

范围：

1. 手工打标工作台
2. 标签状态流转
3. 数据集版本草稿生成
4. 标签列表和筛选

验收：

- 能稳定打标买点/卖点/无操作
- 能审核候选标签
- 能生成冻结版训练数据集

### Phase 3：Modeling MVP

目标：

- 做出第一个可回溯的模型训练闭环

范围：

1. 特征流水线
2. 数据集切分
3. LightGBM 基线训练
4. 离线评估
5. 模型注册

验收：

- 能从某个数据集版本训练出模型
- 能输出分类指标和时间切分回测结果
- 能浏览不同模型版本

### Phase 4：闭环增强

目标：

- 让训练系统和建模系统互相增强

范围：

1. 自动扩样
2. 主动学习抽检
3. 影子策略对照
4. 风格画像
5. 样本难度自适应

验收：

- 自动扩样进入候选池
- 抽检结果可回流
- 模型可参与风格对照和扩样辅助

## 三、推荐实施顺序

### 第一批

1. `style-label-workbench`
2. `dataset-versioning`
3. `sample-pool`
4. `anonymizer`
5. `replay-session-engine`
6. `session-review-scoring`

原因：

- 先把标签和数据版本定稳
- 再把训练会话主链路做通

### 第二批

1. `desktop-shell-and-ipc`
2. `shadow-strategy-compare`
3. `candidate-expansion-review`
4. `feature-pipeline`

### 第三批

1. `model-training-evaluation`
2. `model-registry-inference`

## 四、里程碑定义

### M1：能训练

- 进入匿名训练
- 逐 bar 操作
- 会话评分

### M2：能打标

- 历史手工打标签
- 标签审核
- 数据集冻结

### M3：能训练模型

- 训练基线模型
- 记录模型版本
- 输出评估报告

### M4：能形成闭环

- 自动扩样
- 抽检回流
- 模型辅助训练和复盘

## 五、当前建议

1. 先做标签和数据版本，不要先急着追复杂模型。
2. Blind Replay Trainer 和 Style Modeling Pipeline 应并行设计，分阶段开发。
3. 模块落地时，以 spec 文档为唯一范围依据，避免边做边飘。
