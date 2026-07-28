import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths } from "../config/paths.js";
import { readRun, readTask } from "./runs.js";

export interface GcReport {
  runsRemoved: string[];
  worktreesRemoved: string[];
  threadsRemoved: string[];
  kept: number;
}

/**
 * 惰性垃圾回收：
 * - 终态（done/failed/cancelled）且超龄的 run 目录
 * - 对应的 git worktree（先 git worktree remove 正确摘除，再兜底 rm）
 * - 最后一轮早于 threadDays 的线程文件
 * 保护规则：
 * - 运行中/排队中的 run 与其 worktree 永不回收
 * - 被非终态 run 引用的线程不回收（followup 正在路上）
 * - 被存活线程任何一轮 cwd 引用的 worktree 不回收（原生续聊的锚点目录）
 */
export function runGc(opts: { days?: number; threadDays?: number } = {}): GcReport {
  const days = opts.days ?? 7;
  const threadDays = opts.threadDays ?? 30;
  if (!Number.isFinite(days) || days < 0 || !Number.isFinite(threadDays) || threadDays < 0) {
    throw new Error(`gc 参数无效：days=${opts.days}, thread-days=${opts.threadDays}（必须是非负数字）`);
  }
  const runCutoff = Date.now() - days * 86_400_000;
  const threadCutoff = Date.now() - threadDays * 86_400_000;
  const report: GcReport = { runsRemoved: [], worktreesRemoved: [], threadsRemoved: [], kept: 0 };
  const wtRoot = path.join(paths.home, "worktrees");

  // 第一遍：决定 run 去留，同时收集活跃 run 引用的线程
  const activeThreadIds = new Set<string>();
  const runsToRemove: string[] = [];
  const runIds = fs.existsSync(paths.runs) ? fs.readdirSync(paths.runs) : [];
  for (const runId of runIds) {
    const meta = readRun(runId); // 顺带触发僵死 worker 惰性回收
    const dir = paths.runDir(runId);
    const terminal = !meta || meta.state === "done" || meta.state === "failed" || meta.state === "cancelled";
    if (!terminal && meta?.threadId) activeThreadIds.add(meta.threadId);
    const updatedAt = meta?.updatedAt ?? fs.statSync(dir).mtimeMs;
    if (!terminal || updatedAt > runCutoff) {
      report.kept++;
      continue;
    }
    runsToRemove.push(runId);
  }

  // 第二遍：回收线程（跳过被活跃 run 引用的）
  if (fs.existsSync(paths.threads)) {
    for (const f of fs.readdirSync(paths.threads)) {
      const threadId = f.replace(/\.json$/, "");
      if (activeThreadIds.has(threadId)) continue;
      const file = path.join(paths.threads, f);
      try {
        const thread = JSON.parse(fs.readFileSync(file, "utf8")) as { turns?: Array<{ at: number }> };
        const lastAt = thread.turns?.length ? thread.turns[thread.turns.length - 1].at : 0;
        if (lastAt < threadCutoff && fs.statSync(file).mtimeMs < threadCutoff) {
          fs.rmSync(file);
          report.threadsRemoved.push(threadId);
        }
      } catch {
        /* 损坏文件跳过，不误删 */
      }
    }
  }

  // 第三遍：收集存活线程仍在引用的 worktree（原生续聊必须回到原目录执行）
  const referencedWts = new Set<string>();
  if (fs.existsSync(paths.threads)) {
    for (const f of fs.readdirSync(paths.threads)) {
      try {
        const thread = JSON.parse(fs.readFileSync(path.join(paths.threads, f), "utf8")) as {
          turns?: Array<{ cwd?: string }>;
        };
        for (const turn of thread.turns ?? []) {
          if (turn.cwd?.startsWith(wtRoot + path.sep)) referencedWts.add(path.basename(turn.cwd));
        }
      } catch {
        /* skip */
      }
    }
  }

  // 第四遍：删 run 目录 + 未被引用的 worktree
  for (const runId of runsToRemove) {
    if (!referencedWts.has(runId)) removeWorktree(runId, report);
    fs.rmSync(paths.runDir(runId), { recursive: true, force: true });
    report.runsRemoved.push(runId);
  }

  // 孤儿 worktree（run 目录已不在，且无线程引用）
  if (fs.existsSync(wtRoot)) {
    for (const runId of fs.readdirSync(wtRoot)) {
      if (referencedWts.has(runId)) continue;
      if (!fs.existsSync(paths.runDir(runId)) && fs.statSync(path.join(wtRoot, runId)).mtimeMs < runCutoff) {
        removeWorktree(runId, report);
      }
    }
  }
  return report;
}

function removeWorktree(runId: string, report: GcReport): void {
  const wtDir = path.join(paths.home, "worktrees", runId);
  if (!fs.existsSync(wtDir)) return;
  const sourceCwd = readTask(runId)?.cwd;
  try {
    if (sourceCwd && fs.existsSync(sourceCwd)) {
      execFileSync("git", ["-C", sourceCwd, "worktree", "remove", "--force", wtDir], { stdio: "pipe" });
    } else {
      fs.rmSync(wtDir, { recursive: true, force: true });
    }
  } catch {
    fs.rmSync(wtDir, { recursive: true, force: true });
  }
  report.worktreesRemoved.push(runId);
}
