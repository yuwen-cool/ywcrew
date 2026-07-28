import { z } from "zod";

export const BACKEND_IDS = ["claude", "codex", "grok", "kimi", "agy"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

export const EffortSchema = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof EffortSchema>;

export const TaskModeSchema = z.enum(["read-only", "edit"]);
export type TaskMode = z.infer<typeof TaskModeSchema>;

/**
 * 五段式任务模板。briefing/objective 必填——这是派活质量的底线；
 * 其余字段可选但 SKILL.md 会引导宿主尽量填全。
 */
export const TaskBodySchema = z.object({
  briefing: z
    .string()
    .min(20, "briefing 太短：需要项目背景（技术栈、构建/测试命令），被调模型对项目零知识"),
  locations: z.string().optional().describe("关键代码在哪：入口、模块路径"),
  objective: z
    .string()
    .min(20, "objective 太短：需要确切问题 + 已尝试过什么 + 原始报错全文"),
  constraints: z.string().optional().describe("边界：不许改哪些文件、不许做什么"),
  output_contract: z
    .string()
    .optional()
    .describe("期望输出结构说明，默认使用标准结果契约"),
});
export type TaskBody = z.infer<typeof TaskBodySchema>;

export const TaskSpecSchema = z.object({
  backend: z.union([z.enum(BACKEND_IDS), z.literal("auto")]).default("auto"),
  model: z.string().optional().describe("覆盖默认模型，任意字符串（未知名透传+warning）"),
  effort: EffortSchema.optional(),
  mode: TaskModeSchema.default("read-only"),
  task: TaskBodySchema,
  files: z.array(z.string()).default([]).describe("glob 白名单，! 前缀排除"),
  thread: z.string().optional().describe("续接既有线程的 threadId"),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(3600_000).default(900_000),
  label: z.string().optional().describe("人类可读的任务名"),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const ResultStatusSchema = z.enum([
  "ok",
  "auth_required",
  "quota",
  "timeout",
  "failed",
  "contract_violated",
  "cancelled",
]);
export type ResultStatus = z.infer<typeof ResultStatusSchema>;

export const EvidenceSchema = z.object({
  file: z.string(),
  lines: z.string().optional().describe("如 12-40"),
  claim: z.string(),
});

/** 回传宿主的结构化结论。summary 控制在 ~2k token 内，过程日志绝不回灌。 */
export const ResultContractSchema = z.object({
  status: ResultStatusSchema,
  summary: z.string(),
  evidence: z.array(EvidenceSchema).default([]),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  artifacts: z
    .object({
      patch: z.string().optional().describe("worktree diff 文件路径"),
      files: z.array(z.string()).default([]),
    })
    .optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      durationMs: z.number().optional(),
    })
    .optional(),
  session_ref: z.string().optional().describe("被调后端的原生会话 ID，可续聊"),
  takeover_command: z
    .string()
    .optional()
    .describe("用户想亲自接管该会话时，可直接复制执行的交互式命令"),
  fix_command: z.string().optional().describe("auth_required 时给用户的确切修复命令"),
  warnings: z.array(z.string()).default([]),
});
export type ResultContract = z.infer<typeof ResultContractSchema>;

export const BackendConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultModel: z.string().optional(),
  defaultEffort: EffortSchema.optional(),
  maxParallel: z.number().int().positive().default(2),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  backends: z.partialRecord(z.enum(BACKEND_IDS), BackendConfigSchema).default(() => ({})),
  defaults: z
    .object({
      panel: z.array(z.string()).default([]).describe('如 ["claude", "codex:gpt-5.6-sol"]'),
      maxParallelGlobal: z.number().int().positive().default(4),
      tokenBudget: z.number().int().positive().default(150_000),
    })
    .default(() => ({ panel: [], maxParallelGlobal: 4, tokenBudget: 150_000 })),
});
export type Config = z.infer<typeof ConfigSchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  efforts: z.array(EffortSchema).default([]),
  isDefault: z.boolean().default(false),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const CapabilitiesCacheSchema = z.object({
  fetchedAt: z.string(),
  backends: z.partialRecord(
    z.enum(BACKEND_IDS),
    z.object({
      installed: z.boolean(),
      version: z.string().optional(),
      authState: z.enum(["ok", "unauthenticated", "unknown"]),
      models: z.array(ModelInfoSchema).default([]),
    }),
  ),
});
export type CapabilitiesCache = z.infer<typeof CapabilitiesCacheSchema>;
