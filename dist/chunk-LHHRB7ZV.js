import {
  adapters,
  createThread,
  getThread
} from "./chunk-JTDLTURC.js";
import {
  TaskSpecSchema,
  ensureHome,
  loadCapabilities,
  loadConfig
} from "./chunk-CNHRP3AD.js";
import {
  createRun
} from "./chunk-IFU773SE.js";
import {
  paths
} from "./chunk-QEBUZYAA.js";

// src/core/dispatch.ts
import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import { globSync } from "tinyglobby";
function resolveAutoBackend() {
  const config = loadConfig();
  const enabled = Object.entries(config.backends).filter(
    ([, c]) => c.enabled
  );
  if (enabled.length === 0) throw new Error("\u6CA1\u6709\u5DF2\u542F\u7528\u7684\u540E\u7AEF\uFF0C\u5148\u8FD0\u884C ywcrew init");
  return enabled[0][0];
}
function dispatchTask(rawSpec) {
  ensureHome();
  const parsed = TaskSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const p = i.path.join(".");
      if (p === "backend") return `  backend: \u4E0D\u8BA4\u8BC6\u7684\u540E\u7AEF\uFF0C\u53EF\u7528: claude / codex / grok / kimi / agy / auto`;
      return `  ${p}: ${i.message}`;
    }).join("\n");
    throw new Error(`\u4EFB\u52A1\u4E0D\u7B26\u5408\u4E94\u6BB5\u5F0F\u6A21\u677F\uFF1A
${issues}

\u6A21\u677F\u53C2\u8003\uFF1Aywcrew template`);
  }
  const spec = parsed.data;
  const warnings = [];
  const config = loadConfig();
  const caps = loadCapabilities();
  if (spec.backend === "auto") spec.backend = resolveAutoBackend();
  const backend = spec.backend;
  try {
    execFileSync("/usr/bin/which", [adapters[backend].binary], { stdio: "pipe" });
  } catch {
    throw new Error(`\u540E\u7AEF ${backend} \u7684\u547D\u4EE4 ${adapters[backend].binary} \u4E0D\u5728 PATH \u4E2D\u3002\u5148\u5B89\u88C5\u5B83\uFF0C\u6216\u6362\u4E00\u4E2A\u540E\u7AEF\uFF08ywcrew backends \u67E5\u770B\uFF09\u3002`);
  }
  if (config.backends[backend] && !config.backends[backend].enabled) {
    warnings.push(`\u540E\u7AEF ${backend} \u5728\u914D\u7F6E\u4E2D\u662F\u7981\u7528\u72B6\u6001\uFF0C\u672C\u6B21\u4ECD\u6309\u663E\u5F0F\u6307\u5B9A\u6267\u884C\uFF08ywcrew init \u53EF\u91CD\u65B0\u542F\u7528\uFF09`);
  }
  if (caps?.backends[backend]?.authState === "unauthenticated") {
    throw new Error(`\u540E\u7AEF ${backend} \u672A\u767B\u5F55\u3002\u4FEE\u590D\uFF1A${adapters[backend].loginCommand}\uFF08\u7136\u540E ywcrew refresh\uFF09`);
  }
  const cwd = path.resolve(spec.cwd ?? process.cwd());
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`cwd \u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u76EE\u5F55: ${cwd}`);
  }
  spec.cwd = cwd;
  const includeGlobs = spec.files.filter((g) => !g.startsWith("!"));
  if (includeGlobs.length > 0) {
    const matched = globSync(includeGlobs, { cwd, onlyFiles: true, followSymbolicLinks: false });
    if (matched.length === 0) {
      throw new Error(`files \u7684 glob \u5728 ${cwd} \u4E0B\u6CA1\u6709\u5339\u914D\u5230\u4EFB\u4F55\u6587\u4EF6: ${includeGlobs.join(", ")}\u3002\u68C0\u67E5\u8DEF\u5F84\u6216\u6539\u7528\u76F8\u5BF9 cwd \u7684 glob\u3002`);
    }
  }
  if (spec.model) {
    if (/[（）()]|可选|覆盖默认|optional/i.test(spec.model)) {
      throw new Error(`model \u5B57\u6BB5\u6536\u5230\u7591\u4F3C\u5360\u4F4D\u7B26\u6587\u672C: "${spec.model}"\u3002\u4E0D\u6307\u5B9A\u6A21\u578B\u8BF7\u76F4\u63A5\u7701\u7565\u8BE5\u5B57\u6BB5\u3002`);
    }
    const known = caps?.backends[backend]?.models.some(
      (m) => m.id === spec.model || spec.model.startsWith(m.id)
    );
    if (caps && !known)
      warnings.push(`\u6A21\u578B ${spec.model} \u4E0D\u5728 ${backend} \u7684\u5DF2\u77E5\u6E05\u5355\u4E2D\uFF0C\u5DF2\u900F\u4F20\uFF08\u53EF\u8FD0\u884C ywcrew refresh \u5237\u65B0\uFF09`);
  }
  if (spec.thread && !getThread(spec.thread)) {
    throw new Error(`\u7EBF\u7A0B ${spec.thread} \u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u5DF2\u88AB gc \u56DE\u6536\uFF09\u3002\u7701\u7565 thread \u5B57\u6BB5\u53EF\u5F00\u65B0\u7EBF\u7A0B\u3002`);
  }
  const threadId = spec.thread ?? createThread().threadId;
  const run = createRun({ ...spec, thread: threadId }, threadId);
  const cliEntry = fs.realpathSync(process.argv[1]);
  const logFd = fs.openSync(path.join(paths.runDir(run.runId), "worker.log"), "a");
  const runner = cliEntry.endsWith(".ts") ? ["npx", "tsx", cliEntry] : [process.execPath, cliEntry];
  const child = spawn(runner[0], [...runner.slice(1), "__worker", run.runId], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: spec.cwd ?? process.cwd()
  });
  child.unref();
  fs.closeSync(logFd);
  return { run, threadId, warnings };
}

export {
  dispatchTask
};
//# sourceMappingURL=chunk-LHHRB7ZV.js.map