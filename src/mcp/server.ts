import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TaskBodySchema, TaskModeSchema, EffortSchema, BACKEND_IDS } from "../config/schema.js";
import { dispatchTask } from "../core/dispatch.js";
import { readRun, readResult } from "../core/runs.js";
import { getThread } from "../core/threads.js";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

/** 可选接入方式：功能与 CLI 等价，宿主没有 shell 或偏好工具审批 UI 时使用 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "ywcrew", version: "0.1.0" });

  server.registerTool(
    "dispatch",
    {
      description:
        "把任务派给本地订阅的 AI agent（claude/codex/grok/kimi/agy）。detached 执行，立即返回 runId。任务描述必须自包含（被调方对项目零知识）。",
      inputSchema: {
        backend: z.enum([...BACKEND_IDS, "auto"]).default("auto"),
        model: z.string().optional(),
        effort: EffortSchema.optional(),
        mode: TaskModeSchema.default("read-only"),
        task: TaskBodySchema,
        files: z.array(z.string()).default([]),
        thread: z.string().optional(),
        cwd: z.string().optional(),
        label: z.string().optional(),
      },
    },
    async (args) => {
      const outcome = dispatchTask(args);
      return text({ runId: outcome.run.runId, threadId: outcome.threadId, warnings: outcome.warnings });
    },
  );

  server.registerTool(
    "status",
    { description: "查询 run 状态", inputSchema: { runId: z.string() } },
    async ({ runId }) => text(readRun(runId) ?? { error: "not found" }),
  );

  server.registerTool(
    "result",
    { description: "读取 run 的结构化结论（未完成时返回 pending）", inputSchema: { runId: z.string() } },
    async ({ runId }) => {
      readRun(runId);
      return text(readResult(runId) ?? { pending: true, state: readRun(runId)?.state });
    },
  );

  server.registerTool(
    "followup",
    {
      description: "在既有线程上追问。同后端走原生会话恢复（省 token），跨后端自动重建历史。",
      inputSchema: {
        threadId: z.string(),
        prompt: z.string().min(5),
        backend: z.enum(BACKEND_IDS).optional(),
        model: z.string().optional(),
      },
    },
    async ({ threadId, prompt, backend, model }) => {
      const thread = getThread(threadId);
      if (!thread || thread.turns.length === 0) return text({ error: `线程 ${threadId} 不存在或为空` });
      const last = thread.turns[thread.turns.length - 1];
      const outcome = dispatchTask({
        backend: backend ?? last.backend,
        model,
        mode: "read-only",
        thread: threadId,
        cwd: last.cwd,
        task: {
          briefing: "（续聊）项目背景与此前结论见「此前的讨论线程」一节，勿重新自我介绍。",
          objective: prompt.length >= 20 ? prompt : `${prompt}（续接上文，针对此前结论回应）`,
        },
        files: [],
      });
      return text({ runId: outcome.run.runId, threadId: outcome.threadId });
    },
  );

  await server.connect(new StdioServerTransport());
}
