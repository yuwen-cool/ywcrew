import readline from "node:readline/promises";
import { BACKEND_IDS, ConfigSchema, type BackendId, type Config } from "../config/schema.js";
import { adapters } from "../adapters/registry.js";
import { saveConfig, ensureHome } from "../config/load.js";
import { probeAll } from "./probe.js";
import { installSkills } from "../install/hosts.js";

export async function runInit(): Promise<void> {
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const config: Config = ConfigSchema.parse({});

  console.log("\n② 逐个配置后端（回车接受默认）\n");
  for (const id of BACKEND_IDS) {
    const b = caps.backends[id];
    if (!b?.installed) continue;
    const enable = (await rl.question(`启用 ${id}？[Y/n] `)).trim().toLowerCase();
    if (enable === "n") {
      config.backends[id] = { enabled: false, maxParallel: 2 };
      continue;
    }
    const defaultCandidate = b.models.find((m) => m.isDefault)?.id ?? b.models[0]?.id;
    const modelAns = (
      await rl.question(`  ${id} 默认模型 [${defaultCandidate ?? "后端自身默认"}]${b.models.length ? `（可选: ${b.models.map((m) => m.id).join(", ")}）` : ""}: `)
    ).trim();
    const supportsEffort = adapters[id].capabilities.supportsEffort;
    let effort: "low" | "medium" | "high" | undefined;
    if (supportsEffort) {
      const e = (await rl.question(`  ${id} 默认思考强度 low/medium/high [medium]: `)).trim();
      effort = e === "low" || e === "high" ? e : "medium";
    }
    config.backends[id] = {
      enabled: true,
      defaultModel: modelAns || defaultCandidate,
      defaultEffort: effort,
      maxParallel: id === "grok" || id === "agy" ? 1 : 2,
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
  const panelAns = (
    await rl.question(`  用逗号分隔 [${enabledIds.slice(0, 3).join(",")}]: `)
  ).trim();
  config.defaults.panel = panelAns ? panelAns.split(",").map((s) => s.trim()) : enabledIds.slice(0, 3);

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
