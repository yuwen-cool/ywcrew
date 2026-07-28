import { describe, expect, it } from "vitest";
import { ConfigSchema, CapabilitiesCacheSchema } from "../src/config/schema.js";
import { effectiveRouting, parseUse } from "../src/install/routing.js";
import { renderDynamicSections } from "../src/install/skill-render.js";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return ConfigSchema.parse({
    version: 1,
    backends: {
      codex: { enabled: true, maxParallel: 2 },
      kimi: { enabled: true, maxParallel: 2 },
      grok: { enabled: false, maxParallel: 2 },
    },
    ...overrides,
  });
}

describe("路由表", () => {
  it("内置默认按已启用后端过滤：禁用的 grok 不出现", () => {
    const routing = effectiveRouting(makeConfig());
    const backends = routing.map((r) => parseUse(r.use).backend);
    expect(backends).toContain("codex");
    expect(backends).toContain("kimi");
    expect(backends).not.toContain("grok");
    expect(backends).not.toContain("claude");
  });

  it("用户自定义规则完全覆盖内置默认", () => {
    const config = makeConfig({
      defaults: {
        panel: [],
        maxParallelGlobal: 4,
        tokenBudget: 150000,
        routing: [{ when: "所有任务", use: "kimi" }],
      },
    });
    const routing = effectiveRouting(config);
    expect(routing).toEqual([{ when: "所有任务", use: "kimi" }]);
  });

  it("parseUse 解析 backend[:model][:effort]", () => {
    expect(parseUse("codex::high")).toEqual({ backend: "codex", model: undefined, effort: "high" });
    expect(parseUse("agy:claude-sonnet-4-6")).toEqual({
      backend: "agy",
      model: "claude-sonnet-4-6",
      effort: undefined,
    });
  });
});

describe("技能动态渲染", () => {
  const caps = CapabilitiesCacheSchema.parse({
    fetchedAt: new Date().toISOString(),
    backends: {
      codex: { installed: true, authState: "ok", models: [{ id: "gpt-5.6", efforts: ["high"], isDefault: true }] },
      kimi: { installed: true, authState: "ok", models: [] },
    },
  });

  it("只渲染已启用的后端，禁用的不出现", () => {
    const out = renderDynamicSections(makeConfig(), caps);
    expect(out).toContain("| codex |");
    expect(out).toContain("| kimi |");
    expect(out).not.toContain("| grok |");
  });

  it("自定义路由时标注「用户自定义路由，严格遵守」", () => {
    const config = makeConfig({
      defaults: { panel: [], maxParallelGlobal: 4, tokenBudget: 150000, routing: [{ when: "全部", use: "kimi" }] },
    });
    const out = renderDynamicSections(config, caps);
    expect(out).toContain("用户自定义路由，严格遵守");
    expect(out).toContain("`kimi`");
  });

  it("无任何启用后端时返回空（保底文案由 install 层处理）", () => {
    const config = ConfigSchema.parse({ version: 1 });
    expect(renderDynamicSections(config, caps)).toBe("");
  });
});
