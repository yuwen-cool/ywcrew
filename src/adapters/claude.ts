import type { Adapter, DispatchRequest, ProbeResult, SpawnSpec } from "./types.js";
import type { ModelInfo, ResultStatus } from "../config/schema.js";
import { binaryExists, ndjsonEvents } from "./exec.js";

/**
 * Claude Code adapter。
 * 注意：绝不使用 --bare（它会禁用订阅 OAuth 登录，只认 API key）。
 */
export const claudeAdapter: Adapter = {
  id: "claude",
  binary: "claude",
  loginCommand: "claude /login（交互式运行 claude 后登录）",
  capabilities: {
    supportsEffort: false,
    supportsNativeResume: true,
    supportsSchemaOutput: false,
    nativeReadOnly: true,
    readOnlyMechanism: "--permission-mode plan（行为约束，非 OS 级隔离）",
  },

  async probe(): Promise<ProbeResult> {
    const bin = await binaryExists("claude");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    return { installed: true, version: bin.version, authState: "unknown" };
  },

  async listModels(): Promise<ModelInfo[]> {
    // Claude Code 无 models 子命令；静态注册表 + 运行时透传任意模型名
    return [
      { id: "opus", efforts: [], isDefault: false },
      { id: "sonnet", efforts: [], isDefault: true },
      { id: "haiku", efforts: [], isDefault: false },
    ];
  },

  planDispatch(req: DispatchRequest): SpawnSpec {
    const argv = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      req.mode === "read-only" ? "plan" : "acceptEdits",
    ];
    if (req.model) argv.push("--model", req.model);
    return { argv, stdin: req.prompt };
  },

  planResume(sessionRef: string, req: DispatchRequest): SpawnSpec {
    const spec = this.planDispatch(req);
    return { argv: ["--resume", sessionRef, ...spec.argv], stdin: spec.stdin };
  },

  extractSessionRef(stdout: string): string | undefined {
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      if (typeof ev.session_id === "string") return ev.session_id;
    }
    return undefined;
  },

  extractText(stdout: string): string {
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      if (ev.type === "result" && typeof ev.result === "string") return ev.result;
    }
    return stdout.trim();
  },

  classifyError(output: string, _exitCode: number | null): ResultStatus | undefined {
    const t = output.toLowerCase();
    if (t.includes("please run /login") || t.includes("not logged in") || t.includes("invalid api key"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("usage limit") || t.includes("quota")) return "quota";
    return undefined;
  },
  interactiveResume(sessionRef: string): string {
    return `claude --resume ${sessionRef}`;
  },
};
