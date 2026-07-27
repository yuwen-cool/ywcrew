import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../src/adapters/claude.js";
import { codexAdapter } from "../src/adapters/codex.js";
import { grokAdapter } from "../src/adapters/grok.js";
import { kimiAdapter } from "../src/adapters/kimi.js";
import { agyAdapter, decomposeAgyModel } from "../src/adapters/agy.js";
import type { DispatchRequest } from "../src/adapters/types.js";

const req: DispatchRequest = {
  prompt: "回复 OK",
  model: undefined,
  effort: "high",
  mode: "read-only",
  cwd: "/tmp/proj",
};

describe("codex argv 顺序（全局参数必须在 exec 之前）", () => {
  it("dispatch", () => {
    const spec = codexAdapter.planDispatch({ ...req, model: "gpt-5.6-sol" });
    const execIdx = spec.argv.indexOf("exec");
    expect(execIdx).toBeGreaterThan(0);
    for (const flag of ["-a", "-s", "-C", "-m", "-c"]) {
      expect(spec.argv.indexOf(flag)).toBeLessThan(execIdx);
    }
    expect(spec.argv.slice(execIdx)).toContain("--json");
    expect(spec.stdin).toBe("回复 OK");
  });
  it("resume 在 exec 之后紧跟", () => {
    const spec = codexAdapter.planResume("sess-1", req);
    const execIdx = spec.argv.indexOf("exec");
    expect(spec.argv[execIdx + 1]).toBe("resume");
    expect(spec.argv[execIdx + 2]).toBe("sess-1");
  });
  it("解析真实事件流（thread.started / item.completed）", () => {
    const out = [
      '{"type":"thread.started","thread_id":"019fa528-f19f"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"最终结论"}}',
      '{"type":"turn.completed","usage":{"input_tokens":17705,"output_tokens":74}}',
    ].join("\n");
    expect(codexAdapter.extractSessionRef(out)).toBe("019fa528-f19f");
    expect(codexAdapter.extractText(out)).toBe("最终结论");
  });
});

describe("claude", () => {
  it("绝不包含 --bare；只读用 plan", () => {
    const spec = claudeAdapter.planDispatch(req);
    expect(spec.argv).not.toContain("--bare");
    expect(spec.argv).toContain("plan");
  });
  it("resume 前置", () => {
    const spec = claudeAdapter.planResume("s1", req);
    expect(spec.argv[0]).toBe("--resume");
  });
  it("从 stream 输出提取 session 与结果", () => {
    const out = '{"type":"system","session_id":"abc-123"}\n{"type":"result","result":"done"}';
    expect(claudeAdapter.extractSessionRef(out)).toBe("abc-123");
    expect(claudeAdapter.extractText(out)).toBe("done");
  });
});

describe("grok", () => {
  it("只读用 plan、写用 auto，禁 subagents", () => {
    expect(grokAdapter.planDispatch(req).argv).toContain("plan");
    expect(grokAdapter.planDispatch({ ...req, mode: "edit" }).argv).toContain("auto");
    expect(grokAdapter.planDispatch(req).argv).toContain("--no-subagents");
  });
  it("未登录识别", () => {
    expect(grokAdapter.classifyError("You are not authenticated.", 1)).toBe("auth_required");
  });
  it("解析真实 JSON 信封（text/sessionId/usage）", () => {
    const out = JSON.stringify({
      text: "结论文本",
      stopReason: "EndTurn",
      sessionId: "019fa52e-9078-79c0-83c7-6d08ff7a941f",
      usage: { input_tokens: 15214, output_tokens: 573 },
    });
    expect(grokAdapter.extractText(out)).toBe("结论文本");
    expect(grokAdapter.extractSessionRef(out)).toBe("019fa52e-9078-79c0-83c7-6d08ff7a941f");
    expect(grokAdapter.extractUsage?.(out)).toEqual({ inputTokens: 15214, outputTokens: 573 });
  });
});

describe("kimi", () => {
  it("-p 模式不带任何权限 flag（实测 --plan/--auto/--yolo 全互斥）", () => {
    for (const mode of ["edit", "read-only"] as const) {
      const spec = kimiAdapter.planDispatch({ ...req, mode });
      for (const banned of ["--auto", "--yolo", "--plan"]) expect(spec.argv).not.toContain(banned);
    }
  });
  it("resume 用 -r + session_ 前缀 ID（实测官方提示格式）", () => {
    const spec = kimiAdapter.planResume("session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", req);
    expect(spec.argv[0]).toBe("-r");
    expect(
      kimiAdapter.extractSessionRef("To resume this session: kimi -r session_d13ac547-9c31-41f6-848f-8d82bfea4e27"),
    ).toBe("session_d13ac547-9c31-41f6-848f-8d82bfea4e27");
  });
  it("声明无原生只读 → worker 会 worktree 兜底", () => {
    expect(kimiAdapter.capabilities.nativeReadOnly).toBe(false);
  });
});

describe("agy 模型归一化", () => {
  it("拆解强度后缀", () => {
    expect(decomposeAgyModel("gemini-3.1-pro-high")).toEqual({ base: "gemini-3.1-pro", effort: "high" });
    expect(decomposeAgyModel("claude-sonnet-4-6")).toEqual({ base: "claude-sonnet-4-6" });
  });
  it("base 名 + effort 重组完整型号", () => {
    const spec = agyAdapter.planDispatch({ ...req, model: "gemini-3.1-pro", effort: "low" });
    expect(spec.argv).toContain("gemini-3.1-pro-low");
  });
  it("完整型号原样透传（忽略冲突 effort）", () => {
    const spec = agyAdapter.planDispatch({ ...req, model: "gemini-3.6-flash-medium", effort: "high" });
    expect(spec.argv).toContain("gemini-3.6-flash-medium");
  });
  it("识别实测登录过期文案", () => {
    expect(agyAdapter.classifyError("Error: authentication required. Run 'agy' to log in, then retry.", 1)).toBe(
      "auth_required",
    );
  });
});
