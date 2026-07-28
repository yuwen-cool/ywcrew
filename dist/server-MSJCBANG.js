import {
  dispatchTask
} from "./chunk-LHHRB7ZV.js";
import {
  getThread
} from "./chunk-JTDLTURC.js";
import {
  BACKEND_IDS,
  EffortSchema,
  TaskBodySchema,
  TaskModeSchema
} from "./chunk-CNHRP3AD.js";
import {
  readResult,
  readRun
} from "./chunk-IFU773SE.js";
import "./chunk-QEBUZYAA.js";

// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
var text = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
async function startMcpServer() {
  const server = new McpServer({ name: "ywcrew", version: "0.1.0" });
  server.registerTool(
    "dispatch",
    {
      description: "\u628A\u4EFB\u52A1\u6D3E\u7ED9\u672C\u5730\u8BA2\u9605\u7684 AI agent\uFF08claude/codex/grok/kimi/agy\uFF09\u3002detached \u6267\u884C\uFF0C\u7ACB\u5373\u8FD4\u56DE runId\u3002\u4EFB\u52A1\u63CF\u8FF0\u5FC5\u987B\u81EA\u5305\u542B\uFF08\u88AB\u8C03\u65B9\u5BF9\u9879\u76EE\u96F6\u77E5\u8BC6\uFF09\u3002",
      inputSchema: {
        backend: z.enum([...BACKEND_IDS, "auto"]).default("auto"),
        model: z.string().optional(),
        effort: EffortSchema.optional(),
        mode: TaskModeSchema.default("read-only"),
        task: TaskBodySchema,
        files: z.array(z.string()).default([]),
        thread: z.string().optional(),
        cwd: z.string().optional(),
        label: z.string().optional()
      }
    },
    async (args) => {
      const outcome = dispatchTask(args);
      return text({ runId: outcome.run.runId, threadId: outcome.threadId, warnings: outcome.warnings });
    }
  );
  server.registerTool(
    "status",
    { description: "\u67E5\u8BE2 run \u72B6\u6001", inputSchema: { runId: z.string() } },
    async ({ runId }) => text(readRun(runId) ?? { error: "not found" })
  );
  server.registerTool(
    "result",
    { description: "\u8BFB\u53D6 run \u7684\u7ED3\u6784\u5316\u7ED3\u8BBA\uFF08\u672A\u5B8C\u6210\u65F6\u8FD4\u56DE pending\uFF09", inputSchema: { runId: z.string() } },
    async ({ runId }) => {
      readRun(runId);
      return text(readResult(runId) ?? { pending: true, state: readRun(runId)?.state });
    }
  );
  server.registerTool(
    "followup",
    {
      description: "\u5728\u65E2\u6709\u7EBF\u7A0B\u4E0A\u8FFD\u95EE\u3002\u540C\u540E\u7AEF\u8D70\u539F\u751F\u4F1A\u8BDD\u6062\u590D\uFF08\u7701 token\uFF09\uFF0C\u8DE8\u540E\u7AEF\u81EA\u52A8\u91CD\u5EFA\u5386\u53F2\u3002",
      inputSchema: {
        threadId: z.string(),
        prompt: z.string().min(5),
        backend: z.enum(BACKEND_IDS).optional(),
        model: z.string().optional()
      }
    },
    async ({ threadId, prompt, backend, model }) => {
      const thread = getThread(threadId);
      if (!thread || thread.turns.length === 0) return text({ error: `\u7EBF\u7A0B ${threadId} \u4E0D\u5B58\u5728\u6216\u4E3A\u7A7A` });
      const last = thread.turns[thread.turns.length - 1];
      const outcome = dispatchTask({
        backend: backend ?? last.backend,
        model,
        mode: "read-only",
        thread: threadId,
        cwd: last.cwd,
        task: {
          briefing: "\uFF08\u7EED\u804A\uFF09\u9879\u76EE\u80CC\u666F\u4E0E\u6B64\u524D\u7ED3\u8BBA\u89C1\u300C\u6B64\u524D\u7684\u8BA8\u8BBA\u7EBF\u7A0B\u300D\u4E00\u8282\uFF0C\u52FF\u91CD\u65B0\u81EA\u6211\u4ECB\u7ECD\u3002",
          objective: prompt.length >= 20 ? prompt : `${prompt}\uFF08\u7EED\u63A5\u4E0A\u6587\uFF0C\u9488\u5BF9\u6B64\u524D\u7ED3\u8BBA\u56DE\u5E94\uFF09`
        },
        files: []
      });
      return text({ runId: outcome.run.runId, threadId: outcome.threadId });
    }
  );
  await server.connect(new StdioServerTransport());
}
export {
  startMcpServer
};
//# sourceMappingURL=server-MSJCBANG.js.map