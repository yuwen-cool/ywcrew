import readline from "node:readline/promises";
import { BACKEND_IDS, ConfigSchema, type BackendId, type Config } from "../config/schema.js";
import { adapters } from "../adapters/registry.js";
import { saveConfig, loadConfig, ensureHome } from "../config/load.js";
import { probeAll } from "./probe.js";
import { installSkills } from "../install/hosts.js";

export async function runInit(opts: { yes?: boolean } = {}): Promise<void> {
  ensureHome();
  console.log("ywcrew 初始化\n");
  console.log("① 探测本地 agent CLI…");
  const caps = await probeAll();

  for (const id of BACKEND_IDS) {
    const b = caps.backends[id];
    if (!b) continue;
    const auth =
      b.authState === "ok" ? "已登录" : b.authState === "unauthenticated" ? `未登录（修复：${adapters[id].loginCommand}）` : "登录态未知";
    console.log(
      `  ${b.installed ? "✅" : "❌"} ${id.padEnd(7)} ${b.version ?? ""} ${b.installed ? `| ${auth} | 模型 ${b.models.length} 个` : "未安装"}`,
    );
  }

  // --yes：非交互模式（供智能体自举安装）。启用所有已安装且非未登录的后端，
  // 全部采用探测默认；已有配置的字段一律保留，绝不覆盖用户偏好。
  if (opts.yes) {
    let config: Config;
    try {
      config = loadConfig();
    } catch {
      config = ConfigSchema.parse({});
    }
    for (const id of BACKEND_IDS) {
      const b = caps.backends[id];
      if (!b?.installed || b.authState === "unauthenticated") continue;
      const existing = config.backends[id];
      if (existing) continue; // 用户配过的不动
      config.backends[id] = {
        enabled: true,
        defaultModel: b.models.find((m) => m.isDefault)?.id ?? b.models[0]?.id,
        defaultEffort: adapters[id].capabilities.supportsEffort ? "medium" : undefined,
        maxParallel: id === "grok" || id === "agy" ? 1 : 2,
      };
    }
    const enabled = (Object.entries(config.backends) as Array<[BackendId, { enabled: boolean }]>)
      .filter(([, c]) => c.enabled)
      .map(([id]) => id);
    if (enabled.length === 0) {
      console.error("\n没有可启用的后端（未安装或未登录）。装好任一 agent CLI 并登录后重试。");
      process.exitCode = 1;
      return;
    }
    if (config.defaults.panel.length === 0) config.defaults.panel = enabled.slice(0, 3);
    saveConfig(config);
    console.log(`\n✅ 已启用: ${enabled.join(", ")}（配置写入 ~/.ywcrew/config.json，可随时 ywcrew init 交互调整）`);
    installSkills();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // 从既有配置起步：重跑 init 只更新向导覆盖的项，自定义路由/预算等偏好原样保留
  let config: Config;
  try {
    config = loadConfig();
  } catch {
    config = ConfigSchema.parse({});
    console.log("⚠️  现有配置文件不合法，本次将重建（自定义路由等偏好需重新设置）");
  }
  if (config.defaults.routing.length > 0) {
    console.log(`（检测到 ${config.defaults.routing.length} 条自定义路由规则，将原样保留）`);
  }

  console.log("\n② 逐个配置后端（回车接受默认）\n");
  for (const id of BACKEND_IDS) {
    const b = caps.backends[id];
    if (!b?.installed) continue;
    const existing = config.backends[id];
    const enable = (await rl.question(`启用 ${id}？[${existing?.enabled === false ? "y/N" : "Y/n"}] `)).trim().toLowerCase();
    const enabled = enable === "" ? existing?.enabled !== false : enable !== "n";
    if (!enabled) {
      config.backends[id] = { ...existing, enabled: false, maxParallel: existing?.maxParallel ?? 2 };
      continue;
    }
    // 回车沿用用户此前的选择；从未配置过才落到探测出的默认
    const defaultCandidate = existing?.defaultModel ?? b.models.find((m) => m.isDefault)?.id ?? b.models[0]?.id;
    const modelAns = (
      await rl.question(`  ${id} 默认模型 [${defaultCandidate ?? "后端自身默认"}]${b.models.length ? `（可选: ${b.models.map((m) => m.id).join(", ")}）` : ""}: `)
    ).trim();
    const supportsEffort = adapters[id].capabilities.supportsEffort;
    let effort: "low" | "medium" | "high" | undefined = existing?.defaultEffort;
    if (supportsEffort) {
      const prev = existing?.defaultEffort ?? "medium";
      const e = (await rl.question(`  ${id} 默认思考强度 low/medium/high [${prev}]: `)).trim();
      effort = e === "low" || e === "medium" || e === "high" ? e : prev;
    }
    config.backends[id] = {
      enabled: true,
      defaultModel: modelAns || defaultCandidate,
      defaultEffort: effort,
      maxParallel: existing?.maxParallel ?? (id === "grok" || id === "agy" ? 1 : 2),
    };
  }

  const enabledIds = (Object.entries(config.backends) as Array<[BackendId, { enabled: boolean }]>)
    .filter(([, c]) => c.enabled)
    .map(([id]) => id);
  if (enabledIds.length === 0) {
    console.log("\n没有启用任何后端，配置未保存。");
    rl.close();
    return;
  }

  console.log("\n③ 多模型评审面板（panel）默认成员");
  const panelDefault = config.defaults.panel.length > 0 ? config.defaults.panel : enabledIds.slice(0, 3);
  const panelAns = (await rl.question(`  用逗号分隔 [${panelDefault.join(",")}]: `)).trim();
  config.defaults.panel = panelAns ? panelAns.split(",").map((s) => s.trim()) : panelDefault;

  saveConfig(config);
  console.log("\n✅ 配置已写入 ~/.ywcrew/config.json");

  const installAns = (await rl.question("\n④ 现在把技能分发到各宿主（Cursor/Claude Code/Codex 等）？[Y/n] ")).trim().toLowerCase();
  rl.close();
  if (installAns !== "n") {
    installSkills();
  } else {
    console.log("之后可随时运行: ywcrew install");
  }
  console.log('\n完成。在任意宿主里试一句："用 ywcrew 让 kimi 评审这个文件"');
}
