import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { paths } from "../config/paths.js";
import { ResultContract, TaskSpec, type BackendId } from "../config/schema.js";
import { getAdapter } from "../adapters/registry.js";
import type { DispatchRequest } from "../adapters/types.js";
import { extractJsonObject } from "../adapters/exec.js";
import { bundleFiles, renderPrompt } from "../context/builder.js";
import { loadConfig } from "../config/load.js";
import { readTask, updateRun, writeHeartbeat, writeResult, readRun } from "./runs.js";
import { tryAcquireSlot, renewSlot, releaseSlot, processIdentity } from "./lock.js";
import { appendTurn, planContinuation } from "./threads.js";

const HEARTBEAT_INTERVAL_MS = 5_000;
const SLOT_WAIT_INTERVAL_MS = 3_000;
const SLOT_WAIT_MAX_MS = 30 * 60_000;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function execBackend(
  binary: string,
  argv: string[],
  stdin: string | undefined,
  cwd: string,
  timeoutMs: number,
  eventsFile: string,
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const child = spawn(binary, argv, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const events = fs.createWriteStream(eventsFile, { flags: "a" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      events.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      events.write(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      events.end();
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      events.end();
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function setupWorktree(runId: string, sourceCwd: string): string | undefined {
  const wtDir = path.join(paths.home, "worktrees", runId);
  try {
    execFileSync("git", ["-C", sourceCwd, "rev-parse", "--git-dir"], { stdio: "pipe" });
    fs.mkdirSync(path.dirname(wtDir), { recursive: true });
    execFileSync("git", ["-C", sourceCwd, "worktree", "add", "--detach", wtDir], { stdio: "pipe" });
    return wtDir;
  } catch {
    return undefined; // 非 git 目录：edit 任务直接在原地跑（result 会带 warning）
  }
}

function collectPatch(runId: string, wtDir: string): string | undefined {
  try {
    const patch = execFileSync("git", ["-C", wtDir, "diff", "HEAD"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (!patch.trim()) return undefined;
    const patchFile = path.join(paths.runDir(runId), "changes.patch");
    fs.writeFileSync(patchFile, patch);
    return patchFile;
  } catch {
    return undefined;
  }
}

interface ParsedContract {
  needMoreContext?: { files: string[]; reason?: string };
  result?: Partial<ResultContract>;
}

function parseContractFromText(text: string): ParsedContract {
  const obj = extractJsonObject(text) as Record<string, unknown> | undefined;
  if (!obj) return {};
  if (obj.status === "need_more_context" && Array.isArray(obj.files)) {
    return { needMoreContext: { files: obj.files as string[], reason: obj.reason as string | undefined } };
  }
  if (typeof obj.summary === "string") {
    return {
      result: {
        summary: obj.summary,
        evidence: Array.isArray(obj.evidence) ? (obj.evidence as ResultContract["evidence"]) : [],
        confidence: obj.confidence as ResultContract["confidence"],
      },
    };
  }
  return {};
}

/** detached worker 主流程：`ywcrew __worker <runId>` */
export async function runWorker(runId: string): Promise<void> {
  const spec = readTask(runId);
  if (!spec) throw new Error(`run ${runId} 缺 task.json`);
  const meta = readRun(runId);
  const threadId = meta?.threadId;
  const config = loadConfig();
  const backend = spec.backend as BackendId;
  const adapter = getAdapter(backend);
  const backendCfg = config.backends[backend];

  // 1) 排队获取并发 slot（backend 级 + 全局）
  const deadline = Date.now() + SLOT_WAIT_MAX_MS;
  let backendSlot: string | undefined;
  let globalSlot: string | undefined;
  while (Date.now() < deadline) {
    backendSlot = tryAcquireSlot(backend, backendCfg?.maxParallel ?? 2);
    if (backendSlot) {
      globalSlot = tryAcquireSlot("global", config.defaults.maxParallelGlobal);
      if (globalSlot) break;
      releaseSlot(backendSlot);
      backendSlot = undefined;
    }
    await sleep(SLOT_WAIT_INTERVAL_MS);
  }
  if (!backendSlot || !globalSlot) {
    writeResult(runId, {
      status: "timeout",
      summary: "排队超时：并发 slot 30 分钟内未空出。",
      evidence: [],
      warnings: [],
    });
    return;
  }

  const heartbeatTimer = setInterval(() => {
    writeHeartbeat(runId);
    renewSlot(backendSlot!);
    renewSlot(globalSlot!);
  }, HEARTBEAT_INTERVAL_MS);

  const warnings: string[] = [];
  try {
    updateRun(runId, {
      state: "running",
      workerPid: process.pid,
      workerIdentity: processIdentity(process.pid),
    });
    writeHeartbeat(runId);

    // 2) 续聊路由（先于目录决策：native 续聊必须回到原执行目录，kimi 等把会话绑定到目录）
    const continuation = planContinuation(threadId, backend);

    // 3) 工作目录与写隔离
    const sourceCwd = path.resolve(spec.cwd ?? process.cwd());
    let cwd = sourceCwd;
    let wtDir: string | undefined;
    if (continuation.mode === "native" && continuation.cwd && fs.existsSync(continuation.cwd)) {
      cwd = continuation.cwd;
    } else {
      const needsIsolation = spec.mode === "edit" || !adapter.capabilities.nativeReadOnly;
      if (needsIsolation) {
        wtDir = setupWorktree(runId, sourceCwd);
        if (wtDir) cwd = wtDir;
        else if (spec.mode === "edit") warnings.push("非 git 目录，edit 任务未做 worktree 隔离");
        else warnings.push(`${backend} 无原生只读档且非 git 目录，只读任务仅靠 prompt 约束`);
      }
    }

    // 4) 模型/强度：显式传入 > 配置默认；未知模型透传 + warning
    const model = spec.model ?? backendCfg?.defaultModel;
    const effort = adapter.capabilities.supportsEffort ? (spec.effort ?? backendCfg?.defaultEffort) : undefined;
    if (spec.effort && !adapter.capabilities.supportsEffort)
      warnings.push(`${backend} 不支持思考强度参数，已忽略 effort=${spec.effort}`);

    // 5) 上下文打包
    const bundle = bundleFiles({ files: spec.files, cwd }, config.defaults.tokenBudget);
    if (!bundle.ok) {
      writeResult(runId, {
        status: "failed",
        summary: bundle.overBudgetReport!,
        evidence: [],
        warnings,
      });
      return;
    }
    for (const s of bundle.skipped) {
      if (s.reason.includes("凭据") || s.reason.includes("密钥") || s.reason.includes("逃逸"))
        warnings.push(`已拒绝附带 ${s.rel}（${s.reason}）`);
    }

    const prompt = renderPrompt(spec, bundle, {
      historyBlock: continuation.mode === "rebuild" ? continuation.historyBlock : undefined,
    });

    const req: DispatchRequest = { prompt, model, effort, mode: spec.mode, cwd };
    const plan =
      continuation.mode === "native"
        ? adapter.planResume(continuation.sessionRef, req)
        : adapter.planDispatch(req);

    // 6) 执行
    const eventsFile = path.join(paths.runDir(runId), "events.ndjson");
    const startedAt = Date.now();
    let outcome = await execBackend(adapter.binary, plan.argv, plan.stdin, cwd, spec.timeoutMs, eventsFile);
    let text = adapter.extractText(outcome.stdout);
    let sessionRef = adapter.extractSessionRef(outcome.stdout);
    let contract = parseContractFromText(text);

    // 7) need_more_context：白名单内自动补一轮（最多一次）
    if (contract.needMoreContext && sessionRef) {
      const extra = bundleFiles({ files: contract.needMoreContext.files, cwd }, config.defaults.tokenBudget);
      if (extra.ok && extra.files.length > 0) {
        const followPrompt = `补充你请求的文件：\n\n${extra.files
          .map((f) => `=== FILE: ${f.rel} ===\n${f.content}\n=== END FILE ===`)
          .join("\n\n")}\n\n请基于补充内容完成任务，输出要求不变。`;
        const followPlan = adapter.planResume(sessionRef, { ...req, prompt: followPrompt });
        outcome = await execBackend(adapter.binary, followPlan.argv, followPlan.stdin, cwd, spec.timeoutMs, eventsFile);
        text = adapter.extractText(outcome.stdout);
        sessionRef = adapter.extractSessionRef(outcome.stdout) ?? sessionRef;
        contract = parseContractFromText(text);
        warnings.push(`被调方请求补充上下文，已自动补一轮（${extra.files.length} 个文件）`);
      } else {
        warnings.push("被调方请求补充上下文，但请求的文件不可用/被 guard 拒绝");
      }
    }

    // 8) 结果归类与落盘
    const durationMs = Date.now() - startedAt;
    if (outcome.timedOut) {
      writeResult(runId, {
        status: "timeout",
        summary: `任务超时（${spec.timeoutMs}ms）被终止。${sessionRef ? `会话 ${sessionRef} 可用 followup 续接，不要重复派活。` : ""}`,
        evidence: [],
        session_ref: sessionRef,
        warnings,
      });
      return;
    }
    const errorClass = outcome.code !== 0 ? adapter.classifyError(outcome.stdout + outcome.stderr, outcome.code) : undefined;
    if (errorClass) {
      writeResult(runId, {
        status: errorClass,
        summary:
          errorClass === "auth_required"
            ? `${backend} 登录态失效。修复：${adapter.loginCommand}`
            : `${backend} 返回 ${errorClass}。详见 events.ndjson。`,
        evidence: [],
        fix_command: errorClass === "auth_required" ? adapter.loginCommand : undefined,
        warnings,
      });
      return;
    }
    if (outcome.code !== 0 && !text.trim()) {
      writeResult(runId, {
        status: "failed",
        summary: `${backend} 退出码 ${outcome.code}。stderr 摘要：${outcome.stderr.slice(0, 500)}`,
        evidence: [],
        warnings,
      });
      return;
    }

    const patchFile = wtDir ? collectPatch(runId, wtDir) : undefined;
    const result: ResultContract = {
      status: contract.result ? "ok" : "contract_violated",
      summary: contract.result?.summary ?? text.slice(0, 6000),
      evidence: contract.result?.evidence ?? [],
      confidence: contract.result?.confidence,
      artifacts: patchFile ? { patch: patchFile, files: [] } : undefined,
      usage: { ...adapter.extractUsage?.(outcome.stdout), durationMs },
      session_ref: sessionRef,
      takeover_command: sessionRef
        ? `cd ${JSON.stringify(cwd)} && ${adapter.interactiveResume(sessionRef)}`
        : undefined,
      warnings: contract.result ? warnings : [...warnings, "输出未遵守结果契约，已降级为原文摘要"],
    };
    // contract_violated 但有内容时仍视为可用结果
    if (result.status === "contract_violated" && result.summary.trim()) result.status = "ok";
    writeResult(runId, result);

    // 9) 线程记账
    if (threadId) {
      appendTurn(threadId, {
        at: Date.now(),
        backend,
        model,
        sessionRef,
        objective: spec.task.objective.slice(0, 500),
        resultSummary: result.summary.slice(0, 2000),
        files: bundle.files.map((f) => f.rel),
        cwd,
      });
    }
  } catch (err) {
    writeResult(runId, {
      status: "failed",
      summary: `worker 异常：${err instanceof Error ? err.message : String(err)}`,
      evidence: [],
      warnings,
    });
  } finally {
    clearInterval(heartbeatTimer);
    releaseSlot(backendSlot);
    releaseSlot(globalSlot);
  }
}
