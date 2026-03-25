# 盯盘笔记系统 - 使用与开发说明 v3.3

**版本：** v3.3  
**更新日期：** 2026-03-24  
**适用范围：** 当前主仓库 `stock-notes-app`

---

## 一、当前实现概览

当前版本聚焦于一条稳定、轻量、可扩展的链路：

```text
录音 / 上传音频
  -> 本地 whisper.cpp 转写
  -> 文本纠错 + 股票名称匹配（优先自选股）
  -> 保存到单股票 Markdown 文件
```

说明：

- 录音能力由子模块 `voice-transcriber-service` 提供
- 转写优先本地 `whisper.cpp`
- AI 负责纠错与股票定位，不写入“思考内容”
- 每只股票只有一个主笔记文件（文件即数据库）

---

## 二、环境要求

- macOS 13+
- Node.js 18+ 与 npm
- Swift 5.9+
- 可执行的 `whisper.cpp/main`
- 模型 `ggml-medium.bin`

---

## 三、开发环境启动

### 3.1 Electron 应用

```bash
cd stock-notes-app
npm install
npm run electron:dev
```

### 3.2 Swift 语音服务

```bash
git submodule update --init --recursive
cd voice-transcriber-service
./scripts/setup-whisper.sh
swift build
cp .build/debug/voice-transcriber-service ./voice-transcriber-service
```

默认开发路径：

```text
voice-transcriber-service/voice-transcriber-service
```

### 3.3 CLI（复盘与回归）

```bash
# 复盘评估（示例）
npm run cli:review -- --mode evaluate --scope overall --start 2026-03-01T00:00:00+08:00 --end 2026-03-24T23:59:59+08:00 --interval 5m

# 回归测试（默认离线）
npm run cli:regression
```

---

## 四、UI 与交互入口

### 4.1 顶部核心入口

- `录音`：看盘时快速录入（高频功能）

### 4.2 顶部 `工具` 下拉入口

- `偏好设置`
- `自选股设置`
- `笔记导入导出`
  - 导出当前股票
  - 导出全部笔记
  - 导入笔记（跳过重复）
  - 导入笔记（覆盖重复）

这样做的目标是只暴露高频按钮，低频配置收敛到多层级菜单，减少主界面负担。

---

## 五、数据落盘与命名规范

### 5.1 文件命名

统一为：

```text
股票名称(股票代码).md
```

示例：

```text
中远海能(600026).md
```

### 5.2 数据目录

```text
data/
├── stocks/
│   ├── 中远海能(600026).md
│   ├── 贵州茅台(600519).md
│   └── ...
├── audio/
│   ├── temp/
│   └── 600026/
└── stocks-database.json
```

### 5.3 兼容策略

- 历史命名（如 `600026.md`）仍可读取
- 当文件被更新写回时，会自动迁移到新命名格式

---

## 六、导入导出说明（GUI）

### 6.1 导出结构

导出目录内会生成：

```text
stock-notes-export-.../
├── manifest.json
├── stocks/
└── audio/
```

`manifest.json` 包含导出范围、股票列表、命名规范版本等元信息。

### 6.2 导入模式

- `跳过重复`：目标中已有同股票代码则跳过
- `覆盖重复`：目标中已有同股票代码则覆盖

导入时支持两种来源目录：

- 直接选择包含 `stocks/` 的导出包根目录
- 直接选择仅含 `.md` 的股票目录

---

## 七、常见问题

### Q1：录音弹窗无法开始录音

优先检查：

- Swift 服务是否编译完成
- 麦克风权限是否授予
- `8765` 端口是否被占用

### Q2：可以录音但无转写结果

优先检查：

- `whisper.cpp/main` 是否可执行
- `ggml-medium.bin` 是否存在
- 音频是否含有效语音

### Q3：股票识别命中率不稳定

当前策略：

- 先本地候选匹配
- 再结合纠错与候选修正
- 自选股列表会作为优先匹配上下文

---

## 八、文档地图

- `docs/PRD.md`：产品需求（6 个核心诉求 + 类别与复盘口径）
- `docs/TECHNICAL_SPEC.md`：技术架构与数据流程（当前实现）
- `docs/MODULAR_ARCHITECTURE.md`：模块化解耦与复用路线
- `docs/UI_UX_TECH_PLAN.md`：UI/UX 与技术实施计划
- `docs/ROADMAP_STOCK_ANALYSIS.md`：后续股票分析路线图
