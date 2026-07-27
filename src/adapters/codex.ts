import type { Adapter, DispatchRequest, ProbeResult, SpawnSpec } from "./types.js";
import type { ModelInfo, ResultStatus } from "../config/schema.js";
import { binaryExists, ndjsonEvents } from "./exec.js";

/**
 * Codex adapter。
 * 关键：全局参数必须在 exec 子命令之前（终审实测 `codex exec -a never` 会报错）。
 */
export const codexAdapter: Adapter = {
  id: "codex",
  binary: "codex",
  loginCommand: "codex login",
  capabilities: {
    supportsEffort: true,
    supportsNativeResume: true,
    supportsSchemaOutput: true,
    nativeReadOnly: true,
    readOnlyMechanism: "--sandbox read-only（原生沙箱）",
  },

  async probe(): Promise<ProbeResult> {
    const bin = await binaryExists("codex");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    return { installed: true, version: bin.version, authState: "unknown" };
  },

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "gpt-5.6-sol", efforts: ["low", "medium", "high"], isDefault: true },
      { id: "gpt-5.6-terra", efforts: ["low", "medium", "high"], isDefault: false },
    ];
  },

  planDispatch(req: DispatchRequest): SpawnSpec {
    const globalArgs = [
      "-a",
      "never",
      "-s",
      req.mode === "read-only" ? "read-only" : "workspace-write",
      "-C",
      req.cwd,
    ];
    if (req.model) globalArgs.push("-m", req.model);
    if (req.effort) globalArgs.push("-c", `model_reasoning_effort=${req.effort}`);
    const execArgs = ["exec", "--json"];
    if (req.schemaPath) execArgs.push("--output-schema", req.schemaPath);
    execArgs.push("-"); // prompt via stdin
    return { argv: [...globalArgs, ...execArgs], stdin: req.prompt };
  },

  planResume(sessionRef: string, req: DispatchRequest): SpawnSpec {
    const spec = this.planDispatch(req);
    const execIdx = spec.argv.indexOf("exec");
    // codex ... exec resume <id> ...
    const argv = [...spec.argv.slice(0, execIdx + 1), "resume", sessionRef, ...spec.argv.slice(execIdx + 1)];
    return { argv, stdin: spec.stdin };
  },

  extractSessionRef(stdout: string): string | undefined {
    // 实测事件流：{"type":"thread.started","thread_id":"019f..."}
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      const id = ev.thread_id ?? ev.session_id ?? ev.conversation_id;
      if (typeof id === "string") return id;
    }
    return undefined;
  },

  extractText(stdout: string): string {
    // 实测事件流：{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
    let last = "";
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      if (ev.type === "item.completed") {
        const item = ev.item as { type?: string; text?: string } | undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") last = item.text;
      }
    }
    return last || stdout.trim();
  },

  classifyError(output: string, _exitCode: number | null): ResultStatus | undefined {
    const t = output.toLowerCase();
    if (t.includes("not logged in") || t.includes("please run `codex login`") || t.includes("401"))
      return "auth_required";
    if (t.includes("usage limit") || t.includes("rate limit") || t.includes("quota")) return "quota";
    return undefined;
  },

  extractUsage(stdout: string) {
    // {"type":"turn.completed","usage":{"input_tokens":17705,"output_tokens":74,...}}
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      if (ev.type === "turn.completed") {
        const u = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (u) return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
      }
    }
    return undefined;
  },
};
