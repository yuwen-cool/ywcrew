import { BACKEND_IDS, type CapabilitiesCache, type Config } from "../config/schema.js";
import { adapters } from "../adapters/registry.js";
import { effectiveRouting } from "./routing.js";

/**
 * 按用户真实环境渲染 SKILL.md 的动态段落。
 * 原则：技能里只出现用户实际启用的后端——宿主 agent 永远不会被引导去调一个不存在的模型。
 */
export function renderDynamicSections(config: Config, caps: CapabilitiesCache | undefined): string {
  const enabled = BACKEND_IDS.filter((id) => config.backends[id]?.enabled);
  if (enabled.length === 0) return "";

  const backendRows = enabled
    .map((id) => {
      const cfg = config.backends[id]!;
      const models = caps?.backends[id]?.models.map((m) => m.id) ?? [];
      const effort = adapters[id].capabilities.supportsEffort ? "low/medium/high" : "不支持";
      return `| ${id} | ${cfg.defaultModel ?? "后端默认"} | ${models.length ? models.join(", ") : "运行时透传"} | ${effort} |`;
    })
    .join("\n");

  const routingRows = effectiveRouting(config)
    .map((r) => `| ${r.when} | \`${r.use}\` |`)
    .join("\n");

  const panel = config.defaults.panel.length ? config.defaults.panel.join(", ") : "（未配置，panel 需传 --members）";

  return `## 本机实际可用的后端（按此调用，勿引用不在表中的后端）

| 后端 | 默认模型 | 可用模型 | 思考强度 |
| --- | --- | --- | --- |
${backendRows}

评审面板（panel）默认成员：${panel}

## 调用目标怎么选（${config.defaults.routing.length ? "用户自定义路由，严格遵守" : "默认路由"}）

| 任务类型 | 派给 |
| --- | --- |
${routingRows}

\`use\` 格式 \`backend[:model][:effort]\`；用户当场点名了模型/厂商则永远服从用户。
`;
}
