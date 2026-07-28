import type { Adapter, DispatchRequest, ProbeResult, SpawnSpec } from "./types.js";
import type { Effort, ModelInfo, ResultStatus } from "../config/schema.js";
import { binaryExists, run } from "./exec.js";

const EFFORTS: Effort[] = ["low", "medium", "high"];

/** agy 的型号名把强度编码在后缀里（gemini-3.1-pro-high）→ 拆解归一化 */
export function decomposeAgyModel(raw: string): { base: string; effort?: Effort } {
  for (const e of EFFORTS) {
    if (raw.endsWith(`-${e}`)) return { base: raw.slice(0, -(e.length + 1)), effort: e };
  }
  return { base: raw };
}

/**
 * Antigravity (agy) adapter。
 */
export const agyAdapter: Adapter = {
  id: "agy",
  binary: "agy",
  loginCommand: "agy（交互式启动后登录）",
  capabilities: {
    supportsEffort: true,
    supportsNativeResume: true,
    supportsSchemaOutput: false,
    nativeReadOnly: true,
    readOnlyMechanism: "--mode plan + --sandbox（行为约束+终端限制沙箱）",
  },

  async probe(): Promise<ProbeResult> {
    const bin = await binaryExists("agy");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    const r = await run("agy", ["models"], 60_000);
    const all = r.stdout + r.stderr;
    // 实测未登录文案：Error: Please sign in to view available models.
    const authState = /sign in|authentication required/i.test(all)
      ? "unauthenticated"
      : r.code === 0 && r.stdout.trim().length > 0
        ? "ok"
        : "unknown";
    return { installed: true, version: bin.version, authState };
  },

  async listModels(): Promise<ModelInfo[]> {
    const r = await run("agy", ["models"]);
    const byBase = new Map<string, Set<Effort>>();
    for (const line of r.stdout.split("\n")) {
      const raw = line.trim();
      if (!raw || raw.includes(" ")) continue;
      const { base, effort } = decomposeAgyModel(raw);
      if (!byBase.has(base)) byBase.set(base, new Set());
      if (effort) byBase.get(base)!.add(effort);
    }
    return [...byBase.entries()].map(([id, efforts]) => ({
      id,
      efforts: [...efforts],
      isDefault: false,
    }));
  },

  planDispatch(req: DispatchRequest): SpawnSpec {
    const argv = ["-p", req.prompt, "--print-timeout", "20m"];
    argv.push("--mode", req.mode === "read-only" ? "plan" : "accept-edits");
    if (req.model) {
      // 用户可能传 base 名或完整名；有 effort 且是 base 名时补后缀
      const { base, effort: embedded } = decomposeAgyModel(req.model);
      const effort = embedded ?? req.effort;
      argv.push("--model", effort ? `${base}-${effort}` : req.model);
    } else if (req.effort) {
      // 无模型仅有 effort：交给 agy 默认模型（无法安全拼后缀）
      argv.push("--effort", req.effort);
    }
    return { argv };
  },

  planResume(sessionRef: string, req: DispatchRequest): SpawnSpec {
    const spec = this.planDispatch(req);
    return { argv: ["--conversation", sessionRef, ...spec.argv] };
  },

  extractSessionRef(stdout: string): string | undefined {
    const m = stdout.match(/conversation[_ ]?id["\s:]*([\w-]{8,})/i);
    return m?.[1];
  },

  extractText(stdout: string): string {
    return stdout.trim();
  },

  classifyError(output: string, _exitCode: number | null): ResultStatus | undefined {
    const t = output.toLowerCase();
    // 实测文案：Error: authentication required. Run 'agy' to log in, then retry.
    if (
      t.includes("authentication required") ||
      t.includes("authentication failed") ||
      t.includes("not logged in") ||
      t.includes("sign in") ||
      t.includes("unauthenticated")
    )
      return "auth_required";
    if (t.includes("rate limit") || t.includes("quota")) return "quota";
    return undefined;
  },
};
