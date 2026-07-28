import type { Adapter, DispatchRequest, ProbeResult, SpawnSpec } from "./types.js";
import type { ModelInfo, ResultStatus } from "../config/schema.js";
import { binaryExists, ndjsonEvents, run } from "./exec.js";

/**
 * Kimi Code adapter。
 * 无人值守必须用 --auto（完全自主不提问）；--yolo 仍可能提问导致挂死（终审确认）。
 */
export const kimiAdapter: Adapter = {
  id: "kimi",
  binary: "kimi",
  loginCommand: "kimi login",
  capabilities: {
    supportsEffort: false,
    supportsNativeResume: true,
    supportsSchemaOutput: false,
    nativeReadOnly: false,
    readOnlyMechanism: "-p 模式不接受任何权限 flag（实测互斥）→ worktree 隔离 + prompt 约束",
  },

  async probe(): Promise<ProbeResult> {
    const bin = await binaryExists("kimi");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    const r = await run("kimi", ["provider", "list"]);
    const authState = /oauth|managed/i.test(r.stdout) ? "ok" : "unauthenticated";
    return { installed: true, version: bin.version, authState };
  },

  async listModels(): Promise<ModelInfo[]> {
    const r = await run("kimi", ["provider", "list"]);
    const models: ModelInfo[] = [];
    const defaultMatch = r.stdout.match(/Default model:\s*(\S+)/);
    if (defaultMatch) models.push({ id: defaultMatch[1], efforts: [], isDefault: true });
    return models;
  },

  planDispatch(req: DispatchRequest): SpawnSpec {
    // 实测：-p 与 --plan/--auto/--yolo 全部互斥，prompt 模式按默认策略执行；
    // 只读安全由 worker 的 worktree 隔离兜底
    const argv = ["-p", req.prompt, "--output-format", "stream-json"];
    if (req.model) argv.push("-m", req.model);
    return { argv };
  },

  planResume(sessionRef: string, req: DispatchRequest): SpawnSpec {
    const spec = this.planDispatch(req);
    // 实测：官方续聊提示为 `kimi -r session_xxx`
    return { argv: ["-r", sessionRef, ...spec.argv] };
  },

  extractSessionRef(stdout: string): string | undefined {
    const m = stdout.match(/session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0];
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      const id = ev.session_id ?? ev.sessionId;
      if (typeof id === "string") return id;
    }
    return undefined;
  },

  extractText(stdout: string): string {
    let text = "";
    for (const ev of ndjsonEvents(stdout) as Array<Record<string, unknown>>) {
      if (typeof ev.content === "string" && (ev.role === "assistant" || ev.type === "message"))
        text = ev.content;
      if (ev.type === "result" && typeof ev.result === "string") text = ev.result;
    }
    return text || stdout.trim();
  },

  classifyError(output: string, _exitCode: number | null): ResultStatus | undefined {
    const t = output.toLowerCase();
    if (t.includes("not logged in") || t.includes("unauthorized") || t.includes("login required"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("quota")) return "quota";
    return undefined;
  },
  interactiveResume(sessionRef: string): string {
    return `kimi -r ${sessionRef}`;
  },
};
