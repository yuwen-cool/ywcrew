import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-gc-home-"));
process.env.YWCREW_HOME = home;

let runGc: typeof import("../src/core/gc.js").runGc;

function makeRun(runId: string, state: string, ageMs: number) {
  const dir = path.join(home, "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  const at = Date.now() - ageMs;
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({ runId, state, createdAt: at, updatedAt: at, threadId: "t" }),
  );
}

beforeAll(async () => {
  ({ runGc } = await import("../src/core/gc.js"));
});

describe("gc", () => {
  it("回收超龄终态 run，保留运行中与新近的", () => {
    makeRun("old-done", "done", 10 * 86_400_000);
    makeRun("old-failed", "failed", 10 * 86_400_000);
    makeRun("fresh-done", "done", 1 * 86_400_000);
    makeRun("old-running", "running", 10 * 86_400_000);

    const report = runGc({ days: 7 });
    expect(report.runsRemoved.sort()).toEqual(["old-done", "old-failed"]);
    expect(fs.existsSync(path.join(home, "runs", "fresh-done"))).toBe(true);
    // old-running 的僵死回收由 readRun 判定（无心跳会被置 failed），但本轮不按 done 超龄删
    expect(fs.existsSync(path.join(home, "runs", "old-running"))).toBe(true);
  });

  it("回收孤儿 worktree", () => {
    const wt = path.join(home, "worktrees", "ghost-run");
    fs.mkdirSync(wt, { recursive: true });
    const old = new Date(Date.now() - 10 * 86_400_000);
    fs.utimesSync(wt, old, old);

    const report = runGc({ days: 7 });
    expect(report.worktreesRemoved).toContain("ghost-run");
    expect(fs.existsSync(wt)).toBe(false);
  });

  it("回收不活跃线程，保留活跃线程", () => {
    const threads = path.join(home, "threads");
    fs.mkdirSync(threads, { recursive: true });
    const oldFile = path.join(threads, "old-thread.json");
    fs.writeFileSync(oldFile, JSON.stringify({ turns: [{ at: Date.now() - 40 * 86_400_000 }] }));
    const oldTime = new Date(Date.now() - 40 * 86_400_000);
    fs.utimesSync(oldFile, oldTime, oldTime);
    fs.writeFileSync(path.join(threads, "live-thread.json"), JSON.stringify({ turns: [{ at: Date.now() }] }));

    const report = runGc({ threadDays: 30 });
    expect(report.threadsRemoved).toContain("old-thread");
    expect(fs.existsSync(path.join(threads, "live-thread.json"))).toBe(true);
  });
});
