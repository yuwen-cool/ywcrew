import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { TaskSpec, TaskSpecSchema, type BackendId } from "../config/schema.js";
import { loadConfig, loadCapabilities, ensureHome } from "../config/load.js";
import { paths } from "../config/paths.js";
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
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`任务不符合五段式模板：\n${issues}\n\n模板参考：ywcrew template`);
  }
  const spec: TaskSpec = parsed.data;
  const warnings: string[] = [];

  if (spec.backend === "auto") spec.backend = resolveAutoBackend();

  // 模型校验：未知名透传 + warning（新模型可能未刷新缓存）
  if (spec.model) {
    const caps = loadCapabilities();
    const known = caps?.backends[spec.backend as BackendId]?.models.some(
      (m) => m.id === spec.model || spec.model!.startsWith(m.id),
    );
    if (caps && !known)
      warnings.push(`模型 ${spec.model} 不在 ${spec.backend} 的已知清单中，已透传（可运行 ywcrew refresh 刷新）`);
  }

  const threadId = spec.thread && getThread(spec.thread) ? spec.thread : createThread().threadId;
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
