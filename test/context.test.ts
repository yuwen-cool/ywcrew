import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleFiles, renderPrompt } from "../src/context/builder.js";
import { TaskSpecSchema } from "../src/config/schema.js";
import { planContinuation, createThread, appendTurn } from "../src/core/threads.js";

process.env.YWCREW_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-home-"));

const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-proj-"));
fs.mkdirSync(path.join(proj, "src"), { recursive: true });
fs.writeFileSync(path.join(proj, "src/a.ts"), "export const a = 1;\n");
fs.writeFileSync(path.join(proj, "src/b.test.ts"), "test\n");
fs.writeFileSync(path.join(proj, ".env"), "SECRET=x\n");

describe("bundleFiles", () => {
  it("glob 展开 + ! 排除 + secret 拒绝", () => {
    const r = bundleFiles({ files: ["src/**/*.ts", "!**/*.test.ts", ".env"], cwd: proj }, 100_000);
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.rel)).toEqual(["src/a.ts"]);
    expect(r.skipped.some((s) => s.reason.includes("凭据"))).toBe(true);
  });
  it("超预算不静默截断，返回 per-file 报告", () => {
    fs.writeFileSync(path.join(proj, "src/big.ts"), "x".repeat(50_000));
    const r = bundleFiles({ files: ["src/big.ts"], cwd: proj }, 1_000);
    expect(r.ok).toBe(false);
    expect(r.overBudgetReport).toContain("src/big.ts");
  });
});

describe("renderPrompt", () => {
  it("五段式 + 文件块 + 默认契约", () => {
    const spec = TaskSpecSchema.parse({
      backend: "kimi",
      task: {
        briefing: "TypeScript 项目，pnpm build 构建，vitest 测试框架。",
        objective: "评审 src/a.ts 的导出设计是否合理，给出结论。",
      },
      files: ["src/a.ts"],
      cwd: proj,
    });
    const bundle = bundleFiles(spec, 100_000);
    const prompt = renderPrompt(spec, bundle);
    expect(prompt).toContain("零背景");
    expect(prompt).toContain("=== FILE: src/a.ts ===");
    expect(prompt).toContain("need_more_context");
  });
});

describe("planContinuation 路由", () => {
  it("同后端有 sessionRef 走 native", () => {
    const t = createThread();
    appendTurn(t.threadId, {
      at: Date.now(),
      backend: "codex",
      sessionRef: "s-1",
      objective: "o",
      resultSummary: "r",
      files: [],
    });
    expect(planContinuation(t.threadId, "codex")).toEqual({ mode: "native", sessionRef: "s-1" });
  });
  it("跨后端 rebuild 且时间正序", () => {
    const t = createThread();
    appendTurn(t.threadId, { at: 1, backend: "codex", objective: "第一轮问题", resultSummary: "第一轮结论", files: [] });
    appendTurn(t.threadId, { at: 2, backend: "codex", sessionRef: "s", objective: "第二轮问题", resultSummary: "第二轮结论", files: [] });
    const plan = planContinuation(t.threadId, "kimi");
    expect(plan.mode).toBe("rebuild");
    if (plan.mode === "rebuild") {
      expect(plan.historyBlock.indexOf("第一轮")).toBeLessThan(plan.historyBlock.indexOf("第二轮"));
    }
  });
});
