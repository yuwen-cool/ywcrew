import {
  atomicWriteJson,
  paths,
  readJson
} from "./chunk-QEBUZYAA.js";

// src/config/load.ts
import fs from "fs";

// src/config/schema.ts
import { z } from "zod";
var BACKEND_IDS = ["claude", "codex", "grok", "kimi", "agy"];
var EffortSchema = z.enum(["low", "medium", "high"]);
var TaskModeSchema = z.enum(["read-only", "edit"]);
var TaskBodySchema = z.object({
  briefing: z.string().min(20, "briefing \u592A\u77ED\uFF1A\u9700\u8981\u9879\u76EE\u80CC\u666F\uFF08\u6280\u672F\u6808\u3001\u6784\u5EFA/\u6D4B\u8BD5\u547D\u4EE4\uFF09\uFF0C\u88AB\u8C03\u6A21\u578B\u5BF9\u9879\u76EE\u96F6\u77E5\u8BC6"),
  locations: z.string().optional().describe("\u5173\u952E\u4EE3\u7801\u5728\u54EA\uFF1A\u5165\u53E3\u3001\u6A21\u5757\u8DEF\u5F84"),
  objective: z.string().min(20, "objective \u592A\u77ED\uFF1A\u9700\u8981\u786E\u5207\u95EE\u9898 + \u5DF2\u5C1D\u8BD5\u8FC7\u4EC0\u4E48 + \u539F\u59CB\u62A5\u9519\u5168\u6587"),
  constraints: z.string().optional().describe("\u8FB9\u754C\uFF1A\u4E0D\u8BB8\u6539\u54EA\u4E9B\u6587\u4EF6\u3001\u4E0D\u8BB8\u505A\u4EC0\u4E48"),
  output_contract: z.string().optional().describe("\u671F\u671B\u8F93\u51FA\u7ED3\u6784\u8BF4\u660E\uFF0C\u9ED8\u8BA4\u4F7F\u7528\u6807\u51C6\u7ED3\u679C\u5951\u7EA6")
});
var TaskSpecSchema = z.object({
  backend: z.union([z.enum(BACKEND_IDS), z.literal("auto")]).default("auto"),
  model: z.string().optional().describe("\u8986\u76D6\u9ED8\u8BA4\u6A21\u578B\uFF0C\u4EFB\u610F\u5B57\u7B26\u4E32\uFF08\u672A\u77E5\u540D\u900F\u4F20+warning\uFF09"),
  effort: EffortSchema.optional(),
  mode: TaskModeSchema.default("read-only"),
  strict: z.boolean().default(false).describe("\u4E25\u683C\u8BFB\u53D6\u9694\u79BB\uFF1A\u88AB\u8C03\u6A21\u578B\u5728\u53EA\u542B files \u767D\u540D\u5355\u6587\u4EF6\u7684\u5F71\u5B50\u76EE\u5F55\u4E2D\u6267\u884C\uFF0C\u8BFB\u4E0D\u5230\u9879\u76EE\u5176\u4ED6\u6587\u4EF6\uFF08\u4EC5 read-only \u6709\u6548\uFF09"),
  task: TaskBodySchema,
  files: z.array(z.string()).default([]).describe("glob \u767D\u540D\u5355\uFF0C! \u524D\u7F00\u6392\u9664"),
  thread: z.string().optional().describe("\u7EED\u63A5\u65E2\u6709\u7EBF\u7A0B\u7684 threadId"),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(36e5).default(9e5),
  label: z.string().optional().describe("\u4EBA\u7C7B\u53EF\u8BFB\u7684\u4EFB\u52A1\u540D")
});
var ResultStatusSchema = z.enum([
  "ok",
  "auth_required",
  "quota",
  "timeout",
  "failed",
  "contract_violated",
  "cancelled"
]);
var EvidenceSchema = z.object({
  file: z.string(),
  lines: z.string().optional().describe("\u5982 12-40"),
  claim: z.string(),
  verified: z.boolean().optional().describe("worker \u81EA\u52A8\u6838\u9A8C\uFF1A\u6587\u4EF6\u5B58\u5728\u4E14\u884C\u53F7\u8303\u56F4\u5408\u6CD5"),
  verify_note: z.string().optional().describe("\u6838\u9A8C\u5931\u8D25\u539F\u56E0\uFF08\u6587\u4EF6\u4E0D\u5B58\u5728/\u884C\u53F7\u8D8A\u754C\uFF09")
});
var ResultContractSchema = z.object({
  status: ResultStatusSchema,
  summary: z.string(),
  evidence: z.array(EvidenceSchema).default([]),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  artifacts: z.object({
    patch: z.string().optional().describe("worktree diff \u6587\u4EF6\u8DEF\u5F84"),
    files: z.array(z.string()).default([])
  }).optional(),
  usage: z.object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    durationMs: z.number().optional()
  }).optional(),
  session_ref: z.string().optional().describe("\u88AB\u8C03\u540E\u7AEF\u7684\u539F\u751F\u4F1A\u8BDD ID\uFF0C\u53EF\u7EED\u804A"),
  takeover_command: z.string().optional().describe("\u7528\u6237\u60F3\u4EB2\u81EA\u63A5\u7BA1\u8BE5\u4F1A\u8BDD\u65F6\uFF0C\u53EF\u76F4\u63A5\u590D\u5236\u6267\u884C\u7684\u4EA4\u4E92\u5F0F\u547D\u4EE4"),
  fix_command: z.string().optional().describe("auth_required \u65F6\u7ED9\u7528\u6237\u7684\u786E\u5207\u4FEE\u590D\u547D\u4EE4"),
  warnings: z.array(z.string()).default([])
});
var BackendConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultModel: z.string().optional(),
  defaultEffort: EffortSchema.optional(),
  maxParallel: z.number().int().positive().default(2)
});
var RoutingRuleSchema = z.object({
  when: z.string().describe("\u4EFB\u52A1\u7C7B\u578B\u7684\u81EA\u7136\u8BED\u8A00\u63CF\u8FF0\uFF0C\u5982\u300C\u7591\u96BE bug \u5B9A\u4F4D\u300D"),
  use: z.string().describe("backend[:model][:effort]\uFF0C\u5982 codex::high\u3001agy:claude-sonnet-4-6")
});
var ConfigSchema = z.object({
  version: z.literal(1).default(1),
  backends: z.partialRecord(z.enum(BACKEND_IDS), BackendConfigSchema).default(() => ({})),
  defaults: z.object({
    panel: z.array(z.string()).default([]).describe('\u5982 ["claude", "codex:gpt-5.6-sol"]'),
    maxParallelGlobal: z.number().int().positive().default(4),
    tokenBudget: z.number().int().positive().default(15e4),
    /** 用户自定义路由偏好；空则使用内置默认（按已启用后端过滤） */
    routing: z.array(RoutingRuleSchema).default([])
  }).default(() => ({ panel: [], maxParallelGlobal: 4, tokenBudget: 15e4, routing: [] }))
});
var ModelInfoSchema = z.object({
  id: z.string(),
  efforts: z.array(EffortSchema).default([]),
  isDefault: z.boolean().default(false)
});
var CapabilitiesCacheSchema = z.object({
  fetchedAt: z.string(),
  backends: z.partialRecord(
    z.enum(BACKEND_IDS),
    z.object({
      installed: z.boolean(),
      version: z.string().optional(),
      authState: z.enum(["ok", "unauthenticated", "unknown"]),
      models: z.array(ModelInfoSchema).default([])
    })
  )
});

// src/config/load.ts
function loadConfig() {
  const raw = readJson(paths.config);
  if (!raw) return ConfigSchema.parse({});
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`\u914D\u7F6E\u6587\u4EF6 ${paths.config} \u4E0D\u5408\u6CD5\uFF08\u672A\u88AB\u8986\u76D6\uFF0C\u8BF7\u624B\u52A8\u4FEE\u6B63\u6216\u5220\u9664\u540E\u91CD\u65B0 ywcrew init\uFF09\uFF1A
${issues}`);
  }
  return parsed.data;
}
function saveConfig(config) {
  atomicWriteJson(paths.config, config);
}
function loadCapabilities() {
  const raw = readJson(paths.capabilities);
  if (!raw) return void 0;
  const parsed = CapabilitiesCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : void 0;
}
function saveCapabilities(cache) {
  atomicWriteJson(paths.capabilities, cache);
}
function ensureHome() {
  fs.mkdirSync(paths.runs, { recursive: true });
  fs.mkdirSync(paths.threads, { recursive: true });
  fs.mkdirSync(paths.locks, { recursive: true });
}

export {
  BACKEND_IDS,
  EffortSchema,
  TaskModeSchema,
  TaskBodySchema,
  TaskSpecSchema,
  ConfigSchema,
  loadConfig,
  saveConfig,
  loadCapabilities,
  saveCapabilities,
  ensureHome
};
//# sourceMappingURL=chunk-A6PGVESN.js.map