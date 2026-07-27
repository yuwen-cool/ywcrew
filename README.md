# ywcrew

把任务派给你本地已订阅的 AI agents —— 在任意宿主（Cursor / Claude Code / Codex / Grok / Kimi …）里，一句话调用其他家的模型，并行、不打断当前对话、不烧 API key。

```
宿主 agent ──(skill 触发)──> ywcrew CLI ──> detached worker ──> claude / codex / grok / kimi / agy
     ↑                                                                    │
     └──────────── runId → 结构化结论（summary/evidence/patch）←──────────┘
```

## 为什么

- 你为多家模型付了订阅费，但平时只能在各自的工具里用它们
- 想要第二意见、多模型评审时，要么手动开新终端复制粘贴，要么在主对话里切模型把 KV 缓存打掉重建
- ywcrew 让宿主 agent 用一条 shell 命令把活派出去：被调模型在独立进程里跑，主对话缓存零污染，回来的只有结构化结论

## 安装

```bash
npm install -g ywcrew
ywcrew init        # 探测本地 CLI → 配置默认模型/思考强度/panel 成员 → 分发技能到各宿主
```

之后在任意宿主里说一句"用 ywcrew 让 kimi 评审这个模块"即可。

## 核心命令

| 命令 | 作用 |
| --- | --- |
| `ywcrew run --stdin` | 派单个任务（五段式 JSON，`ywcrew template` 看模板） |
| `ywcrew panel --stdin` | 同一任务并行发给多个模型（多模型评审） |
| `ywcrew followup <threadId> "…"` | 跨轮追问：同后端原生 resume（省 token），`--backend` 换模型自动重建历史 |
| `ywcrew status / result <runId>` | 查状态 / 取结构化结论 |
| `ywcrew doctor` | 后端安装/登录/宿主装载体检 |
| `ywcrew backends` | 列出可用后端与模型 |
| `ywcrew mcp` | 以 MCP stdio server 运行（可选接入方式） |

## 设计要点

- **CLI-first + Skill 分发**：所有宿主都有 shell，技能文件教宿主怎么派活；MCP 只是可选通道
- **五段式任务模板**：briefing / locations / objective / constraints / output_contract——被调模型对项目零知识，上下文质量决定结果质量
- **无 daemon**：detached worker + 磁盘状态 + mkdir 原子锁 + 心跳惰性回收，宿主进程退出不影响任务
- **写隔离**：edit 任务自动 git worktree，改动以 patch 交付；无原生只读档的后端（kimi）读任务也进 worktree
- **secret guard**：路径 containment、symlink 逃逸拒绝、凭据文件名单、内容密钥特征扫描
- **续聊双通道**：同后端原生 session resume（KV 缓存零重建）；跨后端按时间正序重建历史（预算封顶，旧轮折叠）

## 支持的后端

| 后端 | CLI | 思考强度 | 原生续聊 | 只读机制 |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | – | ✅ | `--permission-mode plan` |
| Codex | `codex` | ✅ | ✅ | `--sandbox read-only` |
| Grok | `grok` | ✅ | ✅ | `--permission-mode plan` |
| Kimi Code | `kimi` | – | ✅ | worktree 隔离（无原生只读档） |
| Antigravity | `agy` | ✅（模型后缀） | ✅ | `--mode plan` |

opencode / droid / cursor-agent / 浏览器通道见 `docs/roadmap.md`。

## 开发

```bash
npm install && npm run build   # tsup 打包到 dist/
npm test                       # vitest 单测
npm run typecheck
```
