---
name: ywcrew
description: >-
  把任务派给用户本地订阅的其他 AI agent（Claude Code / Codex / Grok / Kimi /
  Antigravity），支持单发、并行多发、多模型评审（panel）、跨轮追问。Use when
  用户点名某家模型（"让 GPT 看看"、"问问 Kimi"、"用 Grok 跑一下"）、要第二意见、
  要多模型交叉评审、或你自己卡住需要外部视角时。所有调用走用户已付费的订阅，
  detached 后台执行，不污染当前对话上下文。返回是建议性的，必须自行验证。
---

# ywcrew：调用本地订阅的其他 AI agents

## 何时使用

- 用户点名模型/厂商："让 GPT/Claude/Kimi/Grok/Gemini 看看"
- 需要第二意见：方案评审、疑难 bug、架构决策
- 多模型交叉评审："开个评审会" → panel
- 你自己多次尝试未解决，需要不同模型的视角

**信任等级**：返回的是建议，必须对照代码库和测试自行验证后再采纳。

## 核心纪律（决定效果好坏）

1. **零知识假设**：被调模型对项目一无所知、看不到本对话。任务描述必须自包含。
2. **最小充分文件集**：files glob 只选真正需要的文件，禁止 `**/*` 全量倾倒。
3. **原始报错全文**：objective 里贴 verbatim 错误文本，不要转述。
4. **投入分级**：简单问题派 1 个后端；方案对比才开 panel；不要动辄全员出动。
5. **长任务**：派活立即返回 runId，你该干嘛干嘛，之后再取结果。超时先 followup 续接，**绝不重复派活**。
6. **回收纪律**：只把 result 的 summary/evidence 带回对话；绝不读取 events.ndjson 灌进上下文。

## 用法

### 派单个任务

写任务 JSON（五段式，`ywcrew template` 可看模板），然后：

```bash
echo '{
  "backend": "kimi",
  "mode": "read-only",
  "task": {
    "briefing": "TypeScript CLI 项目，pnpm build 构建，vitest 测试。",
    "locations": "核心逻辑在 src/core/，入口 src/cli.ts",
    "objective": "评审 src/core/lock.ts 的并发正确性。已知问题：……。报错原文：……",
    "constraints": "只评审不改代码"
  },
  "files": ["src/core/lock.ts", "src/core/store.ts"]
}' | ywcrew run --stdin
```

返回 `{"runId": "...", "threadId": "..."}`。字段：

- `backend`: claude | codex | grok | kimi | agy | auto
- `model` / `effort`: 覆盖用户配置的默认值（用户点名了就传；`ywcrew backends` 查可用清单）
- `mode`: read-only（评审/调研，默认）| edit（要改代码，自动 git worktree 隔离，返回 patch）
- `files`: glob 白名单，`!` 排除

### 并行多发 / 多模型评审

```bash
echo '{"task": {...}, "files": [...]}' | ywcrew panel --stdin                    # 用户配置的默认成员
echo '{"task": {...}}' | ywcrew panel --stdin --members claude,codex:gpt-5.6-sol # 指定成员
```

每个成员一个 runId，并行执行。收齐后你负责综合：列共识点、分歧点及原因、最终建议。

### 取结果 / 追问

```bash
ywcrew status <runId>          # queued | running | done | failed
ywcrew result <runId>          # 结构化结论 {status, summary, evidence, confidence, session_ref}
ywcrew followup <threadId> "针对你说的第 2 点，如果采用 X 会怎样？"   # 同后端原生续聊
ywcrew followup <threadId> "评价上面这个结论" --backend grok          # 换个模型接着聊
```

派活后立即继续你手头的工作，隔一会儿再 `result`；长任务用后台 sleep 提醒自己回来取。

### 状态异常处置

- `auth_required`：result 里有确切修复命令（如 `grok login`），转告用户，不要重试
- `timeout`：result 里若有 session_ref，用 followup 续接，不要重新派
- 模型不认识：`ywcrew backends` 查清单；warning 说透传了就等结果

## 首次使用 / 排障

```bash
ywcrew doctor    # 后端安装/登录/宿主装载体检
ywcrew init      # 重新配置默认模型与 panel 成员
```
