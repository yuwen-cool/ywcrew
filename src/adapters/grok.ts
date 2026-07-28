import type { Adapter, DispatchRequest, ProbeResult, SpawnSpec } from "./types.js";
import type { ModelInfo, ResultStatus } from "../config/schema.js";
import { binaryExists, extractJsonObject, run } from "./exec.js";

/**
 * Grok CLI adapter。
 * 注意：--json-schema 会强制 output-format=json（关闭流式）——结构化终稿与流式事件二选一，
 * 我们选结构化终稿（过程事件对 detached worker 非必需）。
 */
export const grokAdapter: Adapter = {
  id: "grok",
  binary: "grok",
  loginCommand: "grok login",
  capabilities: {
    supportsEffort: true,
    supportsNativeResume: true,
    supportsSchemaOutput: true,
    nativeReadOnly: true,
    readOnlyMechanism: "--permission-mode plan + --sandbox（行为约束+沙箱配置）",
  },

  async probe(): Promise<ProbeResult> {
    const bin = await binaryExists("grok");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    // grok models 实测 ~18s（走网络），需要宽松超时；正向判定避免超时被截杀时误报未登录
    const models = await run("grok", ["models"], 60_000);
    const all = models.stdout + models.stderr;
    const authState = /logged in/i.test(all) ? "ok" : /not authenticated/i.test(all) ? "unauthenticated" : "unknown";
    return { installed: true, version: bin.version, authState };
  },

  async listModels(): Promise<ModelInfo[]> {
    const r = await run("grok", ["models"], 60_000);
    const models: ModelInfo[] = [];
    for (const line of r.stdout.split("\n")) {
      const m = line.match(/^\s*\*?\s*([\w.-]+)\s*(\(default\))?\s*$/);
      if (m && m[1] && !/^(available|default)/i.test(m[1])) {
        models.push({ id: m[1], efforts: ["low", "medium", "high"], isDefault: Boolean(m[2]) });
      }
    }
    return models;
  },

  planDispatch(req: DispatchRequest): SpawnSpec {
    const argv = [
      "--output-format",
      "json",
      "--permission-mode",
      req.mode === "read-only" ? "plan" : "auto",
      "--cwd",
      req.cwd,
      "--no-subagents",
    ];
    if (req.model) argv.push("-m", req.model);
    if (req.effort) argv.push("--reasoning-effort", req.effort);
    if (req.schemaPath) argv.push("--json-schema", `@${req.schemaPath}`);
    argv.push("--prompt-file", "/dev/stdin");
    return { argv, stdin: req.prompt };
  },

  planResume(sessionRef: string, req: DispatchRequest): SpawnSpec {
    const spec = this.planDispatch(req);
    return { argv: ["-r", sessionRef, ...spec.argv], stdin: spec.stdin };
  },

  // 实测 --output-format json 信封：{text, stopReason, sessionId, usage, modelUsage, ...}
  extractSessionRef(stdout: string): string | undefined {
    const parsed = extractJsonObject(stdout) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed.sessionId === "string") return parsed.sessionId;
    const m = stdout.match(/"session_?id"\s*:\s*"([0-9a-f-]{36})"/i);
    return m?.[1];
  },

  extractText(stdout: string): string {
    const parsed = extractJsonObject(stdout) as Record<string, unknown> | undefined;
    if (parsed) {
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed.result === "string") return parsed.result;
    }
    return stdout.trim();
  },

  extractUsage(stdout: string) {
    const parsed = extractJsonObject(stdout) as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined;
    if (!parsed?.usage) return undefined;
    return { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens };
  },

  classifyError(output: string, _exitCode: number | null): ResultStatus | undefined {
    const t = output.toLowerCase();
    if (t.includes("not authenticated") || t.includes("please sign in") || t.includes("grok login"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("quota")) return "quota";
    return undefined;
  },
};
