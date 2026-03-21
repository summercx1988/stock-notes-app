# 测试建议与验证方案

## 一、测试环境准备

### 1.1 基础环境

```bash
# 1. 确认Node.js版本
node -v  # 需要 v20+

# 2. 安装项目依赖
cd stock-notes-app
npm install

# 3. 创建必要的目录
mkdir -p data/stocks data/audio data/temp
```

### 1.2 AI环境配置

#### 方案A：云端AI（推荐，免费）

```bash
# 1. 注册GLM（免费）
# 访问 https://open.bigmodel.cn/
# 注册后获取API Key

# 2. 配置环境变量
export GLM_API_KEY="ed29a6fd211844c592b747e24590dccf.2gJcNRxa4ELcb9F9"

# 或者在应用设置中配置

# 3. 验证API（可选）
curl https://open.bigmodel.cn/api/paas/v4/chat/completions \
  -H "Authorization: Bearer $GLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "glm-4-flash", "messages": [{"role": "user", "content": "你好"}]}'
```

#### 方案B：本地AI（可选）

```bash
# 1. 注册GLM（免费）
# 访问 https://open.bigmodel.cn/
# 注册后获取API Key

# 2. 配置环境变量
export GLM_API_KEY="ed29a6fd211844c592b747e24590dccf.2gJcNRxa4ELcb9F9"

# 或者在应用设置中配置

# 3. 验证API（可选）
curl https://open.bigmodel.cn/api/paas/v4/chat/completions \
  -H "Authorization: Bearer $GLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "glm-4-flash", "messages": [{"role": "user", "content": "你好"}]}'
```

### 1.3 语音识别环境

```bash
# 1. 安装FFmpeg（音频处理）
brew install ffmpeg

# 2. 验证安装
ffmpeg -version

# 3. 下载whisper.cpp（可选，本地ASR）
# 访问 https://github.com/ggerganov/whisper.cpp/releases
# 下载macOS版本，放入 resources/bin/
```

***

## 二、分阶段测试计划

### 阶段一：基础功能验证（30分钟）

#### 测试1：应用启动

```bash
# 启动开发服务器
npm run electron:dev
```

**验证点：**

- [ ] 应用窗口正常打开
- [ ] 界面布局正确显示
- [ ] 无控制台错误

#### 测试2：笔记创建

**步骤：**

1. 在股票代码输入框输入：`600519`
2. 在编辑器中输入测试内容
3. 点击"保存"按钮

**验证点：**

- [ ] 笔记保存成功提示
- [ ] 文件 `data/stocks/600519.md` 被创建
- [ ] SQLite数据库有记录

**检查命令：**

```bash
# 查看笔记文件
cat data/stocks/600519.md

# 查看数据库
sqlite3 data/index.db "SELECT * FROM stocks;"
sqlite3 data/index.db "SELECT * FROM time_entries;"
```

#### 测试3：时间轴展示

**步骤：**

1. 创建多条笔记（不同时间）
2. 查看右侧时间轴

**验证点：**

- [ ] 时间轴正确显示所有笔记
- [ ] 点击时间轴项目可跳转
- [ ] 按日期分组正确

***

### 阶段二：AI功能测试（30分钟）

#### 测试4：本地AI文本优化

**前置条件：** Ollama已安装并运行

**步骤：**

1. 在编辑器输入：
   ```
   那个今天开盘后茅台涨得挺多的嗯成交量也放大了我觉得可以买入
   ```
2. 点击"优化"按钮

**验证点：**

- [ ] 文本被优化，去除口语化表达
- [ ] 标点符号正确
- [ ] 处理时间 < 5秒

**预期输出：**

```
今日开盘后，贵州茅台涨幅较大，成交量明显放大，建议买入。
```

#### 测试5：云端AI文本优化

**前置条件：** 已配置GLM API Key

**步骤：**

1. 切换到"云端模式"
2. 重复测试4的步骤

**验证点：**

- [ ] 云端API调用成功
- [ ] 返回优化结果
- [ ] Token使用量显示正确

#### 测试6：观点提取

**步骤：**

1. 输入一段投资分析文本
2. 点击"提取观点"按钮

**验证点：**

- [ ] 返回JSON格式观点
- [ ] 方向判断合理
- [ ] 信心指数在0-1之间

***

### 阶段三：语音功能测试（需要麦克风）

#### 测试7：录音功能

**步骤：**

1. 点击"录音"按钮
2. 对着麦克风说话（中文）
3. 点击"停止"按钮

**验证点：**

- [ ] 录音指示正确
- [ ] 音频文件生成
- [ ] 文件格式正确

**检查命令：**

```bash
# 查看录音文件
ls -la data/audio/temp/
```

#### 测试8：语音转文字

**前置条件：** whisper.cpp已安装

**步骤：**

1. 录制一段语音
2. 等待转写完成

**验证点：**

- [ ] 转写结果正确
- [ ] 中文识别准确率 > 90%
- [ ] 处理时间合理

***

### 阶段四：数据持久化测试

#### 测试9：数据完整性

**步骤：**

1. 创建多个股票的笔记
2. 重启应用
3. 检查数据是否保留

**验证点：**

- [ ] 所有笔记保留
- [ ] 时间轴正确
- [ ] 数据库索引正确

#### 测试10：文件格式验证

**检查Markdown文件格式：**

```bash
# 查看生成的笔记文件
cat data/stocks/600519.md
```

**验证点：**

- [ ] YAML头部格式正确
- [ ] Markdown正文格式正确
- [ ] 时间戳精确到分钟

***

## 三、性能测试

### 3.1 响应时间测试

| 操作     | 目标时间    | 测试结果   |
| ------ | ------- | ------ |
| 应用启动   | < 3秒    | <br /> |
| 笔记保存   | < 500ms | <br /> |
| 本地AI优化 | < 3秒    | <br /> |
| 云端AI优化 | < 2秒    | <br /> |
| 时间轴加载  | < 1秒    | <br /> |

### 3.2 资源占用测试

**监控命令：**

```bash
# 监控CPU和内存
top -pid $(pgrep -f "stock-notes-app")

# 监控磁盘使用
du -sh data/
```

**目标指标：**

- 内存占用（空闲）：< 500MB
- 内存占用（AI运行）：< 6GB
- 磁盘占用（不含模型）：< 100MB

***

## 四、边界情况测试

### 4.1 异常输入

- [ ] 空股票代码
- [ ] 无效股票代码格式
- [ ] 超长文本（> 10000字）
- [ ] 特殊字符输入

### 4.2 网络异常

- [ ] 云端模式下断网
- [ ] API Key错误
- [ ] 请求超时

### 4.3 并发操作

- [ ] 快速连续保存
- [ ] 同时录音和编辑
- [ ] 多次点击优化按钮

***

## 五、测试检查清单

### 5.1 功能完整性

- [ ] 笔记创建
- [ ] 笔记编辑
- [ ] 笔记删除
- [ ] 时间轴查看
- [ ] 时间轴筛选
- [ ] 语音录音
- [ ] 语音转文字
- [ ] AI文本优化
- [ ] AI观点提取
- [ ] 本地模式切换
- [ ] 云端模式切换

### 5.2 数据安全

- [ ] 数据自动保存
- [ ] 异常退出数据不丢失
- [ ] API Key加密存储
- [ ] 敏感数据不泄露

### 5.3 用户体验

- [ ] 界面响应流畅
- [ ] 错误提示清晰
- [ ] 操作逻辑直观
- [ ] 快捷键支持

***

## 六、测试报告模板

```markdown
# 测试报告

测试日期：YYYY-MM-DD
测试人员：
测试环境：
- macOS版本：
- Node.js版本：
- 测试模式：本地/云端

## 测试结果

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 应用启动 | ✅/❌ | |
| 笔记创建 | ✅/❌ | |
| AI优化 | ✅/❌ | |
| 语音转写 | ✅/❌ | |
| 时间轴 | ✅/❌ | |

## 发现的问题

1. 问题描述
   - 重现步骤：
   - 预期结果：
   - 实际结果：
   - 截图：

## 建议

1. 功能建议
2. 性能建议
3. 体验建议
```

***

## 七、快速测试脚本

创建 `test/quick-test.sh`：

```bash
#!/bin/bash

echo "=== 股票投资笔记系统 - 快速测试 ==="

# 检查环境
echo "1. 检查环境..."
node -v
npm -v

# 检查依赖
echo "2. 检查依赖..."
if [ -d "node_modules" ]; then
    echo "✅ 依赖已安装"
else
    echo "❌ 请先运行 npm install"
    exit 1
fi

# 检查Ollama
echo "3. 检查Ollama..."
if pgrep -x "ollama" > /dev/null; then
    echo "✅ Ollama运行中"
else
    echo "⚠️  Ollama未运行，请运行: ollama serve"
fi

# 检查数据目录
echo "4. 检查数据目录..."
mkdir -p data/stocks data/audio data/temp
echo "✅ 数据目录已创建"

# 启动应用
echo "5. 启动应用..."
npm run electron:dev
```

***

## 八、下一步建议

### 优先级排序

1. **P0 - 立即测试**
   - 基础笔记功能
   - 本地AI优化
   - 数据持久化
2. **P1 - 本周完成**
   - 云端AI集成
   - 语音录音
   - 时间轴交互
3. **P2 - 后续优化**
   - 性能优化
   - 边界情况
   - 用户体验

### 测试顺序建议

```
Day 1: 环境搭建 + 基础功能测试
Day 2: AI功能测试（本地+云端）
Day 3: 语音功能测试
Day 4: 综合测试 + 问题修复
Day 5: 性能测试 + 优化
```

