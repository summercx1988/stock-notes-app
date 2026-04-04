# Trading Trainer Future Work

这是一个独立于当前主线“盯盘笔记系统”的未来项目文档区，用来承载：

- 匿名 K 线逐 bar 回放训练
- 用户风格手工打标
- 自动扩样与抽样审核
- 训练数据版本与模型版本管理
- 买卖点预测模型训练与评估

## 文档地图

- `PRD.md`
  业务范围、核心流程、边界和迭代优先级
- `TECH_SELECTION.md`
  技术选型、开源借鉴、系统架构和主要风险
- `REQUIREMENTS_REVIEW.md`
  对当前需求的结构化评审、关键约束和后续 spec 拆分建议
- `ARCHITECTURE.md`
  系统分层、子系统边界、运行时数据流和目录建议
- `DATA_MODEL.md`
  核心实体、状态流转、SQLite 表和文件化产物模型
- `ROADMAP.md`
  分阶段实施计划、里程碑和推荐落地顺序

## 当前项目边界

当前独立项目包含两条并行子系统：

1. `Blind Replay Trainer`
   匿名样本抽样、逐 bar 决策、收益统计、复盘归因、影子策略对照
2. `Style Modeling Pipeline`
   手工风格打标、自动扩样、人工抽检、数据集版本、模型训练与评估

## 后续 spec 拆分建议

确认方案后，建议按以下模块产出 `spec.md`：

1. `sample-pool`
2. `anonymizer`
3. `replay-session-engine`
4. `session-review-scoring`
5. `style-label-workbench`
6. `candidate-expansion-review`
7. `dataset-versioning`
8. `feature-pipeline`
9. `model-training-evaluation`
10. `model-registry-inference`
11. `shadow-strategy-compare`
12. `desktop-shell-and-ipc`

## 当前已写 spec

- `specs/sample-pool.spec.md`
- `specs/anonymizer.spec.md`
- `specs/replay-session-engine.spec.md`
- `specs/session-review-scoring.spec.md`
- `specs/style-label-workbench.spec.md`
- `specs/candidate-expansion-review.spec.md`
- `specs/dataset-versioning.spec.md`
- `specs/feature-pipeline.spec.md`
- `specs/model-training-evaluation.spec.md`
- `specs/model-registry-inference.spec.md`
- `specs/shadow-strategy-compare.spec.md`
- `specs/desktop-shell-and-ipc.spec.md`
