import type { Config, RoutingRule, BackendId } from "../config/schema.js";

/** 内置默认路由（按用户已启用的后端过滤；用户自定义 routing 非空时完全让位） */
const BUILTIN_ROUTING: Array<RoutingRule & { backend: BackendId }> = [
  { when: "疑难 bug 定位、需要精确读代码", use: "codex::high", backend: "codex" },
  { when: "架构评审、方案权衡、长推理", use: "claude", backend: "claude" },
  { when: "中文语料、长文理解、文案", use: "kimi", backend: "kimi" },
  { when: "快速第二意见、轻量核查", use: "grok::low", backend: "grok" },
  { when: "Claude/GPT 额度紧张时的替代通道", use: "agy", backend: "agy" },
];

export function parseUse(use: string): { backend: string; model?: string; effort?: string } {
  const [backend, model, effort] = use.split(":");
  return { backend, model: model || undefined, effort: effort || undefined };
}

/** 有效路由 = 用户自定义（原样尊重）或内置默认（过滤掉未启用的后端） */
export function effectiveRouting(config: Config): RoutingRule[] {
  if (config.defaults.routing.length > 0) return config.defaults.routing;
  return BUILTIN_ROUTING.filter((r) => config.backends[r.backend]?.enabled).map(({ when, use }) => ({
    when,
    use,
  }));
}
