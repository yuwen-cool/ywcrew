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

## 调用目标怎么选（路由表）

| 任务类型 | 首选 | 理由 |
| --- | --- | --- |
| 疑难 bug 定位、需要精确读代码 | codex（effort=high） | 沙箱原生只读，token 用量透明 |
| 架构评审、方案权衡、长推理 | claude | 推理深度与批判性最稳 |
| 中文语料、长文理解、文案 | kimi | 中文原生，长上下文 |
| 快速第二意见、轻量核查 | grok（effort=low） | 快、成本低 |
| 想要 Claude/GPT 但额度紧张 | agy（claude-sonnet-4-6） | 走 Google 订阅的 Claude 通道 |

用户点名了模型/厂商就服从用户；没点名时按表路由。`ywcrew backends` 可查实际可用清单。

## 场景手册

- **第二意见**：单发 1 个与你不同家的模型，effort 从低开始
- **评审会 / 方案对比**：`panel`（默认成员）；收齐后你必须综合：共识点、分歧点+原因、你的最终裁决
- **多模型接力**（A 的产出给 B 挑刺）：先 run，拿 threadId 后 `followup <threadId> "评价上述结论" --backend 另一家`
- **改代码竞赛**：对同一任务分别派 2 家 `mode: "edit"`，各自在隔离 worktree 出 patch，你对比后择优（把 patch 路径给用户）
- **用户想亲自深聊**：result 里的 `takeover_command` 是一条可直接复制执行的接管命令，把它给用户即可

## 异步节奏（像 Cursor 一样不阻塞主线）

1. 派发后立即返回 runId —— **继续你手头的工作**，不要干等
2. 到了需要结果的时刻：`ywcrew result <runId...> --wait --timeout 300`（可一次传 panel 的所有 runId，全部完成才返回）
3. 特别长的任务：用后台 sleep 提醒自己回来收，期间正常做别的

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
ywcrew status <runId>                          # queued | running | done | failed
ywcrew result <runId>                          # 立即返回（未完成给 pending）
ywcrew result <id1> <id2> --wait --timeout 300 # 阻塞到全部完成，panel 收结果用这个
ywcrew followup <threadId> "针对你说的第 2 点，如果采用 X 会怎样？"   # 同后端原生续聊
ywcrew followup <threadId> "评价上面这个结论" --backend grok          # 换个模型接着聊
```

### 状态异常处置

- `auth_required`：result 里有确切修复命令（如 `grok login`），转告用户，不要重试
- `timeout`：result 里若有 session_ref，用 followup 续接，不要重新派
- 模型不认识：`ywcrew backends` 查清单；warning 说透传了就等结果

## 首次使用 / 排障

```bash
ywcrew doctor    # 后端安装/登录/宿主装载体检
ywcrew init      # 重新配置默认模型与 panel 成员
```
