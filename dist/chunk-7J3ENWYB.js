// src/install/routing.ts
var BUILTIN_ROUTING = [
  { when: "\u7591\u96BE bug \u5B9A\u4F4D\u3001\u9700\u8981\u7CBE\u786E\u8BFB\u4EE3\u7801", use: "codex::high", backend: "codex" },
  { when: "\u67B6\u6784\u8BC4\u5BA1\u3001\u65B9\u6848\u6743\u8861\u3001\u957F\u63A8\u7406", use: "claude", backend: "claude" },
  { when: "\u4E2D\u6587\u8BED\u6599\u3001\u957F\u6587\u7406\u89E3\u3001\u6587\u6848", use: "kimi", backend: "kimi" },
  { when: "\u5FEB\u901F\u7B2C\u4E8C\u610F\u89C1\u3001\u8F7B\u91CF\u6838\u67E5", use: "grok::low", backend: "grok" },
  { when: "Claude/GPT \u989D\u5EA6\u7D27\u5F20\u65F6\u7684\u66FF\u4EE3\u901A\u9053", use: "agy", backend: "agy" }
];
function parseUse(use) {
  const [backend, model, effort] = use.split(":");
  return { backend, model: model || void 0, effort: effort || void 0 };
}
function effectiveRouting(config) {
  if (config.defaults.routing.length > 0) return config.defaults.routing;
  return BUILTIN_ROUTING.filter((r) => config.backends[r.backend]?.enabled).map(({ when, use }) => ({
    when,
    use
  }));
}

export {
  parseUse,
  effectiveRouting
};
//# sourceMappingURL=chunk-7J3ENWYB.js.map