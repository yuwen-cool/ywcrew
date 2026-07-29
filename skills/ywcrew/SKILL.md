---
name: ywcrew
description: >-
  把任务派给用户本地订阅的其他 AI agent（Claude Code / Codex / Grok / Kimi /
  Antigravity），支持单发、并行多发、多模型评审（panel）、跨轮追问。Use when
  用户点名某家模型（"让 GPT 看看"、"问问 Kimi"、"用 Grok 跑一下"）、要第二意见或
  多模型交叉评审、量大但不难的批量粗活想派快模型、同一任务要多个版本对比择优、
  需要读大量文件的调研怕吃掉当前对话上下文、当前模型额度吃紧想换一家、
  或你自己卡住需要外部视角时。所有调用走用户已付费的订阅，detached 后台执行，
  不污染当前对话上下文。返回是建议性的，必须自行验证。
---

# ywcrew：调用本地订阅的其他 AI agents

## 前置：确认 ywcrew 可用（自举安装）

先运行 `ywcrew --version`。如果命令不存在，替用户安装并初始化（需要 Node ≥ 20）：

```bash
npm install -g https://github.com/yuwen-cool/ywcrew/archive/refs/heads/main.tar.gz && ywcrew init --yes
```

`init --yes` 会探测本机已装的 agent CLI（claude/codex/grok/kimi/agy），自动启用已登录的后端并分发技能，不需要任何人工输入。装完跑 `ywcrew doctor` 向用户汇报哪些后端可用、哪些需要登录。

## 何时使用（六种派单动机）

- **用户点名**："让 GPT/Claude/Kimi/Grok/Gemini 看看" —— 无条件执行
- **图快**：量大但不难的粗活（全仓扫描 TODO/硬编码、批量翻译、补注释/补测试、生成 changelog）→ 派给快后端 + 低强度，比在本对话里干快得多，也不占你的上下文
- **图专长**：疑难 bug、架构权衡、中文长文各有最擅长的后端 → 按下方路由表派
- **图多样性**：同一任务要多个版本对比择优（文案、接口设计、实现方案）→ 并行多发，收齐后对比综合
- **图独立性**：方案评审/重大决策/你多次尝试未解决 → 你已被自己的思路锚定，派没看过本对话的模型盲评（panel）
- **图上下文卫生**：需要读几十个文件的调研会吃掉本对话的上下文窗口 → 派出去，子代理烧自己的上下文，只收回约 2k token 的摘要
- **图额度**：当前后端限额将尽/报了限流 → 换一家订阅继续干，主动向用户建议

符合以上动机时**主动向用户建议派单**（一句话说明派给谁、为什么），不必等用户点名。

**信任等级**：返回的是建议，必须对照代码库和测试自行验证后再采纳。

<!-- YWCREW:DYNAMIC -->

## 场景手册

- **第二意见**：单发 1 个与你不同家的模型，effort 从低开始
- **批量粗活外包**：全仓扫描/批量翻译/补文档这类量大不难的任务，单发快后端（effort low），你继续主线工作，最后统一收取
- **大调研外包（保上下文）**：要读大量文件的调研不要在本对话里做——五段式写清问题，files 圈定范围派出去，只把摘要带回来
- **多版本择优**：同一任务并行派 2-3 家（各自独立 run，不是 panel），收齐后逐版对比，向用户呈现差异和你的推荐
- **评审会 / 方案对比**：`panel`（默认成员）；收齐后你必须综合：共识点、分歧点+原因、你的最终裁决
- **多模型接力**（A 的产出给 B 挑刺）：先 run，拿 threadId 后 `followup <threadId> "评价上述结论" --backend 另一家`
- **改代码竞赛**：对同一任务分别派 2 家 `mode: "edit"`，各自在隔离 worktree 出 patch，你对比后择优（把 patch 路径给用户）
- **用户想亲自深聊**：result 里的 `takeover_command` 是一条可直接复制执行的接管命令，把它给用户即可

## 用户自定义路由（优先遵守）

上方动态区的路由表以用户配置为准——用户通过 `ywcrew route add "<场景描述>" "<backend[:model][:effort]>"` 声明过的偏好，**永远优先于你自己的判断**。用户表达出稳定偏好时（如"以后中文文案都找 Kimi"），主动提示可以用 `ywcrew route add` 固化，之后在所有宿主里都生效。

## 异步节奏（像 Cursor 一样不阻塞主线）

**先派单，后干活，最后收取——这是本工具的核心用法。** 派发只需一两秒即返回 runId，worker 与你完全脱钩地在后台跑。

1. 一轮对话里有可外包的任务时，**开头就派出去**，然后做你手头的其他工作
2. 到了需要结果的时刻才 `ywcrew result <runId...> --wait --timeout 300`（可一次传多个 runId，全部完成才返回）
3. 除非用户明确要求等待，**绝不派完立即 --wait 干等**——那是把异步用成了同步
4. 特别长的任务：用后台 sleep 提醒自己回来收，期间正常做别的

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
- `model` / `effort`: 覆盖用户配置的默认值（用户点名了就传；`ywcrew backends` 查可用清单）。不指定就**整个省略字段**，不要填占位文本。不支持 effort 的后端会忽略该参数并在 result 的 warnings 里说明
- `mode`: read-only（评审/调研，默认）| edit（要改代码，自动 git worktree 隔离，返回 patch）
- `strict`: true 时开启严格读取隔离——被调模型在只含 files 白名单文件的影子目录中执行，读不到项目其他文件。**敏感仓库/含凭据的项目一律加 strict**（仅 read-only 有效）
- `files`: glob 白名单，`!` 排除；strict 模式下这就是被调模型的全部视野，要圈全

### 并行多发 / 多模型评审

```bash
echo '{"task": {...}, "files": [...]}' | ywcrew panel --stdin                    # 用户配置的默认成员
echo '{"task": {...}}' | ywcrew panel --stdin --members claude,codex:gpt-5.6-sol # 指定成员
```

每个成员一个 runId，并行执行。**panel 永远只读**（要改代码竞赛就分别 run 多个 mode:edit）。收齐后你负责综合：列共识点、分歧点及原因、最终建议。

### 取结果 / 追问

```bash
ywcrew status <runId>                          # queued | running | done | failed
ywcrew result <runId>                          # 立即返回（未完成给 pending）
ywcrew result <id1> <id2> --wait --timeout 300 # 阻塞到全部完成，panel 收结果用这个
ywcrew followup <threadId> "针对你说的第 2 点，如果采用 X 会怎样？"   # 同后端原生续聊
ywcrew followup <threadId> "评价上面这个结论" --backend grok          # 换个模型接着聊
```

followup 的追问写完整问题（短于 20 字会被自动补一句"续接上文"以通过校验）。

### 结果可信度

- result 里每条 evidence 带 `verified` 标记（worker 自动核验文件存在与行号范围）；`verified: false` 的证据引用前先自行复核
- 文案/调研类开放任务，采纳前对照原始材料核对事实；被调模型的返回永远是建议

### 状态异常处置

- `auth_required`：result 里有确切修复命令（如 `grok login`），转告用户，不要重试
- `timeout`：result 里若有 session_ref，用 followup 续接，不要重新派
- 模型不认识：`ywcrew backends` 查清单；warning 说透传了就等结果

## 首次使用 / 排障

```bash
ywcrew doctor    # 后端安装/登录/宿主装载体检
ywcrew init      # 重新配置默认模型与 panel 成员
```
