#!/usr/bin/env node
import fs from "node:fs";
import { Command } from "commander";
import { TaskSpecSchema } from "./config/schema.js";
import { dispatchTask } from "./core/dispatch.js";
import { readRun, readResult, listRuns } from "./core/runs.js";
import { getThread } from "./core/threads.js";
import { loadConfig, loadCapabilities } from "./config/load.js";
import { runInit } from "./wizard/init.js";
import { probeAll } from "./wizard/probe.js";
import { installSkills, doctorHosts } from "./install/hosts.js";
import { adapters } from "./adapters/registry.js";
import { BACKEND_IDS, type BackendId } from "./config/schema.js";

const program = new Command();
program.name("ywcrew").description("把任务派给你本地订阅的 AI agents（claude/codex/grok/kimi/agy）").version("0.1.0");
program.addHelpText(
  "after",
  `
上手（普通用户不需要记命令，对你的智能体说话即可）：
  「用 ywcrew 让 kimi 评审这个文件」
  「让 GPT 用最高思考强度查一下这个 bug」
  「开个评审会，多找几个模型对比这两个方案」

宿主 agent 派单三步（详见已分发的 ywcrew 技能）：
  1. echo '<任务 JSON>' | ywcrew run --stdin     # ywcrew template 看模板
  2. ywcrew result <runId> --wait                # 阻塞取结构化结论
  3. ywcrew followup <threadId> "追问…"          # 跨轮续聊

首次使用 / 排障：ywcrew init · ywcrew doctor`,
);

// 注意：模板里只放合法真值，不放占位符——宿主 agent 照抄模板漏改字段时，
// 占位符会被当真值透传给后端。model 可选，不指定就整个省略该字段。
const TEMPLATE = {
  backend: "kimi",
  mode: "read-only",
  task: {
    briefing: "项目背景：技术栈、构建/测试命令。被调模型对项目零知识，写全。",
    locations: "关键代码在哪：入口、模块路径",
    objective: "确切的问题 + 已尝试过什么 + 原始报错全文",
    constraints: "不许改哪些文件、不许做什么",
    output_contract: "期望的输出形态：如按严重级别排序的问题列表，每条带文件:行号",
  },
  files: ["src/**/*.ts", "!**/*.test.ts"],
  label: "lock 并发评审",
};

function printDispatch(outcome: { run: { runId: string }; threadId: string; warnings: string[] }): void {
  console.log(JSON.stringify({ runId: outcome.run.runId, threadId: outcome.threadId, warnings: outcome.warnings }));
}

program
  .command("run")
  .description("派一个任务（--task-file 或 --stdin 传五段式 JSON）")
  .option("--task-file <path>", "任务 JSON 文件")
  .option("--stdin", "从 stdin 读任务 JSON")
  .action(async (opts: { taskFile?: string; stdin?: boolean }) => {
    if (!opts.taskFile && !opts.stdin) {
      console.error("需要 --task-file 或 --stdin。模板: ywcrew template");
      process.exit(2);
    }
    try {
      const raw = opts.taskFile ? fs.readFileSync(opts.taskFile, "utf8") : fs.readFileSync(0, "utf8");
      printDispatch(dispatchTask(JSON.parse(raw)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        (err as NodeJS.ErrnoException).code === "ENOENT" && opts.taskFile
          ? `任务文件不存在: ${opts.taskFile}`
          : msg,
      );
      process.exit(1);
    }
  });

program
  .command("panel")
  .description("多模型并行评审：同一任务发给 panel 的所有成员")
  .option("--task-file <path>", "任务 JSON 文件（不含 backend 字段）")
  .option("--stdin", "从 stdin 读任务 JSON")
  .option("--members <list>", "覆盖默认成员，如 claude,codex:gpt-5.6-sol,kimi")
  .action((opts: { taskFile?: string; stdin?: boolean; members?: string }) => {
    if (!opts.taskFile && !opts.stdin) {
      console.error("需要 --task-file 或 --stdin。模板: ywcrew template");
      process.exit(2);
    }
    let base: Record<string, unknown>;
    try {
      const raw = opts.taskFile ? fs.readFileSync(opts.taskFile, "utf8") : fs.readFileSync(0, "utf8");
      base = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.error(`任务 JSON 读取/解析失败：${err instanceof Error ? err.message : String(err)}。模板: ywcrew template`);
      process.exit(1);
    }
    if (base.mode === "edit") {
      console.error("panel 只支持 read-only（并行评审）。要做改代码竞赛，请分别用 ywcrew run 派多个 mode:edit 任务。");
      process.exit(2);
    }
    const config = loadConfig();
    const members = (opts.members?.split(",") ?? config.defaults.panel).map((s) => s.trim()).filter(Boolean);
    if (members.length < 2) {
      console.error("panel 至少需要 2 个成员（ywcrew init 配置默认成员，或传 --members）");
      process.exit(2);
    }
    // 成员逐个派发：单个成员不可用（未装/未登录）只降级跳过，不拖垮整场评审
    const results: Array<Record<string, unknown>> = [];
    const skipped: Array<{ member: string; reason: string }> = [];
    for (const member of members) {
      const [backend, model] = member.split(":");
      try {
        const outcome = dispatchTask({ ...base, backend, model: model || undefined, mode: "read-only" });
        results.push({ member, runId: outcome.run.runId, threadId: outcome.threadId });
      } catch (err) {
        skipped.push({ member, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (results.length === 0) {
      console.error(`panel 全部成员不可用：\n${skipped.map((s) => `  ${s.member}: ${s.reason}`).join("\n")}`);
      process.exit(1);
    }
    console.log(JSON.stringify({ panel: results, skipped }, null, 2));
  });

program
  .command("followup")
  .description("在既有线程上追问（同后端走原生 resume，跨后端自动重建历史）")
  .argument("<threadId>")
  .argument("<prompt>")
  .option("--backend <id>", "切换后端（默认沿用线程最后一轮）")
  .option("--model <m>")
  .action((threadId: string, prompt: string, opts: { backend?: string; model?: string }) => {
    const thread = getThread(threadId);
    if (!thread || thread.turns.length === 0) {
      console.error(`线程 ${threadId} 不存在或为空（ywcrew run 派任务时会返回新的 threadId）`);
      process.exit(1);
    }
    const last = thread.turns[thread.turns.length - 1];
    const spec = {
      backend: (opts.backend as BackendId | undefined) ?? last.backend,
      model: opts.model,
      mode: "read-only" as const,
      thread: threadId,
      cwd: last.cwd,
      task: {
        briefing: "（续聊）项目背景与此前结论见「此前的讨论线程」一节，勿重新自我介绍。",
        objective: prompt.length >= 20 ? prompt : `${prompt}（续接上文，针对此前结论回应）`,
      },
      files: [],
    };
    printDispatch(dispatchTask(spec));
  });

program
  .command("status")
  .description("查询 run 状态（含僵死 worker 惰性回收）")
  .argument("[runId]")
  .action((runId?: string) => {
    if (runId) {
      const meta = readRun(runId);
      if (!meta) {
        console.error(`run ${runId} 不存在`);
        process.exit(1);
      }
      console.log(JSON.stringify(meta, null, 2));
    } else {
      console.log(
        JSON.stringify(
          listRuns().map((m) => ({ runId: m.runId, state: m.state, backend: m.backend, label: m.label })),
          null,
          2,
        ),
      );
    }
  });

program
  .command("result")
  .description("读取 run 的结构化结论（--wait 阻塞等待完成）")
  .argument("<runIds...>", "一个或多个 runId（多个时返回数组，配合 panel 用）")
  .option("--wait", "阻塞直到全部完成或超时")
  .option("--timeout <seconds>", "等待上限秒数", "600")
  .action(async (runIds: string[], opts: { wait?: boolean; timeout: string }) => {
    // 不存在的 runId 直接报错，避免 --wait 对着拼错的 id 干等满整个 timeout
    const missing = runIds.filter((id) => !readRun(id));
    if (missing.length > 0) {
      console.error(`run 不存在: ${missing.join(", ")}（ywcrew status 可列出近期 run）`);
      process.exit(1);
    }
    const deadline = Date.now() + Number(opts.timeout) * 1000;
    const collect = () =>
      runIds.map((runId) => {
        const meta = readRun(runId); // 触发惰性回收
        const result = readResult(runId);
        return result
          ? { runId, ...result }
          : { runId, pending: true, state: meta?.state ?? "unknown" };
      });
    let results = collect();
    if (opts.wait) {
      while (results.some((r) => "pending" in r && r.pending) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        results = collect();
      }
    }
    console.log(JSON.stringify(runIds.length === 1 ? results[0] : results, null, 2));
    if (results.some((r) => "pending" in r && r.pending)) process.exit(3);
  });

program.command("template").description("打印五段式任务模板").action(() => {
  console.log(JSON.stringify(TEMPLATE, null, 2));
});

program
  .command("init")
  .description("首次配置向导（--yes 非交互，供智能体自举安装）")
  .option("--yes", "跳过交互：启用所有已安装且已登录的后端，采用默认配置；不覆盖已有偏好")
  .action((opts: { yes?: boolean }) => runInit(opts));

program
  .command("refresh")
  .description("重新探测后端与模型清单，并重渲染各宿主技能")
  .action(async () => {
    const caps = await probeAll();
    console.log(JSON.stringify(caps, null, 2));
    try {
      installSkills();
    } catch {
      /* 尚未 install 过则跳过 */
    }
  });

program
  .command("doctor")
  .description("体检：后端可用性、登录态、宿主装载")
  .action(async () => {
    const caps = await probeAll();
    const config = loadConfig();
    console.log("后端状态：");
    for (const id of BACKEND_IDS) {
      const b = caps.backends[id];
      if (!b) continue;
      const enabled = config.backends[id]?.enabled ? "已启用" : "未启用";
      const auth =
        b.authState === "ok" ? "已登录" : b.authState === "unauthenticated" ? `❗未登录 → ${adapters[id].loginCommand}` : "登录态未知";
      console.log(
        `  ${b.installed ? "✅" : "❌"} ${id.padEnd(7)} ${b.installed ? `${b.version ?? ""} | ${enabled} | ${auth} | 只读机制: ${adapters[id].capabilities.readOnlyMechanism}` : "未安装"}`,
      );
    }
    console.log();
    doctorHosts();
  });

program
  .command("install")
  .description("把技能分发到各宿主 skills 目录（按当前配置渲染路由表）")
  .option("--each", "统一目录之外也逐宿主分发")
  .action(() => installSkills());

const route = program.command("route").description("查看/自定义任务路由偏好（写进各宿主技能）");
route
  .command("list")
  .description("查看当前生效的路由表")
  .action(async () => {
    const { effectiveRouting } = await import("./install/routing.js");
    const config = loadConfig();
    const custom = config.defaults.routing.length > 0;
    console.log(custom ? "（用户自定义）" : "（内置默认，按已启用后端过滤）");
    for (const r of effectiveRouting(config)) console.log(`  ${r.when}  →  ${r.use}`);
  });
route
  .command("add")
  .description('新增一条自定义规则，如 ywcrew route add "性能优化" "codex::high"')
  .argument("<when>", "任务类型描述")
  .argument("<use>", "backend[:model][:effort]")
  .action(async (when: string, use: string) => {
    const { saveConfig } = await import("./config/load.js");
    const config = loadConfig();
    config.defaults.routing.push({ when, use });
    saveConfig(config);
    installSkills();
    console.log(`✅ 已添加并重新渲染技能：${when} → ${use}`);
  });
route
  .command("clear")
  .description("清空自定义规则，回到内置默认")
  .action(async () => {
    const { saveConfig } = await import("./config/load.js");
    const config = loadConfig();
    config.defaults.routing = [];
    saveConfig(config);
    installSkills();
    console.log("✅ 已恢复内置默认路由并重新渲染技能");
  });

program
  .command("gc")
  .description("清理超龄的已完成 run、worktree 与不活跃线程")
  .option("--days <n>", "run/worktree 保留天数", "7")
  .option("--thread-days <n>", "线程保留天数", "30")
  .action(async (opts: { days: string; threadDays: string }) => {
    const { runGc } = await import("./core/gc.js");
    const report = runGc({ days: Number(opts.days), threadDays: Number(opts.threadDays) });
    console.log(
      `✅ 已清理 ${report.runsRemoved.length} 个 run、${report.worktreesRemoved.length} 个 worktree、${report.threadsRemoved.length} 个线程；保留 ${report.kept} 个 run`,
    );
  });

program
  .command("backends")
  .description("列出后端与可用模型（供宿主 agent 查询）")
  .action(() => {
    const caps = loadCapabilities();
    const config = loadConfig();
    if (!caps) {
      console.error("尚未探测，先运行 ywcrew refresh 或 ywcrew init");
      process.exit(1);
    }
    const out = BACKEND_IDS.map((id) => ({
      backend: id,
      enabled: config.backends[id]?.enabled ?? false,
      defaultModel: config.backends[id]?.defaultModel,
      auth: caps.backends[id]?.authState,
      models: caps.backends[id]?.models ?? [],
      supportsEffort: adapters[id].capabilities.supportsEffort,
    }));
    console.log(JSON.stringify(out, null, 2));
  });

program
  .command("__worker", { hidden: true })
  .argument("<runId>")
  .action(async (runId: string) => {
    const { runWorker } = await import("./core/worker.js");
    await runWorker(runId);
  });

program
  .command("mcp")
  .description("以 MCP stdio server 方式运行（可选接入方式）")
  .action(async () => {
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer();
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
