# 文档导航（2026-04-05 整理版）

本目录已完成一次“主文档整合 + 历史归档”清理。  
当前阅读建议：先看主文档，再按需看 PRD/路线图，历史方案请到 `archive`。

## 1. 核心主文档（建议优先）

- [ENGINEERING_GUIDE.md](./ENGINEERING_GUIDE.md)
  - 当前系统架构、数据模型、核心链路、复盘与缓存策略（技术总览）
- [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md)
  - 本地运行、飞书配置、故障排查、日志定位、发布前检查
- [CHANGELOG.md](./CHANGELOG.md)
  - 版本与功能演进记录（唯一变更日志入口）

## 2. 产品与规划文档

- [PRD.md](./PRD.md)
- [ROADMAP_STOCK_ANALYSIS.md](./ROADMAP_STOCK_ANALYSIS.md)

## 3. 回归与验证辅助

- `regression-cases.json`

## 4. 未来规划区

- `future_work/`  
  当前用于孵化“trading-trainer”等未来模块，不作为现网实现依据。

## 5. 历史归档区

- `archive/`  
  旧方案、评审稿、阶段性排障记录统一归档，不再作为“当前实现规范”直接引用。

## 6. 文档维护约定

1. 新功能方案优先落到主文档（`ENGINEERING_GUIDE` / `OPERATIONS_RUNBOOK`）对应章节。
2. 历史内容不删库，统一移动到 `docs/archive/` 并在归档索引注明原因。
3. 任何实现变更必须同步更新 `docs/CHANGELOG.md`。

---

## 九、文档地图

- `docs/PRD.md`：产品需求（6 个核心诉求 + 类别与复盘口径）
- `docs/TECHNICAL_SPEC.md`：技术架构与数据流程（当前实现）
- `docs/MODULAR_ARCHITECTURE.md`：模块化解耦与复用路线
- `docs/UI_UX_TECH_PLAN.md`：UI/UX 与技术实施计划
- `docs/ROADMAP_STOCK_ANALYSIS.md`：后续股票分析路线图
- `docs/future_work/trading-trainer/README.md`：独立 future_work 项目索引（匿名训练 + 风格建模）
- `docs/future_work/trading-trainer/PRD.md`：训练与风格建模系统的业务需求与范围定义
- `docs/future_work/trading-trainer/TECH_SELECTION.md`：训练与建模系统的技术选型与开源调研
- `docs/future_work/trading-trainer/REQUIREMENTS_REVIEW.md`：当前需求的结构化评审与后续 spec 拆分建议
- `docs/FEISHU_CARD_INTERACTION_LESSONS.md`：飞书 JSON 2.0 卡片与极速解析迭代经验
