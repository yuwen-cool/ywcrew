# ywcrew Roadmap（暂缓开发，能力档案持久化于此）

## 延后的后端

### opencode
- 无头：`opencode run [message..]`；**原生 ACP**：`opencode acp`；常驻 HTTP：`opencode serve`
- 会话：`opencode session` 子命令、`opencode export [sessionID]`
- 模型发现：`opencode models [provider]`
- 接入建议：优先走 ACP 驱动（session/new → session/prompt → session/update 流），这是五后端之外唯一的原生 ACP 后端，可作为 ACP 驱动层的首个实现

### droid (Factory)
- 无头：`droid exec [prompt]`，支持 stdin（`droid exec - < prompt.txt`）
- 会话：`droid -r [sessionId]`（resume 最近或指定）
- 注意：exec 的输出格式与权限参数需实测 `droid exec --help`

### cursor-agent
- 无头：`cursor-agent -p --output-format stream-json [--stream-partial-output]`
- 只读：`--mode plan|ask`；会话：`--resume [chatId]`
- 模型：`--model` 支持括号参数（`claude-opus-4-8[context=1m,effort=high]`）、`--list-models` 动态发现
- 注意：走用户 Cursor 订阅，与宿主是 Cursor 时会话可能同池，需测试隔离性

## 延后的通道

### oracle 式浏览器通道
- 场景：ChatGPT Pro 网页版专属能力（GPT-5.x Pro 长思考、Deep Research）API/CLI 拿不到
- 方案：直接集成 steipete/oracle（`oracle --engine browser`），作为特殊 backend 接入 adapter 层

### Claude adapter 切换到 agent-sdk
- 当前用 `claude -p` CLI 驱动（统一 worker 模型）
- 需要 canUseTool 细粒度权限回调 / streamInput 常驻会话时，切 @anthropic-ai/claude-agent-sdk
- 注意：绝不使用 --bare（禁用订阅 OAuth）

### ACP Registry 接入
- 目标：新 agent CLI 零适配接入（凡注册了 ACP 的工具自动可用）
- 依赖：先实现通用 ACP 驱动（opencode 是首个试点）

### panel 盲评立场指派（zen-mcp consensus 移植）
- (model, stance) 组合：for/against/neutral + 立场护栏 prompt
- 盲评：成员看不到彼此回答（当前已是），综合模板强化

## 已知技术债

- kimi/agy 的 stream-json 事件 schema 是按通用模式解析的，版本升级可能需要跟进
- agy 未登录态检测较弱（依赖 models 输出是否为空）
- grok `--json-schema` 与流式互斥，当前选结构化终稿；如需过程事件再评估双通道
