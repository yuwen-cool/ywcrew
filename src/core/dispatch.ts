import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { globSync } from "tinyglobby";
import { TaskSpec, TaskSpecSchema, type BackendId } from "../config/schema.js";
import { loadConfig, loadCapabilities, ensureHome } from "../config/load.js";
import { paths } from "../config/paths.js";
import { adapters } from "../adapters/registry.js";
import { createRun, type RunMeta } from "./runs.js";
import { createThread, getThread } from "./threads.js";

export interface DispatchOutcome {
  run: RunMeta;
  threadId: string;
  warnings: string[];
}

function resolveAutoBackend(): BackendId {
  const config = loadConfig();
  const enabled = (Object.entries(config.backends) as Array<[BackendId, { enabled: boolean }]>).filter(
    ([, c]) => c.enabled,
  );
  if (enabled.length === 0) throw new Error("没有已启用的后端，先运行 ywcrew init");
  return enabled[0][0];
}

/** 校验 + 建 run + spawn detached worker。宿主调用后立即返回 runId。 */
export function dispatchTask(rawSpec: unknown): DispatchOutcome {
  ensureHome();
  const parsed = TaskSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => {
        const p = i.path.join(".");
        if (p === "backend") return `  backend: 不认识的后端，可用: claude / codex / grok / kimi / agy / auto`;
        return `  ${p}: ${i.message}`;
      })
      .join("\n");
    throw new Error(`任务不符合五段式模板：\n${issues}\n\n模板参考：ywcrew template`);
  }
  const spec: TaskSpec = parsed.data;
  const warnings: string[] = [];
  const config = loadConfig();
  const caps = loadCapabilities();

  if (spec.backend === "auto") spec.backend = resolveAutoBackend();
  const backend = spec.backend as BackendId;

  // 前置拦截 1：后端可用性——失败要发生在派单时，而不是 worker 深处。
  // 无论缓存怎么说都做一次实时 PATH 检查（缓存可能记录 installed 后二进制被卸载）
  try {
    execFileSync("/usr/bin/which", [adapters[backend].binary], { stdio: "pipe" });
  } catch {
    throw new Error(`后端 ${backend} 的命令 ${adapters[backend].binary} 不在 PATH 中。先安装它，或换一个后端（ywcrew backends 查看）。`);
  }
  if (config.backends[backend] && !config.backends[backend]!.enabled) {
    warnings.push(`后端 ${backend} 在配置中是禁用状态，本次仍按显式指定执行（ywcrew init 可重新启用）`);
  }
  if (caps?.backends[backend]?.authState === "unauthenticated") {
    throw new Error(`后端 ${backend} 未登录。修复：${adapters[backend].loginCommand}（然后 ywcrew refresh）`);
  }

  // 前置拦截 2：cwd 必须存在
  const cwd = path.resolve(spec.cwd ?? process.cwd());
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`cwd 不存在或不是目录: ${cwd}`);
  }
  spec.cwd = cwd;

  // 前置拦截 3：files glob 全部零匹配 → 大概率是写错了，立即告知
  const includeGlobs = spec.files.filter((g) => !g.startsWith("!"));
  if (includeGlobs.length > 0) {
    const matched = globSync(includeGlobs, { cwd, onlyFiles: true, followSymbolicLinks: false });
    if (matched.length === 0) {
      throw new Error(`files 的 glob 在 ${cwd} 下没有匹配到任何文件: ${includeGlobs.join(", ")}。检查路径或改用相对 cwd 的 glob。`);
    }
  }

  // 模型校验：先拦占位符（宿主 agent 照抄模板忘改的高频错误），未知名透传 + warning
  if (spec.model) {
    if (/[（）()]|可选|覆盖默认|optional/i.test(spec.model)) {
      throw new Error(`model 字段收到疑似占位符文本: "${spec.model}"。不指定模型请直接省略该字段。`);
    }
    const known = caps?.backends[backend]?.models.some(
      (m) => m.id === spec.model || spec.model!.startsWith(m.id),
    );
    if (caps && !known)
      warnings.push(`模型 ${spec.model} 不在 ${backend} 的已知清单中，已透传（可运行 ywcrew refresh 刷新）`);
  }

  // 显式传了 threadId 但线程不存在 → 报错而非静默新建（调用方以为在续聊，实际是全新对话）
  if (spec.thread && !getThread(spec.thread)) {
    throw new Error(`线程 ${spec.thread} 不存在（可能已被 gc 回收）。省略 thread 字段可开新线程。`);
  }
  const threadId = spec.thread ?? createThread().threadId;
  const run = createRun({ ...spec, thread: threadId }, threadId);

  // spawn detached worker：脱离终端，stdio 全部落文件，unref 后父进程可退出
  // 入口用 argv[1]（dev 时是 src/cli.ts 由 tsx 跑，bundle 后是 dist/cli.js）；realpath 解掉全局 bin symlink
  const cliEntry = fs.realpathSync(process.argv[1]);
  const logFd = fs.openSync(path.join(paths.runDir(run.runId), "worker.log"), "a");
  const runner = cliEntry.endsWith(".ts") ? ["npx", "tsx", cliEntry] : [process.execPath, cliEntry];
  const child = spawn(runner[0], [...runner.slice(1), "__worker", run.runId], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: spec.cwd ?? process.cwd(),
  });
  child.unref();
  fs.closeSync(logFd);

  return { run, threadId, warnings };
}
