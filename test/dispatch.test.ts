import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-dispatch-home-"));
process.env.YWCREW_HOME = home;

const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-dispatch-proj-"));
fs.writeFileSync(path.join(proj, "a.ts"), "export const a = 1;\n");

// 每个测试文件独立 worker，此处 import 时 YWCREW_HOME 已生效
let dispatchTask: (spec: unknown) => unknown;

const validTask = {
  briefing: "TypeScript 项目，pnpm build 构建，vitest 测试框架，无其他依赖。",
  objective: "评审 a.ts 的导出设计是否合理，一句话结论即可。",
};

function writeFixtures(opts: { installed?: boolean; auth?: string; enabled?: boolean }) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, "capabilities.json"),
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      backends: {
        kimi: {
          installed: opts.installed ?? true,
          authState: opts.auth ?? "ok",
          models: [{ id: "kimi-code/k3", efforts: [], isDefault: true }],
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      version: 1,
      backends: { kimi: { enabled: opts.enabled ?? true, maxParallel: 2 } },
      defaults: { panel: [], maxParallelGlobal: 4, tokenBudget: 150000, routing: [] },
    }),
  );
}

beforeAll(async () => {
  ({ dispatchTask } = await import("../src/core/dispatch.js"));
});

describe("dispatch 前置拦截", () => {
  it("后端二进制不在 PATH → 派单时立即报错（实时检查，不信缓存）", () => {
    writeFixtures({ installed: true });
    const savedPath = process.env.PATH;
    process.env.PATH = "/nonexistent-bin-dir";
    try {
      expect(() =>
        dispatchTask({ backend: "kimi", task: validTask, cwd: proj, files: [] }),
      ).toThrow(/不在 PATH 中/);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it("后端未登录 → 派单时给出修复命令", () => {
    writeFixtures({ auth: "unauthenticated" });
    expect(() =>
      dispatchTask({ backend: "kimi", task: validTask, cwd: proj, files: [] }),
    ).toThrow(/未登录/);
  });

  it("cwd 不存在 → 立即报错", () => {
    writeFixtures({});
    expect(() =>
      dispatchTask({ backend: "kimi", task: validTask, cwd: "/nonexistent/path/xyz", files: [] }),
    ).toThrow(/cwd 不存在/);
  });

  it("files glob 零匹配 → 立即报错并列出 glob", () => {
    writeFixtures({});
    expect(() =>
      dispatchTask({ backend: "kimi", task: validTask, cwd: proj, files: ["src/**/*.rs"] }),
    ).toThrow(/没有匹配到任何文件/);
  });

  it("model 收到占位符文本 → 立即报错", () => {
    writeFixtures({});
    expect(() =>
      dispatchTask({ backend: "kimi", model: "（可选，覆盖默认）", task: validTask, cwd: proj, files: [] }),
    ).toThrow(/占位符/);
  });

  it("显式 thread 不存在 → 报错而非静默新建", () => {
    writeFixtures({});
    expect(() =>
      dispatchTask({ backend: "kimi", thread: "no-such-thread", task: validTask, cwd: proj, files: [] }),
    ).toThrow(/线程 no-such-thread 不存在/);
  });

  it("五段式不合格 → 报模板错误", () => {
    writeFixtures({});
    expect(() =>
      dispatchTask({ backend: "kimi", task: { briefing: "短", objective: "短" }, cwd: proj }),
    ).toThrow(/五段式/);
  });
});
