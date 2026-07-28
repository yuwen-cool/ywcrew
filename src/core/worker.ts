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
import { createShadowDir } from "./shadow.js";
import { verifyEvidence } from "./evidence.js";

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
    // detached：backend CLI 可能拉起 MCP/浏览器等孙进程，超时必须终止整个进程组
    const child = spawn(binary, argv, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    const events = fs.createWriteStream(eventsFile, { flags: "a" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
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
      const friendly =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? `命令 ${binary} 未找到（未安装或不在 PATH）。`
          : String(err);
      resolve({ code: null, stdout, stderr: stderr + friendly, timedOut });
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

function setupWorktree(
  runId: string,
  sourceCwd: string,
): { wtDir: string; warnings: string[] } | undefined {
  const wtDir = path.join(paths.home, "worktrees", runId);
  const warnings: string[] = [];
  try {
    execFileSync("git", ["-C", sourceCwd, "rev-parse", "--git-dir"], { stdio: "pipe" });
    fs.mkdirSync(path.dirname(wtDir), { recursive: true });
    execFileSync("git", ["-C", sourceCwd, "worktree", "add", "--detach", wtDir], { stdio: "pipe" });
  } catch {
    return undefined; // 非 git 目录：edit 任务直接在原地跑（result 会带 warning）
  }

  // 物化未提交改动：worktree add 只快照 HEAD，用户正在写的代码必须同步过去，
  // 否则被调模型评审/修改的是旧代码（实测踩过：新文件对被调模型完全不可见）
  try {
    const dirty = execFileSync("git", ["-C", sourceCwd, "status", "--porcelain"], { encoding: "utf8" });
    if (dirty.trim()) {
      const diff = execFileSync("git", ["-C", sourceCwd, "diff", "HEAD", "--binary"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (diff.trim()) {
        execFileSync("git", ["-C", wtDir, "apply", "--binary", "--whitespace=nowarn"], { input: diff, stdio: ["pipe", "pipe", "pipe"] });
      }
      const untracked = execFileSync(
        "git",
        ["-C", sourceCwd, "ls-files", "--others", "--exclude-standard", "-z"],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      )
        .split("\0")
        .filter(Boolean);
      for (const rel of untracked) {
        const dest = path.join(wtDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(sourceCwd, rel), dest);
      }
      // 快照提交：让 collectPatch 的 diff 基线是「用户当前状态」，patch 只包含被调模型的改动
      execFileSync("git", ["-C", wtDir, "add", "-A"], { stdio: "pipe" });
      execFileSync(
        "git",
        ["-C", wtDir, "-c", "user.name=ywcrew", "-c", "user.email=snapshot@ywcrew.local", "commit", "-m", "ywcrew: dirty state snapshot", "--no-verify", "--quiet"],
        { stdio: "pipe" },
      );
    }
  } catch (err) {
    warnings.push(`未提交改动同步到 worktree 失败（被调模型看到的是 HEAD 版本）：${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
  return { wtDir, warnings };
}

function collectPatch(runId: string, wtDir: string): string | undefined {
  try {
    // add -N（intent-to-add）让被调模型新建的未跟踪文件也进入 diff
    execFileSync("git", ["-C", wtDir, "add", "-A", "-N"], { stdio: "pipe" });
    const patch = execFileSync("git", ["-C", wtDir, "diff", "HEAD", "--binary"], {
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

  // 0) 先登记进程身份 + 排队心跳：worker 若在排队期被杀，readRun 才能判死回收
  updateRun(runId, { workerPid: process.pid, workerIdentity: processIdentity(process.pid) });
  writeHeartbeat(runId);

  // 1) 排队获取并发 slot（backend 级 + 全局）
  const deadline = Date.now() + SLOT_WAIT_MAX_MS;
  let backendSlot: string | undefined;
  let globalSlot: string | undefined;
  while (Date.now() < deadline) {
    writeHeartbeat(runId);
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

    // 3) 上下文打包（永远从源目录取，shadow/worktree 都以此为基准）
    const sourceCwd = path.resolve(spec.cwd ?? process.cwd());
    const bundle = bundleFiles({ files: spec.files, cwd: sourceCwd }, config.defaults.tokenBudget);
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

    // 4) 工作目录与隔离决策
    let cwd = sourceCwd;
    let wtDir: string | undefined;
    if (continuation.mode === "native" && continuation.cwd && fs.existsSync(continuation.cwd)) {
      cwd = continuation.cwd;
    } else if (spec.strict && spec.mode === "read-only") {
      // 严格读取隔离：影子目录里只有白名单文件，权限档之外的硬边界
      cwd = createShadowDir(runId, bundle.files);
    } else {
      if (spec.strict) warnings.push("strict 仅对 read-only 任务生效，edit 任务走 worktree 隔离");
      const needsIsolation = spec.mode === "edit" || !adapter.capabilities.nativeReadOnly;
      if (needsIsolation) {
        const wt = setupWorktree(runId, sourceCwd);
        if (wt) {
          wtDir = wt.wtDir;
          cwd = wtDir;
          warnings.push(...wt.warnings);
        } else if (spec.mode === "edit") warnings.push("非 git 目录，edit 任务未做 worktree 隔离");
        else warnings.push(`${backend} 无原生只读档且非 git 目录，只读任务仅靠 prompt 约束`);
      }
    }

    // 5) 模型/强度：显式传入 > 配置默认；未知模型透传 + warning
    const model = spec.model ?? backendCfg?.defaultModel;
    const effort = adapter.capabilities.supportsEffort ? (spec.effort ?? backendCfg?.defaultEffort) : undefined;
    if (spec.effort && !adapter.capabilities.supportsEffort)
      warnings.push(`${backend} 不支持思考强度参数，已忽略 effort=${spec.effort}`);

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
      // 从源目录补充（strict 影子目录里没有白名单外的文件），secret guard 照常生效
      const extra = bundleFiles({ files: contract.needMoreContext.files, cwd: sourceCwd }, config.defaults.tokenBudget);
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
    // 任何未被归类的非零退出（含 spawn error 的 null）都是失败；
    // stdout 有文本只作为诊断线索，绝不能把失败运行包装成 ok
    if (outcome.code !== 0) {
      writeResult(runId, {
        status: "failed",
        summary: `${backend} 退出码 ${outcome.code ?? "null（进程启动失败）"}。stderr：${outcome.stderr.slice(0, 500)}${text.trim() ? `\n中断前的输出片段：${text.slice(0, 1000)}` : ""}`,
        evidence: [],
        session_ref: sessionRef,
        warnings,
      });
      return;
    }

    const patchFile = wtDir ? collectPatch(runId, wtDir) : undefined;
    const result: ResultContract = {
      status: contract.result ? "ok" : "contract_violated",
      summary: contract.result?.summary ?? text.slice(0, 6000),
      evidence: verifyEvidence(contract.result?.evidence ?? [], cwd),
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
