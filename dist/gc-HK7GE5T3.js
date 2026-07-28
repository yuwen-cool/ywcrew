import {
  readRun,
  readTask
} from "./chunk-IFU773SE.js";
import {
  paths
} from "./chunk-QEBUZYAA.js";

// src/core/gc.ts
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
function runGc(opts = {}) {
  const days = opts.days ?? 7;
  const threadDays = opts.threadDays ?? 30;
  if (!Number.isFinite(days) || days < 0 || !Number.isFinite(threadDays) || threadDays < 0) {
    throw new Error(`gc \u53C2\u6570\u65E0\u6548\uFF1Adays=${opts.days}, thread-days=${opts.threadDays}\uFF08\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57\uFF09`);
  }
  const runCutoff = Date.now() - days * 864e5;
  const threadCutoff = Date.now() - threadDays * 864e5;
  const report = { runsRemoved: [], worktreesRemoved: [], threadsRemoved: [], kept: 0 };
  const wtRoot = path.join(paths.home, "worktrees");
  const activeThreadIds = /* @__PURE__ */ new Set();
  const runsToRemove = [];
  const runIds = fs.existsSync(paths.runs) ? fs.readdirSync(paths.runs) : [];
  for (const runId of runIds) {
    const meta = readRun(runId);
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
  if (fs.existsSync(paths.threads)) {
    for (const f of fs.readdirSync(paths.threads)) {
      const threadId = f.replace(/\.json$/, "");
      if (activeThreadIds.has(threadId)) continue;
      const file = path.join(paths.threads, f);
      try {
        const thread = JSON.parse(fs.readFileSync(file, "utf8"));
        const lastAt = thread.turns?.length ? thread.turns[thread.turns.length - 1].at : 0;
        if (lastAt < threadCutoff && fs.statSync(file).mtimeMs < threadCutoff) {
          fs.rmSync(file);
          report.threadsRemoved.push(threadId);
        }
      } catch {
      }
    }
  }
  const shadowRoot = path.join(paths.home, "shadow");
  const referencedWts = /* @__PURE__ */ new Set();
  if (fs.existsSync(paths.threads)) {
    for (const f of fs.readdirSync(paths.threads)) {
      try {
        const thread = JSON.parse(fs.readFileSync(path.join(paths.threads, f), "utf8"));
        for (const turn of thread.turns ?? []) {
          if (turn.cwd?.startsWith(wtRoot + path.sep) || turn.cwd?.startsWith(shadowRoot + path.sep))
            referencedWts.add(path.basename(turn.cwd));
        }
      } catch {
      }
    }
  }
  for (const runId of runsToRemove) {
    if (!referencedWts.has(runId)) {
      removeWorktree(runId, report);
      fs.rmSync(path.join(shadowRoot, runId), { recursive: true, force: true });
    }
    fs.rmSync(paths.runDir(runId), { recursive: true, force: true });
    report.runsRemoved.push(runId);
  }
  for (const root of [wtRoot, shadowRoot]) {
    if (!fs.existsSync(root)) continue;
    for (const runId of fs.readdirSync(root)) {
      if (referencedWts.has(runId)) continue;
      if (!fs.existsSync(paths.runDir(runId)) && fs.statSync(path.join(root, runId)).mtimeMs < runCutoff) {
        if (root === wtRoot) removeWorktree(runId, report);
        else {
          fs.rmSync(path.join(root, runId), { recursive: true, force: true });
          report.worktreesRemoved.push(runId);
        }
      }
    }
  }
  return report;
}
function removeWorktree(runId, report) {
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
export {
  runGc
};
//# sourceMappingURL=gc-HK7GE5T3.js.map