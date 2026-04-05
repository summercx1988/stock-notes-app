# 飞书卡片交互排障经验

## 背景

本项目的飞书远程录入链路分为四步：

1. 用户向飞书机器人发送文本消息。
2. Electron 主进程接收 `im.message.receive_v1`，调用本地 AI 解析服务。
3. 主进程向飞书发送确认卡片或编辑卡片。
4. 用户点击卡片按钮后，飞书通过 `card.action.trigger` 回调到本地服务端，再执行笔记落库。

本次问题集中发生在第 4 步的编辑保存阶段。

## 本次问题现象

- 点击“确认保存”正常。
- 点击“取消”正常。
- 点击“修改”后，卡片可以展示，但点击表单保存时报错 `200530`。
- 有时误以为修复未生效，实际原因是本地旧 Electron 主进程未退出，飞书仍连接到旧进程。

## 根因总结

### 1. 编辑卡片没有按 JSON 2.0 的表单容器规范构建

根据飞书官方文档：

- JSON 2.0 中，表单提交必须使用 `form` 容器。
- 表单容器内的所有交互组件都必须有非空且唯一的 `name`。
- 表单提交按钮必须配置 `form_action_type: "submit"`。
- 自定义回传参数应放在 `behaviors: [{ type: "callback", value: {...} }]` 中。

之前的编辑卡片虽然使用了 `schema: "2.0"`，但并没有构造成标准表单，因此保存时被飞书侧拦截。

### 2. `200530` 的直接含义

飞书错误码 `200530` 的含义是：

- 表单容器中的交互组件 `name` 为空。
- 或者同一张卡片内 `name` 重复。

这类错误发生在飞书前端或平台校验层，服务端业务代码通常还没执行到。

### 3. 旧进程导致“修复代码未生效”的假象

飞书机器人使用 WebSocket 长连接模式。

如果旧 Electron 主进程没有退出：

- 旧进程会继续维持连接并处理回调。
- 新代码虽然已经在工作区，但飞书收到的仍然是旧进程发出的旧卡片。
- 因此容易误判为“修复无效”。

## 当前稳定方案

### 编辑卡片

当前编辑卡片已改为符合 JSON 2.0 规范的结构：

- 根节点声明 `schema: "2.0"`。
- 编辑区放在 `form` 容器中。
- 以下组件均带唯一 `name`：
  - 股票输入框
  - 笔记类型下拉框
  - 笔记正文输入框
  - 观点下拉框
  - 操作标签下拉框
  - 事件时间选择器
  - 提交按钮
- 保存按钮使用 `form_action_type: "submit"`。
- 提交动作的业务元数据放在 `behaviors.callback.value` 中。

### 确认卡片与候选股票卡片

当前确认卡片与候选股票卡片也已迁移到 JSON 2.0：

- 使用 `schema: "2.0"` 和 `body.elements`
- 不再使用历史 `action` 容器
- 按钮点击统一走 `behaviors.callback.value`
- 候选股票按钮与确认按钮的回调格式已和编辑卡片统一

### 后端回调解析

主进程对编辑保存回调做了以下适配：

- 从 `action.form_value` 中读取用户真实编辑后的表单内容。
- 支持按前缀解析动态生成的表单项 `name`。
- 支持解析飞书 `picker_datetime` 返回的带时区时间格式，例如：
  - `2026-03-26 21:30 +0800`
- 保存时优先落用户编辑后的正文，而不是旧 session 里的原始文本。

## 当前卡片类型状态

### 已迁移到 JSON 2.0

- 确认卡片 `buildConfirmCard`
- 编辑卡片 `buildEditCard`
- 补充股票卡片 `buildAskStockCard`
- 保存成功卡片 `buildSuccessCard`
- 保存失败卡片 `buildErrorCard`

当前主链路卡片已完成 JSON 2.0 统一。

## 推荐排障步骤

当飞书卡片交互异常时，按以下顺序排查：

1. 确认 Electron 旧进程已经完全退出。
2. 使用 `npm run electron:dev` 启动，观察主进程终端日志。
3. 确认飞书开放平台中已订阅：
   - `im.message.receive_v1`
   - `card.action.trigger`
4. 触发“修改”动作，检查主进程日志中是否打印：
   - `Edit card form names`
   - `Interactive card sent`
5. 若报 `200530`，优先检查：
   - 是否所有表单交互组件都带 `name`
   - `name` 是否为空
   - `name` 是否重复
   - 提交按钮是否带 `form_action_type: "submit"`
6. 若卡片展示正确但笔记未落库，检查：
   - `action.form_value`
   - `messageId`
   - `chatId`
   - 股票匹配结果
   - 时间解析结果

## 本次清理的冗余代码

本轮排障后，已经清理：

- `confirm -> save_edit` 的旧兼容回退逻辑
- `SessionManager` 中未被调用的冗余方法：
  - `updateSession`
  - `clearSession`
  - `cleanup`

这样可以减少“新表单链路”和“旧兜底链路”同时存在造成的认知负担。

## 飞书场景的性能优化结论

在飞书远程录入场景下，用户发送的是短文本，不需要复用本地录音那条“重解析”管线。

因此当前已新增飞书专用极速解析链路：

- 飞书消息优先走本地规则：
  - 股票代码识别
  - 自选股精确匹配
  - 股票名精确/模糊匹配
  - 观点关键词识别
  - 操作标签关键词识别
- 当规则已形成候选股票时：
  - 不再调用 LLM
  - 直接进入确认卡片或候选股票卡片
- 仅当规则完全无法形成候选股票时：
  - 才触发 1 次轻量 LLM 兜底

这意味着飞书远程录入链路现在通常是：

- 高置信消息：0 次 LLM
- 模糊消息：0 次 LLM + 候选股票卡片
- 极少数难例：1 次 LLM

这样做的目标不是追求“最完整解析”，而是优先保证远程录入的响应速度。

## 与本地录音链路的复用经验

飞书场景验证稳定后，同样的极速解析策略已试点复用到本地录音保存链路：

- 本地录音转写完成后，优先调用 `ai:extractFast`
- 先走本地规则、自选股与股票库
- 仅在必要时走 1 次轻量 LLM

这说明“规则优先、LLM 兜底”的思路不只适用于飞书，也适用于高频本地速记场景。

## 实践建议

1. 飞书卡片如果采用 JSON 2.0，就尽量整张卡片都按 JSON 2.0 规则构建，不要混合旧式交互心智。
2. 表单卡片必须先按官方文档校验结构，再看业务逻辑。
3. 长连接机器人调试时，先排除“旧进程仍在处理消息”这个因素。
4. 所有卡片交互问题都建议先区分：
   - 飞书平台校验失败
   - 服务端回调解析失败
   - 笔记保存失败

## 参考文档

- [按钮组件（JSON 2.0）](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/button)
- [表单容器](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container)
- [配置卡片交互](https://open.feishu.cn/document/feishu-cards/configuring-card-interactions)
- [输入框](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/input)
- [下拉选择-单选](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/single-select-dropdown-menu)
- [日期时间选择器](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/date-time-picker)
