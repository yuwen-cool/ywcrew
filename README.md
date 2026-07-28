# ywcrew

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-47%20passing-brightgreen)](./test)

**让你的 AI 智能体调用你本地订阅的其他 AI 智能体。**

在任意宿主（Cursor / Claude Code / Codex / Grok / Kimi …）里说一句"让 GPT 看看这个 bug"、"开个多模型评审会"，宿主 agent 就能把任务派给你已付费订阅的其他家模型——并行执行、不打断当前对话、不烧 API key。

```
宿主 agent ──(skill 触发)──> ywcrew CLI ──> detached worker ──> claude / codex / grok / kimi / agy
     ↑                                                                    │
     └──────────── runId → 结构化结论（summary / evidence / patch）←──────┘
```

## 为什么需要它

- 你为多家模型付了订阅费，但平时只能在各自的工具里分开用
- 想要第二意见、多模型交叉评审时，只能手动开终端复制粘贴，或在主对话里切模型——后者会把 KV 缓存打掉重建
- ywcrew 让宿主 agent 用一条 shell 命令把活派出去：被调模型在独立进程里跑，主对话缓存零污染，回来的只有结构化结论

## 安装

**方式一：把仓库名发给你的智能体**（推荐）。对任意 agent 说：

> 帮我安装 github.com/yuwen-cool/ywcrew：`npm install -g https://github.com/yuwen-cool/ywcrew/archive/refs/heads/main.tar.gz && ywcrew init --yes`，装完用 `ywcrew doctor` 告诉我哪些后端可用。

**方式二：自己动手**：

```bash
npm install -g https://github.com/yuwen-cool/ywcrew/archive/refs/heads/main.tar.gz
ywcrew init        # 交互式：探测本地 CLI → 逐个确认模型/思考强度/panel 成员 → 分发技能
```

> 用 tarball URL 而非 `github:` 协议，是因为 npm 11 对 git 全局安装存在悬空软链问题；tarball 安装无需构建（dist 已随仓库提供）、无需任何账号。

升级：重跑同一条安装命令即可（`~/.ywcrew` 下的配置与偏好不受影响，装完 `ywcrew install` 重渲染技能）。

`init --yes` 为非交互模式（自动启用所有已登录后端，绝不覆盖已有偏好）。装好后，在任意宿主里直接说：

- "用 ywcrew 让 kimi 评审这个模块"
- "让 GPT 用最高思考强度查一下这个死锁"
- "开个评审会，让 claude、codex、kimi 各自给方案"
- "让 grok 接着刚才那个结论继续深挖"（跨轮追问，同后端原生 resume 省 token）

## 它长什么样

宿主 agent 派活（由技能文件驱动，你不需要手写）：

```bash
echo '{
  "backend": "codex", "effort": "high", "mode": "read-only",
  "task": {
    "briefing": "TypeScript CLI 项目，pnpm build 构建，vitest 测试。",
    "objective": "评审 src/core/lock.ts 的并发正确性。已知偶发双持锁，报错原文：……",
    "output_contract": "按严重级别排序的问题列表，每条带文件:行号"
  },
  "files": ["src/core/lock.ts", "src/core/store.ts"]
}' | ywcrew run --stdin
# → {"runId":"2026-07-28-ab12cd34","threadId":"…"}

ywcrew result 2026-07-28-ab12cd34 --wait
```

回来的是结构化结论（真实运行输出节选）：

```json
{
  "status": "ok",
  "summary": "发现 1 个 P0：PID 复用后 kill 会误杀无关进程组……",
  "evidence": [{ "file": "src/core/lock.ts", "lines": "46-58", "claim": "…" }],
  "confidence": "high",
  "usage": { "inputTokens": 525103, "outputTokens": 14624, "durationMs": 338466 },
  "takeover_command": "cd \"/path/to/proj\" && codex resume 019fa79b-…"
}
```

`takeover_command` 可以直接复制执行，亲自接管子 agent 的会话继续深聊。

## 核心命令

| 命令 | 作用 |
| --- | --- |
| `ywcrew run --stdin` | 派单个任务（任务 JSON，`ywcrew template` 看模板） |
| `ywcrew panel --stdin` | 同一任务并行发给多个模型（多模型评审，成员不可用自动降级） |
| `ywcrew followup <threadId> "…"` | 跨轮追问：同后端原生 resume（省 token），`--backend` 换模型自动重建历史 |
| `ywcrew status / result <runId>` | 查状态 / 取结构化结论（`result --wait` 阻塞等待多个 run） |
| `ywcrew route list/add/clear` | 查看/自定义任务路由偏好（写进各宿主技能） |
| `ywcrew doctor` | 后端安装/登录/宿主装载体检 |
| `ywcrew backends` | 列出可用后端与模型 |
| `ywcrew refresh` | 重新探测后端/模型清单，并重渲染宿主技能 |
| `ywcrew install` | 把技能（按你的配置渲染）分发到各宿主 skills 目录 |
| `ywcrew gc` | 清理超龄 run、worktree 与不活跃线程 |
| `ywcrew mcp` | 以 MCP stdio server 运行（可选接入方式） |

## 支持的后端

| 后端 | CLI | 思考强度 | 原生续聊 | 只读机制 |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | – | ✅ | `--permission-mode plan` |
| Codex | `codex` | ✅ | ✅ | `--sandbox read-only`（原生沙箱） |
| Grok | `grok` | ✅ | ✅ | `--permission-mode plan` |
| Kimi Code | `kimi` | – | ✅ | worktree 隔离（无原生只读档） |
| Antigravity | `agy` | ✅（模型后缀） | ✅ | `--mode plan` |

opencode / droid / cursor-agent / 浏览器通道见 [`docs/roadmap.md`](./docs/roadmap.md)。

## 设计要点

- **CLI-first + Skill 分发**：所有宿主都有 shell；技能文件按你的真实配置动态渲染（只出现你启用的后端和你的路由偏好），教宿主怎么派活。MCP 只是可选通道
- **任务五段式模板**：briefing / locations / objective / constraints / output_contract——被调模型对项目零知识，上下文质量决定结果质量；提示词层同时声明 agentic 环境与读写边界
- **无 daemon**：detached worker + 磁盘状态 + mkdir 原子锁（带初始化宽限与归属校验）+ 心跳惰性回收，宿主进程退出不影响任务
- **写隔离与脏区物化**：edit 任务自动 git worktree，未提交改动同步进快照（被调模型看到的是你当前的真实代码），改动以 patch 交付、绝不直接落仓库
- **secret guard**：路径 containment、symlink 逃逸拒绝、凭据文件名单、内容密钥特征扫描
- **续聊双通道**：同后端原生 session resume（KV 缓存零重建）；跨后端按时间正序重建历史（预算封顶，旧轮折叠）
- **失败当场报**：未安装/未登录的后端、不存在的目录、零匹配的 glob、占位符模型名——全部在派单时拦截并给出下一步动作，不让你在 worker 深处撞墙

## 开发

```bash
npm install && npm run build   # tsup 打包到 dist/
npm test                       # vitest 单测
npm run typecheck
```

## License

MIT
