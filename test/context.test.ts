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

  it("read-only 模式带只读声明与 agentic 环境说明", () => {
    const spec = TaskSpecSchema.parse({
      backend: "kimi",
      mode: "read-only",
      task: {
        briefing: "TypeScript 项目，pnpm build 构建，vitest 测试框架。",
        objective: "评审 src/a.ts 的导出设计是否合理，给出结论。",
      },
      files: [],
      cwd: proj,
    });
    const prompt = renderPrompt(spec, bundleFiles(spec, 100_000));
    expect(prompt).toContain("只读：不得修改");
    expect(prompt).toContain("agentic 方式运行在项目工作目录");
  });

  it("edit 模式带改代码声明", () => {
    const spec = TaskSpecSchema.parse({
      backend: "codex",
      mode: "edit",
      task: {
        briefing: "TypeScript 项目，pnpm build 构建，vitest 测试框架。",
        objective: "把 src/a.ts 的导出常量重命名为 alpha 并同步引用。",
      },
      files: [],
      cwd: proj,
    });
    const prompt = renderPrompt(spec, bundleFiles(spec, 100_000));
    expect(prompt).toContain("允许改代码");
    expect(prompt).toContain("patch 收集交付");
  });

  it("自定义 output_contract 叠加在 JSON 契约之上而非替换", () => {
    const spec = TaskSpecSchema.parse({
      backend: "kimi",
      task: {
        briefing: "TypeScript 项目，pnpm build 构建，vitest 测试框架。",
        objective: "评审 src/a.ts 的导出设计是否合理，给出结论。",
        output_contract: "按严重级别排序的问题列表",
      },
      files: [],
      cwd: proj,
    });
    const prompt = renderPrompt(spec, bundleFiles(spec, 100_000));
    expect(prompt).toContain('"summary"'); // JSON 契约仍在
    expect(prompt).toContain("need_more_context");
    expect(prompt).toContain("按严重级别排序的问题列表"); // 用户契约嵌入 summary 要求
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
