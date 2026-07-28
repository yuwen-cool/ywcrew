#!/usr/bin/env node
import {
  effectiveRouting
} from "./chunk-7J3ENWYB.js";
import {
  dispatchTask
} from "./chunk-QNRVPUHT.js";
import {
  adapters,
  getThread
} from "./chunk-JTDLTURC.js";
import {
  BACKEND_IDS,
  ConfigSchema,
  ensureHome,
  loadCapabilities,
  loadConfig,
  saveCapabilities,
  saveConfig
} from "./chunk-A6PGVESN.js";
import {
  listRuns,
  readResult,
  readRun
} from "./chunk-IFU773SE.js";
import "./chunk-QEBUZYAA.js";

// src/cli.ts
import fs2 from "fs";
import { Command } from "commander";

// src/wizard/init.ts
import readline from "readline/promises";

// src/wizard/probe.ts
async function probeAll() {
  const cache = { fetchedAt: (/* @__PURE__ */ new Date()).toISOString(), backends: {} };
  await Promise.all(
    BACKEND_IDS.map(async (id) => {
      const adapter = adapters[id];
      const probe = await adapter.probe();
      let models = [];
      if (probe.installed) {
        try {
          models = await adapter.listModels();
        } catch {
        }
      }
      cache.backends[id] = {
        installed: probe.installed,
        version: probe.version,
        authState: probe.authState,
        models
      };
    })
  );
  saveCapabilities(cache);
  return cache;
}

// src/install/hosts.ts
import fs from "fs";
import os from "os";
import path from "path";

// src/install/skill-render.ts
function renderDynamicSections(config, caps) {
  const enabled = BACKEND_IDS.filter((id) => config.backends[id]?.enabled);
  if (enabled.length === 0) return "";
  const backendRows = enabled.map((id) => {
    const cfg = config.backends[id];
    const models = caps?.backends[id]?.models.map((m) => m.id) ?? [];
    const effort = adapters[id].capabilities.supportsEffort ? "low/medium/high" : "\u4E0D\u652F\u6301";
    return `| ${id} | ${cfg.defaultModel ?? "\u540E\u7AEF\u9ED8\u8BA4"} | ${models.length ? models.join(", ") : "\u8FD0\u884C\u65F6\u900F\u4F20"} | ${effort} |`;
  }).join("\n");
  const routingRows = effectiveRouting(config).map((r) => `| ${r.when} | \`${r.use}\` |`).join("\n");
  const panel = config.defaults.panel.length ? config.defaults.panel.join(", ") : "\uFF08\u672A\u914D\u7F6E\uFF0Cpanel \u9700\u4F20 --members\uFF09";
  return `## \u672C\u673A\u5B9E\u9645\u53EF\u7528\u7684\u540E\u7AEF\uFF08\u6309\u6B64\u8C03\u7528\uFF0C\u52FF\u5F15\u7528\u4E0D\u5728\u8868\u4E2D\u7684\u540E\u7AEF\uFF09

| \u540E\u7AEF | \u9ED8\u8BA4\u6A21\u578B | \u53EF\u7528\u6A21\u578B | \u601D\u8003\u5F3A\u5EA6 |
| --- | --- | --- | --- |
${backendRows}

\u8BC4\u5BA1\u9762\u677F\uFF08panel\uFF09\u9ED8\u8BA4\u6210\u5458\uFF1A${panel}

## \u8C03\u7528\u76EE\u6807\u600E\u4E48\u9009\uFF08${config.defaults.routing.length ? "\u7528\u6237\u81EA\u5B9A\u4E49\u8DEF\u7531\uFF0C\u4E25\u683C\u9075\u5B88" : "\u9ED8\u8BA4\u8DEF\u7531"}\uFF09

| \u4EFB\u52A1\u7C7B\u578B | \u6D3E\u7ED9 |
| --- | --- |
${routingRows}

\`use\` \u683C\u5F0F \`backend[:model][:effort]\`\uFF1B\u7528\u6237\u5F53\u573A\u70B9\u540D\u4E86\u6A21\u578B/\u5382\u5546\u5219\u6C38\u8FDC\u670D\u4ECE\u7528\u6237\u3002
`;
}

// src/install/hosts.ts
function detectHosts() {
  const home = os.homedir();
  const unified = path.join(home, ".agents", "skills");
  const candidates = [
    { name: "Cursor", skillDir: path.join(home, ".cursor", "skills") },
    { name: "Claude Code", skillDir: path.join(home, ".claude", "skills") },
    { name: "Codex", skillDir: path.join(home, ".codex", "skills") },
    { name: "Grok", skillDir: path.join(home, ".grok", "skills") },
    { name: "Kimi", skillDir: path.join(home, ".kimi-code", "skills") }
  ];
  return {
    unified: fs.existsSync(unified) ? unified : void 0,
    hosts: candidates.filter((h) => fs.existsSync(h.skillDir))
  };
}
function skillSourceDir() {
  const entry = fs.realpathSync(process.argv[1]);
  return path.resolve(path.dirname(entry), "..", "skills", "ywcrew");
}
function copySkill(targetParent) {
  const target = path.join(targetParent, "ywcrew");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(skillSourceDir(), target, { recursive: true });
  try {
    const config = loadConfig();
    const caps = loadCapabilities();
    const dynamic = renderDynamicSections(config, caps);
    const skillFile = path.join(target, "SKILL.md");
    const content = fs.readFileSync(skillFile, "utf8");
    if (dynamic) {
      fs.writeFileSync(skillFile, content.replace("<!-- YWCREW:DYNAMIC -->", dynamic.trim()));
    } else {
      fs.writeFileSync(
        skillFile,
        content.replace(
          "<!-- YWCREW:DYNAMIC -->",
          "## \u540E\u7AEF\u4E0E\u8DEF\u7531\n\n\u5C1A\u672A\u914D\u7F6E\u3002\u5148\u8BA9\u7528\u6237\u8FD0\u884C `ywcrew init`\uFF0C\u518D\u7528 `ywcrew backends` \u67E5\u8BE2\u53EF\u7528\u540E\u7AEF\u3002"
        )
      );
    }
  } catch {
  }
}
function installSkills() {
  const { unified, hosts } = detectHosts();
  if (unified) {
    copySkill(unified);
    console.log(`\u2705 \u68C0\u6D4B\u5230\u7EDF\u4E00 skills \u76EE\u5F55\uFF0C\u5DF2\u653E\u7F6E: ${unified}/ywcrew`);
    console.log("   \uFF08\u5982\u679C\u4F60\u7684\u540C\u6B65\u5DE5\u5177\u6CA1\u6709\u81EA\u52A8\u5206\u53D1\u5230\u5404\u5BBF\u4E3B\uFF0C\u53EF\u518D\u8FD0\u884C ywcrew install --each\uFF09");
    if (!process.argv.includes("--each")) return;
  }
  if (hosts.length === 0 && !unified) {
    const created = [];
    const home = os.homedir();
    const roots = [
      { name: "Cursor", skillDir: path.join(home, ".cursor", "skills") },
      { name: "Claude Code", skillDir: path.join(home, ".claude", "skills") },
      { name: "Codex", skillDir: path.join(home, ".codex", "skills") },
      { name: "Grok", skillDir: path.join(home, ".grok", "skills") },
      { name: "Kimi", skillDir: path.join(home, ".kimi-code", "skills") }
    ];
    for (const h of roots) {
      if (fs.existsSync(path.dirname(h.skillDir))) {
        fs.mkdirSync(h.skillDir, { recursive: true });
        created.push(h);
      }
    }
    if (created.length > 0) {
      for (const h of created) {
        copySkill(h.skillDir);
        console.log(`\u2705 ${h.name}: \u5DF2\u521B\u5EFA skills \u76EE\u5F55\u5E76\u653E\u7F6E\u6280\u80FD \u2192 ${h.skillDir}/ywcrew`);
      }
      return;
    }
    console.log("\u26A0\uFE0F  \u672A\u53D1\u73B0\u4EFB\u4F55\u5BBF\u4E3B\uFF08Cursor/Claude Code/Codex/Grok/Kimi \u7684\u914D\u7F6E\u76EE\u5F55\u90FD\u4E0D\u5B58\u5728\uFF09\u3002");
    console.log(`   \u6280\u80FD\u6E90\u6587\u4EF6\u5728: ${skillSourceDir()}`);
    console.log("   \u88C5\u597D\u5BBF\u4E3B\u540E\u91CD\u65B0\u8FD0\u884C ywcrew install \u5373\u53EF\uFF1B\u6216\u624B\u52A8\u590D\u5236\u4E0A\u8FF0\u76EE\u5F55\u5230\u5BBF\u4E3B\u7684 skills \u76EE\u5F55\u3002");
    return;
  }
  for (const h of hosts) {
    copySkill(h.skillDir);
    console.log(`\u2705 ${h.name}: ${h.skillDir}/ywcrew`);
  }
}
function doctorHosts() {
  const { unified, hosts } = detectHosts();
  console.log("\u5BBF\u4E3B\u88C5\u8F7D\u72B6\u6001\uFF1A");
  if (unified) {
    const ok = fs.existsSync(path.join(unified, "ywcrew", "SKILL.md"));
    console.log(`  ${ok ? "\u2705" : "\u274C"} \u7EDF\u4E00\u76EE\u5F55 ${unified} ${ok ? "" : "\uFF08\u8FD0\u884C ywcrew install \u4FEE\u590D\uFF09"}`);
  }
  for (const h of hosts) {
    const ok = fs.existsSync(path.join(h.skillDir, "ywcrew", "SKILL.md"));
    console.log(`  ${ok ? "\u2705" : "\u274C"} ${h.name} ${h.skillDir} ${ok ? "" : "\uFF08\u8FD0\u884C ywcrew install \u4FEE\u590D\uFF09"}`);
  }
}

// src/wizard/init.ts
function printQuickstart(enabled) {
  console.log(`
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2705 ywcrew \u88C5\u597D\u4E86\u3002\u73B0\u5728\u5BF9\u4F60\u7684 AI \u667A\u80FD\u4F53\uFF08Cursor / Claude Code / Codex / Grok / Kimi \u4EFB\u610F\u4E00\u4E2A\uFF09\u76F4\u63A5\u8BF4\uFF1A

   \u300C\u7528 ywcrew \u8BA9 ${enabled.includes("kimi") ? "kimi" : enabled[0]} \u8BC4\u5BA1\u8FD9\u4E2A\u6587\u4EF6\u300D
   \u300C\u8BA9${enabled.includes("codex") ? " GPT \u7528\u6700\u9AD8\u601D\u8003\u5F3A\u5EA6" : ` ${enabled[0]} `}\u67E5\u4E00\u4E0B\u8FD9\u4E2A bug\u300D
   \u300C\u5F00\u4E2A\u8BC4\u5BA1\u4F1A\uFF0C\u591A\u627E\u51E0\u4E2A\u6A21\u578B\u5BF9\u6BD4\u4E00\u4E0B\u8FD9\u4E24\u4E2A\u65B9\u6848\u300D

\u667A\u80FD\u4F53\u4F1A\u81EA\u52A8\u8BFB\u53D6\u5DF2\u5206\u53D1\u7684 ywcrew \u6280\u80FD\u5B8C\u6210\u6D3E\u5355\uFF0C\u4F60\u4E0D\u9700\u8981\u8BB0\u4EFB\u4F55\u547D\u4EE4\u3002

\u5982\u679C\u4F60\u662F\u66FF\u7528\u6237\u5B89\u88C5\u7684 AI\uFF1A\u8BF7\u628A\u4E0A\u9762\u4E09\u4E2A\u793A\u4F8B\u8F6C\u544A\u7528\u6237\uFF1B\u672C\u6B21\u4F1A\u8BDD\u4E2D\u4F60\u4E5F\u53EF\u4EE5
\u76F4\u63A5\u8FD0\u884C ywcrew \u547D\u4EE4\uFF08ywcrew template \u770B\u4EFB\u52A1\u6A21\u677F\uFF0Cywcrew backends \u770B\u53EF\u7528\u6A21\u578B\uFF09\u3002

\u5E38\u7528\u81EA\u67E5\uFF1A
   ywcrew doctor       # \u4F53\u68C0\uFF1A\u54EA\u4E9B\u540E\u7AEF\u53EF\u7528\u3001\u767B\u5F55\u6001\u3001\u6280\u80FD\u662F\u5426\u88C5\u8F7D
   ywcrew route list   # \u67E5\u770B/\u81EA\u5B9A\u4E49"\u4EC0\u4E48\u4EFB\u52A1\u6D3E\u7ED9\u8C01"\u7684\u8DEF\u7531\u504F\u597D
   ywcrew init         # \u4EA4\u4E92\u5F0F\u91CD\u65B0\u914D\u7F6E\u9ED8\u8BA4\u6A21\u578B\uFF08\u4E0D\u4F1A\u8986\u76D6\u4F60\u7684\u81EA\u5B9A\u4E49\u504F\u597D\uFF09
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
}
async function runInit(opts = {}) {
  ensureHome();
  console.log("ywcrew \u521D\u59CB\u5316\n");
  console.log("\u2460 \u63A2\u6D4B\u672C\u5730 agent CLI\u2026");
  const caps = await probeAll();
  for (const id of BACKEND_IDS) {
    const b = caps.backends[id];
    if (!b) continue;
    const auth = b.authState === "ok" ? "\u5DF2\u767B\u5F55" : b.authState === "unauthenticated" ? `\u672A\u767B\u5F55\uFF08\u4FEE\u590D\uFF1A${adapters[id].loginCommand}\uFF09` : "\u767B\u5F55\u6001\u672A\u77E5";
    console.log(
      `  ${b.installed ? "\u2705" : "\u274C"} ${id.padEnd(7)} ${b.version ?? ""} ${b.installed ? `| ${auth} | \u6A21\u578B ${b.models.length} \u4E2A` : "\u672A\u5B89\u88C5"}`
    );
  }
  if (opts.yes) {
    let config2;
    try {
      config2 = loadConfig();
    } catch {
      config2 = ConfigSchema.parse({});
    }
    for (const id of BACKEND_IDS) {
      const b = caps.backends[id];
      if (!b?.installed || b.authState === "unauthenticated") continue;
      const existing = config2.backends[id];
      if (existing) continue;
      config2.backends[id] = {
        enabled: true,
        defaultModel: b.models.find((m) => m.isDefault)?.id ?? b.models[0]?.id,
        defaultEffort: adapters[id].capabilities.supportsEffort ? "medium" : void 0,
        maxParallel: id === "grok" || id === "agy" ? 1 : 2
      };
    }
    const enabled = Object.entries(config2.backends).filter(([, c]) => c.enabled).map(([id]) => id);
    if (enabled.length === 0) {
      console.error("\n\u6CA1\u6709\u53EF\u542F\u7528\u7684\u540E\u7AEF\uFF08\u672A\u5B89\u88C5\u6216\u672A\u767B\u5F55\uFF09\u3002\u88C5\u597D\u4EFB\u4E00 agent CLI \u5E76\u767B\u5F55\u540E\u91CD\u8BD5\u3002");
      process.exitCode = 1;
      return;
    }
    if (config2.defaults.panel.length === 0) config2.defaults.panel = enabled.slice(0, 3);
    saveConfig(config2);
    console.log(`
\u2705 \u5DF2\u542F\u7528: ${enabled.join(", ")}\uFF08\u914D\u7F6E\u5199\u5165 ~/.ywcrew/config.json\uFF09`);
    installSkills();
    printQuickstart(enabled);
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let config;
  try {
    config = loadConfig();
  } catch {
    config = ConfigSchema.parse({});
    console.log("\u26A0\uFE0F  \u73B0\u6709\u914D\u7F6E\u6587\u4EF6\u4E0D\u5408\u6CD5\uFF0C\u672C\u6B21\u5C06\u91CD\u5EFA\uFF08\u81EA\u5B9A\u4E49\u8DEF\u7531\u7B49\u504F\u597D\u9700\u91CD\u65B0\u8BBE\u7F6E\uFF09");
  }
  if (config.defaults.routing.length > 0) {
    console.log(`\uFF08\u68C0\u6D4B\u5230 ${config.defaults.routing.length} \u6761\u81EA\u5B9A\u4E49\u8DEF\u7531\u89C4\u5219\uFF0C\u5C06\u539F\u6837\u4FDD\u7559\uFF09`);
  }
  console.log("\n\u2461 \u9010\u4E2A\u914D\u7F6E\u540E\u7AEF\uFF08\u56DE\u8F66\u63A5\u53D7\u9ED8\u8BA4\uFF09\n");
  for (const id of BACKEND_IDS) {
    const b = caps.backends[id];
    if (!b?.installed) continue;
    const existing = config.backends[id];
    const enable = (await rl.question(`\u542F\u7528 ${id}\uFF1F[${existing?.enabled === false ? "y/N" : "Y/n"}] `)).trim().toLowerCase();
    const enabled = enable === "" ? existing?.enabled !== false : enable !== "n";
    if (!enabled) {
      config.backends[id] = { ...existing, enabled: false, maxParallel: existing?.maxParallel ?? 2 };
      continue;
    }
    const defaultCandidate = existing?.defaultModel ?? b.models.find((m) => m.isDefault)?.id ?? b.models[0]?.id;
    const modelAns = (await rl.question(`  ${id} \u9ED8\u8BA4\u6A21\u578B [${defaultCandidate ?? "\u540E\u7AEF\u81EA\u8EAB\u9ED8\u8BA4"}]${b.models.length ? `\uFF08\u53EF\u9009: ${b.models.map((m) => m.id).join(", ")}\uFF09` : ""}: `)).trim();
    const supportsEffort = adapters[id].capabilities.supportsEffort;
    let effort = existing?.defaultEffort;
    if (supportsEffort) {
      const prev = existing?.defaultEffort ?? "medium";
      const e = (await rl.question(`  ${id} \u9ED8\u8BA4\u601D\u8003\u5F3A\u5EA6 low/medium/high [${prev}]: `)).trim();
      effort = e === "low" || e === "medium" || e === "high" ? e : prev;
    }
    config.backends[id] = {
      enabled: true,
      defaultModel: modelAns || defaultCandidate,
      defaultEffort: effort,
      maxParallel: existing?.maxParallel ?? (id === "grok" || id === "agy" ? 1 : 2)
    };
  }
  const enabledIds = Object.entries(config.backends).filter(([, c]) => c.enabled).map(([id]) => id);
  if (enabledIds.length === 0) {
    console.log("\n\u6CA1\u6709\u542F\u7528\u4EFB\u4F55\u540E\u7AEF\uFF0C\u914D\u7F6E\u672A\u4FDD\u5B58\u3002");
    rl.close();
    return;
  }
  console.log("\n\u2462 \u591A\u6A21\u578B\u8BC4\u5BA1\u9762\u677F\uFF08panel\uFF09\u9ED8\u8BA4\u6210\u5458");
  const panelDefault = config.defaults.panel.length > 0 ? config.defaults.panel : enabledIds.slice(0, 3);
  const panelAns = (await rl.question(`  \u7528\u9017\u53F7\u5206\u9694 [${panelDefault.join(",")}]: `)).trim();
  config.defaults.panel = panelAns ? panelAns.split(",").map((s) => s.trim()) : panelDefault;
  saveConfig(config);
  console.log("\n\u2705 \u914D\u7F6E\u5DF2\u5199\u5165 ~/.ywcrew/config.json");
  const installAns = (await rl.question("\n\u2463 \u73B0\u5728\u628A\u6280\u80FD\u5206\u53D1\u5230\u5404\u5BBF\u4E3B\uFF08Cursor/Claude Code/Codex \u7B49\uFF09\uFF1F[Y/n] ")).trim().toLowerCase();
  rl.close();
  if (installAns !== "n") {
    installSkills();
  } else {
    console.log("\u4E4B\u540E\u53EF\u968F\u65F6\u8FD0\u884C: ywcrew install");
  }
  printQuickstart(enabledIds);
}

// src/cli.ts
var program = new Command();
program.name("ywcrew").description("\u628A\u4EFB\u52A1\u6D3E\u7ED9\u4F60\u672C\u5730\u8BA2\u9605\u7684 AI agents\uFF08claude/codex/grok/kimi/agy\uFF09").version("0.1.0");
program.addHelpText(
  "after",
  `
\u4E0A\u624B\uFF08\u666E\u901A\u7528\u6237\u4E0D\u9700\u8981\u8BB0\u547D\u4EE4\uFF0C\u5BF9\u4F60\u7684\u667A\u80FD\u4F53\u8BF4\u8BDD\u5373\u53EF\uFF09\uFF1A
  \u300C\u7528 ywcrew \u8BA9 kimi \u8BC4\u5BA1\u8FD9\u4E2A\u6587\u4EF6\u300D
  \u300C\u8BA9 GPT \u7528\u6700\u9AD8\u601D\u8003\u5F3A\u5EA6\u67E5\u4E00\u4E0B\u8FD9\u4E2A bug\u300D
  \u300C\u5F00\u4E2A\u8BC4\u5BA1\u4F1A\uFF0C\u591A\u627E\u51E0\u4E2A\u6A21\u578B\u5BF9\u6BD4\u8FD9\u4E24\u4E2A\u65B9\u6848\u300D

\u5BBF\u4E3B agent \u6D3E\u5355\u4E09\u6B65\uFF08\u8BE6\u89C1\u5DF2\u5206\u53D1\u7684 ywcrew \u6280\u80FD\uFF09\uFF1A
  1. echo '<\u4EFB\u52A1 JSON>' | ywcrew run --stdin     # ywcrew template \u770B\u6A21\u677F
  2. ywcrew result <runId> --wait                # \u963B\u585E\u53D6\u7ED3\u6784\u5316\u7ED3\u8BBA
  3. ywcrew followup <threadId> "\u8FFD\u95EE\u2026"          # \u8DE8\u8F6E\u7EED\u804A

\u9996\u6B21\u4F7F\u7528 / \u6392\u969C\uFF1Aywcrew init \xB7 ywcrew doctor`
);
var TEMPLATE = {
  backend: "kimi",
  mode: "read-only",
  task: {
    briefing: "\u9879\u76EE\u80CC\u666F\uFF1A\u6280\u672F\u6808\u3001\u6784\u5EFA/\u6D4B\u8BD5\u547D\u4EE4\u3002\u88AB\u8C03\u6A21\u578B\u5BF9\u9879\u76EE\u96F6\u77E5\u8BC6\uFF0C\u5199\u5168\u3002",
    locations: "\u5173\u952E\u4EE3\u7801\u5728\u54EA\uFF1A\u5165\u53E3\u3001\u6A21\u5757\u8DEF\u5F84",
    objective: "\u786E\u5207\u7684\u95EE\u9898 + \u5DF2\u5C1D\u8BD5\u8FC7\u4EC0\u4E48 + \u539F\u59CB\u62A5\u9519\u5168\u6587",
    constraints: "\u4E0D\u8BB8\u6539\u54EA\u4E9B\u6587\u4EF6\u3001\u4E0D\u8BB8\u505A\u4EC0\u4E48",
    output_contract: "\u671F\u671B\u7684\u8F93\u51FA\u5F62\u6001\uFF1A\u5982\u6309\u4E25\u91CD\u7EA7\u522B\u6392\u5E8F\u7684\u95EE\u9898\u5217\u8868\uFF0C\u6BCF\u6761\u5E26\u6587\u4EF6:\u884C\u53F7"
  },
  files: ["src/**/*.ts", "!**/*.test.ts"],
  label: "lock \u5E76\u53D1\u8BC4\u5BA1"
};
function printDispatch(outcome) {
  console.log(JSON.stringify({ runId: outcome.run.runId, threadId: outcome.threadId, warnings: outcome.warnings }));
}
program.command("run").description("\u6D3E\u4E00\u4E2A\u4EFB\u52A1\uFF08--task-file \u6216 --stdin \u4F20\u4E94\u6BB5\u5F0F JSON\uFF09").option("--task-file <path>", "\u4EFB\u52A1 JSON \u6587\u4EF6").option("--stdin", "\u4ECE stdin \u8BFB\u4EFB\u52A1 JSON").action(async (opts) => {
  if (!opts.taskFile && !opts.stdin) {
    console.error("\u9700\u8981 --task-file \u6216 --stdin\u3002\u6A21\u677F: ywcrew template");
    process.exit(2);
  }
  try {
    const raw = opts.taskFile ? fs2.readFileSync(opts.taskFile, "utf8") : fs2.readFileSync(0, "utf8");
    printDispatch(dispatchTask(JSON.parse(raw)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      err.code === "ENOENT" && opts.taskFile ? `\u4EFB\u52A1\u6587\u4EF6\u4E0D\u5B58\u5728: ${opts.taskFile}` : msg
    );
    process.exit(1);
  }
});
program.command("panel").description("\u591A\u6A21\u578B\u5E76\u884C\u8BC4\u5BA1\uFF1A\u540C\u4E00\u4EFB\u52A1\u53D1\u7ED9 panel \u7684\u6240\u6709\u6210\u5458").option("--task-file <path>", "\u4EFB\u52A1 JSON \u6587\u4EF6\uFF08\u4E0D\u542B backend \u5B57\u6BB5\uFF09").option("--stdin", "\u4ECE stdin \u8BFB\u4EFB\u52A1 JSON").option("--members <list>", "\u8986\u76D6\u9ED8\u8BA4\u6210\u5458\uFF0C\u5982 claude,codex:gpt-5.6-sol,kimi").action((opts) => {
  if (!opts.taskFile && !opts.stdin) {
    console.error("\u9700\u8981 --task-file \u6216 --stdin\u3002\u6A21\u677F: ywcrew template");
    process.exit(2);
  }
  let base;
  try {
    const raw = opts.taskFile ? fs2.readFileSync(opts.taskFile, "utf8") : fs2.readFileSync(0, "utf8");
    base = JSON.parse(raw);
  } catch (err) {
    console.error(`\u4EFB\u52A1 JSON \u8BFB\u53D6/\u89E3\u6790\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}\u3002\u6A21\u677F: ywcrew template`);
    process.exit(1);
  }
  if (base.mode === "edit") {
    console.error("panel \u53EA\u652F\u6301 read-only\uFF08\u5E76\u884C\u8BC4\u5BA1\uFF09\u3002\u8981\u505A\u6539\u4EE3\u7801\u7ADE\u8D5B\uFF0C\u8BF7\u5206\u522B\u7528 ywcrew run \u6D3E\u591A\u4E2A mode:edit \u4EFB\u52A1\u3002");
    process.exit(2);
  }
  const config = loadConfig();
  const members = (opts.members?.split(",") ?? config.defaults.panel).map((s) => s.trim()).filter(Boolean);
  if (members.length < 2) {
    console.error("panel \u81F3\u5C11\u9700\u8981 2 \u4E2A\u6210\u5458\uFF08ywcrew init \u914D\u7F6E\u9ED8\u8BA4\u6210\u5458\uFF0C\u6216\u4F20 --members\uFF09");
    process.exit(2);
  }
  const results = [];
  const skipped = [];
  for (const member of members) {
    const [backend, model] = member.split(":");
    try {
      const outcome = dispatchTask({ ...base, backend, model: model || void 0, mode: "read-only" });
      results.push({ member, runId: outcome.run.runId, threadId: outcome.threadId });
    } catch (err) {
      skipped.push({ member, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  if (results.length === 0) {
    console.error(`panel \u5168\u90E8\u6210\u5458\u4E0D\u53EF\u7528\uFF1A
${skipped.map((s) => `  ${s.member}: ${s.reason}`).join("\n")}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ panel: results, skipped }, null, 2));
});
program.command("followup").description("\u5728\u65E2\u6709\u7EBF\u7A0B\u4E0A\u8FFD\u95EE\uFF08\u540C\u540E\u7AEF\u8D70\u539F\u751F resume\uFF0C\u8DE8\u540E\u7AEF\u81EA\u52A8\u91CD\u5EFA\u5386\u53F2\uFF09").argument("<threadId>").argument("<prompt>").option("--backend <id>", "\u5207\u6362\u540E\u7AEF\uFF08\u9ED8\u8BA4\u6CBF\u7528\u7EBF\u7A0B\u6700\u540E\u4E00\u8F6E\uFF09").option("--model <m>").action((threadId, prompt, opts) => {
  const thread = getThread(threadId);
  if (!thread || thread.turns.length === 0) {
    console.error(`\u7EBF\u7A0B ${threadId} \u4E0D\u5B58\u5728\u6216\u4E3A\u7A7A\uFF08ywcrew run \u6D3E\u4EFB\u52A1\u65F6\u4F1A\u8FD4\u56DE\u65B0\u7684 threadId\uFF09`);
    process.exit(1);
  }
  const last = thread.turns[thread.turns.length - 1];
  const spec = {
    backend: opts.backend ?? last.backend,
    model: opts.model,
    mode: "read-only",
    thread: threadId,
    cwd: last.cwd,
    task: {
      briefing: "\uFF08\u7EED\u804A\uFF09\u9879\u76EE\u80CC\u666F\u4E0E\u6B64\u524D\u7ED3\u8BBA\u89C1\u300C\u6B64\u524D\u7684\u8BA8\u8BBA\u7EBF\u7A0B\u300D\u4E00\u8282\uFF0C\u52FF\u91CD\u65B0\u81EA\u6211\u4ECB\u7ECD\u3002",
      objective: prompt.length >= 20 ? prompt : `${prompt}\uFF08\u7EED\u63A5\u4E0A\u6587\uFF0C\u9488\u5BF9\u6B64\u524D\u7ED3\u8BBA\u56DE\u5E94\uFF09`
    },
    files: []
  };
  printDispatch(dispatchTask(spec));
});
program.command("status").description("\u67E5\u8BE2 run \u72B6\u6001\uFF08\u542B\u50F5\u6B7B worker \u60F0\u6027\u56DE\u6536\uFF09").argument("[runId]").action((runId) => {
  if (runId) {
    const meta = readRun(runId);
    if (!meta) {
      console.error(`run ${runId} \u4E0D\u5B58\u5728`);
      process.exit(1);
    }
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(
      JSON.stringify(
        listRuns().map((m) => ({ runId: m.runId, state: m.state, backend: m.backend, label: m.label })),
        null,
        2
      )
    );
  }
});
program.command("result").description("\u8BFB\u53D6 run \u7684\u7ED3\u6784\u5316\u7ED3\u8BBA\uFF08--wait \u963B\u585E\u7B49\u5F85\u5B8C\u6210\uFF09").argument("<runIds...>", "\u4E00\u4E2A\u6216\u591A\u4E2A runId\uFF08\u591A\u4E2A\u65F6\u8FD4\u56DE\u6570\u7EC4\uFF0C\u914D\u5408 panel \u7528\uFF09").option("--wait", "\u963B\u585E\u76F4\u5230\u5168\u90E8\u5B8C\u6210\u6216\u8D85\u65F6").option("--timeout <seconds>", "\u7B49\u5F85\u4E0A\u9650\u79D2\u6570", "600").action(async (runIds, opts) => {
  const missing = runIds.filter((id) => !readRun(id));
  if (missing.length > 0) {
    console.error(`run \u4E0D\u5B58\u5728: ${missing.join(", ")}\uFF08ywcrew status \u53EF\u5217\u51FA\u8FD1\u671F run\uFF09`);
    process.exit(1);
  }
  const deadline = Date.now() + Number(opts.timeout) * 1e3;
  const collect = () => runIds.map((runId) => {
    const meta = readRun(runId);
    const result = readResult(runId);
    return result ? { runId, ...result } : { runId, pending: true, state: meta?.state ?? "unknown" };
  });
  let results = collect();
  if (opts.wait) {
    while (results.some((r) => "pending" in r && r.pending) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3e3));
      results = collect();
    }
  }
  console.log(JSON.stringify(runIds.length === 1 ? results[0] : results, null, 2));
  if (results.some((r) => "pending" in r && r.pending)) process.exit(3);
});
program.command("template").description("\u6253\u5370\u4E94\u6BB5\u5F0F\u4EFB\u52A1\u6A21\u677F").action(() => {
  console.log(JSON.stringify(TEMPLATE, null, 2));
});
program.command("init").description("\u9996\u6B21\u914D\u7F6E\u5411\u5BFC\uFF08--yes \u975E\u4EA4\u4E92\uFF0C\u4F9B\u667A\u80FD\u4F53\u81EA\u4E3E\u5B89\u88C5\uFF09").option("--yes", "\u8DF3\u8FC7\u4EA4\u4E92\uFF1A\u542F\u7528\u6240\u6709\u5DF2\u5B89\u88C5\u4E14\u5DF2\u767B\u5F55\u7684\u540E\u7AEF\uFF0C\u91C7\u7528\u9ED8\u8BA4\u914D\u7F6E\uFF1B\u4E0D\u8986\u76D6\u5DF2\u6709\u504F\u597D").action((opts) => runInit(opts));
program.command("refresh").description("\u91CD\u65B0\u63A2\u6D4B\u540E\u7AEF\u4E0E\u6A21\u578B\u6E05\u5355\uFF0C\u5E76\u91CD\u6E32\u67D3\u5404\u5BBF\u4E3B\u6280\u80FD").action(async () => {
  const caps = await probeAll();
  console.log(JSON.stringify(caps, null, 2));
  try {
    installSkills();
  } catch {
  }
});
program.command("doctor").description("\u4F53\u68C0\uFF1A\u540E\u7AEF\u53EF\u7528\u6027\u3001\u767B\u5F55\u6001\u3001\u5BBF\u4E3B\u88C5\u8F7D").action(async () => {
  const caps = await probeAll();
  const config = loadConfig();
  console.log("\u540E\u7AEF\u72B6\u6001\uFF1A");
  for (const id of BACKEND_IDS) {
    const b = caps.backends[id];
    if (!b) continue;
    const enabled = config.backends[id]?.enabled ? "\u5DF2\u542F\u7528" : "\u672A\u542F\u7528";
    const auth = b.authState === "ok" ? "\u5DF2\u767B\u5F55" : b.authState === "unauthenticated" ? `\u2757\u672A\u767B\u5F55 \u2192 ${adapters[id].loginCommand}` : "\u767B\u5F55\u6001\u672A\u77E5";
    console.log(
      `  ${b.installed ? "\u2705" : "\u274C"} ${id.padEnd(7)} ${b.installed ? `${b.version ?? ""} | ${enabled} | ${auth} | \u53EA\u8BFB\u673A\u5236: ${adapters[id].capabilities.readOnlyMechanism}` : "\u672A\u5B89\u88C5"}`
    );
  }
  console.log();
  doctorHosts();
});
program.command("install").description("\u628A\u6280\u80FD\u5206\u53D1\u5230\u5404\u5BBF\u4E3B skills \u76EE\u5F55\uFF08\u6309\u5F53\u524D\u914D\u7F6E\u6E32\u67D3\u8DEF\u7531\u8868\uFF09").option("--each", "\u7EDF\u4E00\u76EE\u5F55\u4E4B\u5916\u4E5F\u9010\u5BBF\u4E3B\u5206\u53D1").action(() => installSkills());
var route = program.command("route").description("\u67E5\u770B/\u81EA\u5B9A\u4E49\u4EFB\u52A1\u8DEF\u7531\u504F\u597D\uFF08\u5199\u8FDB\u5404\u5BBF\u4E3B\u6280\u80FD\uFF09");
route.command("list").description("\u67E5\u770B\u5F53\u524D\u751F\u6548\u7684\u8DEF\u7531\u8868").action(async () => {
  const { effectiveRouting: effectiveRouting2 } = await import("./routing-OMMYOMHJ.js");
  const config = loadConfig();
  const custom = config.defaults.routing.length > 0;
  console.log(custom ? "\uFF08\u7528\u6237\u81EA\u5B9A\u4E49\uFF09" : "\uFF08\u5185\u7F6E\u9ED8\u8BA4\uFF0C\u6309\u5DF2\u542F\u7528\u540E\u7AEF\u8FC7\u6EE4\uFF09");
  for (const r of effectiveRouting2(config)) console.log(`  ${r.when}  \u2192  ${r.use}`);
});
route.command("add").description('\u65B0\u589E\u4E00\u6761\u81EA\u5B9A\u4E49\u89C4\u5219\uFF0C\u5982 ywcrew route add "\u6027\u80FD\u4F18\u5316" "codex::high"').argument("<when>", "\u4EFB\u52A1\u7C7B\u578B\u63CF\u8FF0").argument("<use>", "backend[:model][:effort]").action(async (when, use) => {
  const { saveConfig: saveConfig2 } = await import("./load-NJ3ITFY7.js");
  const config = loadConfig();
  config.defaults.routing.push({ when, use });
  saveConfig2(config);
  installSkills();
  console.log(`\u2705 \u5DF2\u6DFB\u52A0\u5E76\u91CD\u65B0\u6E32\u67D3\u6280\u80FD\uFF1A${when} \u2192 ${use}`);
});
route.command("clear").description("\u6E05\u7A7A\u81EA\u5B9A\u4E49\u89C4\u5219\uFF0C\u56DE\u5230\u5185\u7F6E\u9ED8\u8BA4").action(async () => {
  const { saveConfig: saveConfig2 } = await import("./load-NJ3ITFY7.js");
  const config = loadConfig();
  config.defaults.routing = [];
  saveConfig2(config);
  installSkills();
  console.log("\u2705 \u5DF2\u6062\u590D\u5185\u7F6E\u9ED8\u8BA4\u8DEF\u7531\u5E76\u91CD\u65B0\u6E32\u67D3\u6280\u80FD");
});
program.command("gc").description("\u6E05\u7406\u8D85\u9F84\u7684\u5DF2\u5B8C\u6210 run\u3001worktree \u4E0E\u4E0D\u6D3B\u8DC3\u7EBF\u7A0B").option("--days <n>", "run/worktree \u4FDD\u7559\u5929\u6570", "7").option("--thread-days <n>", "\u7EBF\u7A0B\u4FDD\u7559\u5929\u6570", "30").action(async (opts) => {
  const { runGc } = await import("./gc-HK7GE5T3.js");
  const report = runGc({ days: Number(opts.days), threadDays: Number(opts.threadDays) });
  console.log(
    `\u2705 \u5DF2\u6E05\u7406 ${report.runsRemoved.length} \u4E2A run\u3001${report.worktreesRemoved.length} \u4E2A worktree\u3001${report.threadsRemoved.length} \u4E2A\u7EBF\u7A0B\uFF1B\u4FDD\u7559 ${report.kept} \u4E2A run`
  );
});
program.command("backends").description("\u5217\u51FA\u540E\u7AEF\u4E0E\u53EF\u7528\u6A21\u578B\uFF08\u4F9B\u5BBF\u4E3B agent \u67E5\u8BE2\uFF09").action(() => {
  const caps = loadCapabilities();
  const config = loadConfig();
  if (!caps) {
    console.error("\u5C1A\u672A\u63A2\u6D4B\uFF0C\u5148\u8FD0\u884C ywcrew refresh \u6216 ywcrew init");
    process.exit(1);
  }
  const out = BACKEND_IDS.map((id) => ({
    backend: id,
    enabled: config.backends[id]?.enabled ?? false,
    defaultModel: config.backends[id]?.defaultModel,
    auth: caps.backends[id]?.authState,
    models: caps.backends[id]?.models ?? [],
    supportsEffort: adapters[id].capabilities.supportsEffort
  }));
  console.log(JSON.stringify(out, null, 2));
});
program.command("__worker", { hidden: true }).argument("<runId>").action(async (runId) => {
  const { runWorker } = await import("./worker-OUZTMHCN.js");
  await runWorker(runId);
});
program.command("mcp").description("\u4EE5 MCP stdio server \u65B9\u5F0F\u8FD0\u884C\uFF08\u53EF\u9009\u63A5\u5165\u65B9\u5F0F\uFF09").action(async () => {
  const { startMcpServer } = await import("./server-4KNPNG6C.js");
  await startMcpServer();
});
program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
//# sourceMappingURL=cli.js.map