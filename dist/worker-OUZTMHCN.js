import {
  appendTurn,
  extractJsonObject,
  getAdapter,
  planContinuation
} from "./chunk-JTDLTURC.js";
import {
  loadConfig
} from "./chunk-A6PGVESN.js";
import {
  processIdentity,
  readRun,
  readTask,
  releaseSlot,
  renewSlot,
  tryAcquireSlot,
  updateRun,
  writeHeartbeat,
  writeResult
} from "./chunk-IFU773SE.js";
import {
  paths
} from "./chunk-QEBUZYAA.js";

// src/core/worker.ts
import fs5 from "fs";
import path5 from "path";
import { spawn, execFileSync } from "child_process";

// src/context/builder.ts
import fs2 from "fs";
import path2 from "path";
import { globSync } from "tinyglobby";
import ignore from "ignore";

// src/context/guard.ts
import fs from "fs";
import path from "path";
var CREDENTIAL_BASENAMES = /* @__PURE__ */ new Set([
  ".env",
  ".npmrc",
  ".netrc",
  ".pgpass",
  "credentials",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa"
]);
var CREDENTIAL_PREFIXES = [".env.", "id_rsa.", "id_ed25519."];
var CREDENTIAL_EXTENSIONS = /* @__PURE__ */ new Set([".pem", ".key", ".p12", ".pfx", ".keystore"]);
var CREDENTIAL_DIRS = /* @__PURE__ */ new Set([".ssh", ".aws", ".gnupg", ".kube"]);
var CONTENT_PATTERNS = [
  /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  // OpenAI 风格
  /\bghp_[A-Za-z0-9]{36,}\b/,
  // GitHub PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // Slack
  /\bAKIA[0-9A-Z]{16}\b/
  // AWS access key id
];
function checkPath(absFile, rootDir) {
  const real = fs.existsSync(absFile) ? fs.realpathSync(absFile) : absFile;
  const realRoot = fs.realpathSync(rootDir);
  if (!real.startsWith(realRoot + path.sep) && real !== realRoot) {
    return { allowed: false, reason: `\u8DEF\u5F84\u9003\u9038\u5DE5\u4F5C\u533A: ${absFile}` };
  }
  const base = path.basename(real);
  if (CREDENTIAL_BASENAMES.has(base)) return { allowed: false, reason: `\u51ED\u636E\u6587\u4EF6: ${base}` };
  if (CREDENTIAL_PREFIXES.some((p) => base.startsWith(p)))
    return { allowed: false, reason: `\u51ED\u636E\u6587\u4EF6: ${base}` };
  if (CREDENTIAL_EXTENSIONS.has(path.extname(base)))
    return { allowed: false, reason: `\u5BC6\u94A5\u7C7B\u6269\u5C55\u540D: ${base}` };
  for (const seg of real.split(path.sep)) {
    if (CREDENTIAL_DIRS.has(seg)) return { allowed: false, reason: `\u654F\u611F\u76EE\u5F55: ${seg}` };
  }
  return { allowed: true };
}
function checkContent(content, file) {
  for (const re of CONTENT_PATTERNS) {
    if (re.test(content)) return { allowed: false, reason: `\u5185\u5BB9\u542B\u5BC6\u94A5\u7279\u5F81 (${re.source.slice(0, 30)}\u2026): ${file}` };
  }
  return { allowed: true };
}

// src/context/builder.ts
var estimateTokens = (s) => Math.ceil(s.length / 3.6);
var ALWAYS_IGNORE = ["node_modules/**", ".git/**", "dist/**", "build/**", "*.lock", "package-lock.json"];
function bundleFiles(spec, tokenBudget) {
  const root = path2.resolve(spec.cwd ?? process.cwd());
  const include = spec.files.filter((g) => !g.startsWith("!"));
  const exclude = spec.files.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  if (include.length === 0) return { ok: true, files: [], skipped: [], totalTokens: 0 };
  const ig = ignore().add(ALWAYS_IGNORE).add(exclude);
  const gitignorePath = path2.join(root, ".gitignore");
  if (fs2.existsSync(gitignorePath)) ig.add(fs2.readFileSync(gitignorePath, "utf8"));
  const matched = globSync(include, { cwd: root, dot: false, onlyFiles: true, followSymbolicLinks: false });
  const files = [];
  const skipped = [];
  for (const rel of matched.sort()) {
    if (ig.ignores(rel)) {
      skipped.push({ rel, reason: "ignore \u89C4\u5219" });
      continue;
    }
    const abs = path2.join(root, rel);
    const pathVerdict = checkPath(abs, root);
    if (!pathVerdict.allowed) {
      skipped.push({ rel, reason: pathVerdict.reason });
      continue;
    }
    let content;
    try {
      const stat = fs2.statSync(abs);
      if (stat.size > 1024 * 1024) {
        skipped.push({ rel, reason: "\u5355\u6587\u4EF6\u8D85 1MB" });
        continue;
      }
      content = fs2.readFileSync(abs, "utf8");
    } catch {
      skipped.push({ rel, reason: "\u8BFB\u53D6\u5931\u8D25/\u4E8C\u8FDB\u5236" });
      continue;
    }
    if (content.includes("\0")) {
      skipped.push({ rel, reason: "\u4E8C\u8FDB\u5236\u6587\u4EF6" });
      continue;
    }
    const contentVerdict = checkContent(content, rel);
    if (!contentVerdict.allowed) {
      skipped.push({ rel, reason: contentVerdict.reason });
      continue;
    }
    files.push({ rel, content, tokens: estimateTokens(content) });
  }
  const totalTokens = files.reduce((s, f) => s + f.tokens, 0);
  if (totalTokens > tokenBudget) {
    const report = files.sort((a, b) => b.tokens - a.tokens).map((f) => `  ${f.rel}: ~${f.tokens} tokens`).join("\n");
    return {
      ok: false,
      files: [],
      skipped,
      totalTokens,
      overBudgetReport: `\u6587\u4EF6\u603B\u91CF ~${totalTokens} tokens \u8D85\u9884\u7B97 ${tokenBudget}\u3002\u8BF7\u6536\u655B files glob\u3002\u5404\u6587\u4EF6\u7528\u91CF\uFF1A
${report}`
    };
  }
  return { ok: true, files, skipped, totalTokens };
}
var RESULT_CONTRACT_INSTRUCTIONS = `
## \u8F93\u51FA\u8981\u6C42\uFF08\u5FC5\u987B\u4E25\u683C\u9075\u5B88\uFF09
\u4F60\u7684\u6700\u7EC8\u56DE\u7B54\u5FC5\u987B\u662F\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u53EF\u4EE5\u5728\u63A8\u7406\u540E\u8F93\u51FA\uFF0C\u4F46\u6700\u7EC8\u56DE\u7B54\u53EA\u542B\u8FD9\u4E2A JSON\uFF09\uFF1A
{
  "summary": "\u7ED3\u8BBA\u4E0E\u5173\u952E\u63A8\u7406\uFF0C\u4E2D\u6587\uFF0C\u63A7\u5236\u5728 1500 \u5B57\u5185",
  "evidence": [{"file": "\u8DEF\u5F84", "lines": "12-40", "claim": "\u8BE5\u8BC1\u636E\u652F\u6491\u7684\u8BBA\u65AD"}],
  "confidence": "low|medium|high"
}
\u5982\u679C\u63D0\u4F9B\u7684\u4E0A\u4E0B\u6587\u4E0D\u8DB3\u4EE5\u5B8C\u6210\u4EFB\u52A1\uFF0C\u6539\u4E3A\u53EA\u8F93\u51FA\uFF1A
{"status": "need_more_context", "files": ["\u4F60\u9700\u8981\u7684\u6587\u4EF6\u76F8\u5BF9\u8DEF\u5F84"], "reason": "\u4E3A\u4EC0\u4E48\u9700\u8981"}
`.trim();
function renderPrompt(spec, bundle, opts = {}) {
  const t = spec.task;
  const parts = [];
  parts.push("# \u4EFB\u52A1\u59D4\u6258\uFF08\u4F60\u5BF9\u8BE5\u9879\u76EE\u96F6\u80CC\u666F\uFF0C\u4EE5\u4E0B\u662F\u5168\u90E8\u4E0A\u4E0B\u6587\uFF09");
  parts.push(`## \u9879\u76EE\u80CC\u666F
${t.briefing}`);
  if (t.locations) parts.push(`## \u5173\u952E\u4F4D\u7F6E
${t.locations}`);
  parts.push(`## \u4EFB\u52A1\u76EE\u6807
${t.objective}`);
  if (t.constraints) parts.push(`## \u8FB9\u754C\u7EA6\u675F
${t.constraints}`);
  const modeStatement = spec.mode === "edit" ? "\u672C\u6B21\u4EFB\u52A1\u5141\u8BB8\u6539\u4EE3\u7801\uFF1A\u76F4\u63A5\u5728\u5DE5\u4F5C\u76EE\u5F55\u4E2D\u4FEE\u6539\uFF08\u8FD9\u662F\u9694\u79BB\u7684 git \u5DE5\u4F5C\u526F\u672C\uFF0C\u6539\u52A8\u4F1A\u4EE5 patch \u6536\u96C6\u4EA4\u4ED8\uFF0C\u4E0D\u4F1A\u76F4\u63A5\u843D\u5230\u7528\u6237\u4ED3\u5E93\uFF09\u3002\u5B8C\u6210\u540E\u81EA\u884C\u786E\u8BA4\u6539\u52A8\u53EF\u901A\u8FC7\u6784\u5EFA/\u6D4B\u8BD5\u3002" : "\u672C\u6B21\u4EFB\u52A1\u53EA\u8BFB\uFF1A\u4E0D\u5F97\u4FEE\u6539\u3001\u521B\u5EFA\u6216\u5220\u9664\u4EFB\u4F55\u6587\u4EF6\uFF0C\u4E0D\u5F97\u6267\u884C\u6709\u526F\u4F5C\u7528\u7684\u547D\u4EE4\u3002";
  const envStatement = spec.strict && spec.mode !== "edit" ? `\u4F60\u4EE5 agentic \u65B9\u5F0F\u8FD0\u884C\u5728\u4E00\u4E2A\u4E25\u683C\u9694\u79BB\u76EE\u5F55\u4E2D\uFF1A\u8FD9\u91CC\u53EA\u7269\u5316\u4E86\u4E0B\u65B9\u300C\u53C2\u8003\u6587\u4EF6\u300D\uFF0C\u9879\u76EE\u7684\u5176\u4ED6\u6587\u4EF6\u4E0D\u5B58\u5728\u4E8E\u6B64\uFF0C\u4E0D\u8981\u5C1D\u8BD5\u8BFB\u53D6\u767D\u540D\u5355\u4EE5\u5916\u7684\u5185\u5BB9\uFF1B\u786E\u9700\u66F4\u591A\u6587\u4EF6\u65F6\u7528 need_more_context \u8BF7\u6C42\u3002${modeStatement}` : `\u4F60\u4EE5 agentic \u65B9\u5F0F\u8FD0\u884C\u5728\u9879\u76EE\u5DE5\u4F5C\u76EE\u5F55\u4E2D\u3002\u4E0B\u65B9\u300C\u53C2\u8003\u6587\u4EF6\u300D\u53EA\u662F\u53D1\u8D77\u65B9\u6311\u9009\u7684\u8D77\u70B9\uFF0C\u9700\u8981\u66F4\u591A\u4FE1\u606F\u65F6\u4F18\u5148\u81EA\u884C\u8BFB\u53D6\u5DE5\u4F5C\u76EE\u5F55\u4E2D\u7684\u5176\u4ED6\u6587\u4EF6\uFF0C\u800C\u4E0D\u662F\u6025\u4E8E\u6C42\u52A9\u3002${modeStatement}`;
  parts.push(`## \u6267\u884C\u73AF\u5883
${envStatement}`);
  if (opts.historyBlock) parts.push(`## \u6B64\u524D\u7684\u8BA8\u8BBA\u7EBF\u7A0B
${opts.historyBlock}`);
  if (bundle.files.length > 0) {
    const fileBlocks = bundle.files.map((f) => `=== FILE: ${f.rel} ===
${f.content}
=== END FILE ===`).join("\n\n");
    parts.push(`## \u53C2\u8003\u6587\u4EF6\uFF08\u5171 ${bundle.files.length} \u4E2A\uFF09
${fileBlocks}`);
  }
  const contract = t.output_contract ? `${RESULT_CONTRACT_INSTRUCTIONS}

\u5176\u4E2D summary \u5B57\u6BB5\u7684\u5185\u5BB9\u6309\u4EE5\u4E0B\u8981\u6C42\u7EC4\u7EC7\uFF1A
${t.output_contract}` : RESULT_CONTRACT_INSTRUCTIONS;
  parts.push(contract);
  return parts.join("\n\n");
}

// src/core/shadow.ts
import fs3 from "fs";
import path3 from "path";
function createShadowDir(runId, files) {
  const dir = path3.join(paths.home, "shadow", runId);
  fs3.rmSync(dir, { recursive: true, force: true });
  fs3.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const dest = path3.join(dir, f.rel);
    if (!path3.resolve(dest).startsWith(path3.resolve(dir) + path3.sep)) continue;
    fs3.mkdirSync(path3.dirname(dest), { recursive: true });
    fs3.writeFileSync(dest, f.content);
  }
  return dir;
}

// src/core/evidence.ts
import fs4 from "fs";
import path4 from "path";
function verifyEvidence(evidence, cwd) {
  return evidence.map((e) => {
    const abs = path4.resolve(cwd, e.file);
    if (!abs.startsWith(path4.resolve(cwd) + path4.sep)) {
      return { ...e, verified: false, verify_note: "\u6587\u4EF6\u8DEF\u5F84\u5728\u5DE5\u4F5C\u76EE\u5F55\u4E4B\u5916" };
    }
    let content;
    try {
      content = fs4.readFileSync(abs, "utf8");
    } catch {
      return { ...e, verified: false, verify_note: "\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB" };
    }
    if (e.lines) {
      const m = e.lines.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return { ...e, verified: false, verify_note: `\u884C\u53F7\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790: ${e.lines}` };
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      const total = content.split("\n").length;
      if (start < 1 || end < start || end > total) {
        return { ...e, verified: false, verify_note: `\u884C\u53F7\u8D8A\u754C\uFF08\u6587\u4EF6\u5171 ${total} \u884C\uFF09` };
      }
    }
    return { ...e, verified: true };
  });
}

// src/core/worker.ts
var HEARTBEAT_INTERVAL_MS = 5e3;
var SLOT_WAIT_INTERVAL_MS = 3e3;
var SLOT_WAIT_MAX_MS = 30 * 6e4;
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function execBackend(binary, argv, stdin, cwd, timeoutMs, eventsFile) {
  return new Promise((resolve) => {
    const child = spawn(binary, argv, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    const events = fs5.createWriteStream(eventsFile, { flags: "a" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      events.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      events.write(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      events.end();
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      events.end();
      const friendly = err.code === "ENOENT" ? `\u547D\u4EE4 ${binary} \u672A\u627E\u5230\uFF08\u672A\u5B89\u88C5\u6216\u4E0D\u5728 PATH\uFF09\u3002` : String(err);
      resolve({ code: null, stdout, stderr: stderr + friendly, timedOut });
    });
    if (stdin !== void 0) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
function setupWorktree(runId, sourceCwd) {
  const wtDir = path5.join(paths.home, "worktrees", runId);
  const warnings = [];
  try {
    execFileSync("git", ["-C", sourceCwd, "rev-parse", "--git-dir"], { stdio: "pipe" });
    fs5.mkdirSync(path5.dirname(wtDir), { recursive: true });
    execFileSync("git", ["-C", sourceCwd, "worktree", "add", "--detach", wtDir], { stdio: "pipe" });
  } catch {
    return void 0;
  }
  try {
    const dirty = execFileSync("git", ["-C", sourceCwd, "status", "--porcelain"], { encoding: "utf8" });
    if (dirty.trim()) {
      const diff = execFileSync("git", ["-C", sourceCwd, "diff", "HEAD", "--binary"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
      });
      if (diff.trim()) {
        execFileSync("git", ["-C", wtDir, "apply", "--binary", "--whitespace=nowarn"], { input: diff, stdio: ["pipe", "pipe", "pipe"] });
      }
      const untracked = execFileSync(
        "git",
        ["-C", sourceCwd, "ls-files", "--others", "--exclude-standard", "-z"],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
      ).split("\0").filter(Boolean);
      for (const rel of untracked) {
        const dest = path5.join(wtDir, rel);
        fs5.mkdirSync(path5.dirname(dest), { recursive: true });
        fs5.copyFileSync(path5.join(sourceCwd, rel), dest);
      }
      execFileSync("git", ["-C", wtDir, "add", "-A"], { stdio: "pipe" });
      execFileSync(
        "git",
        ["-C", wtDir, "-c", "user.name=ywcrew", "-c", "user.email=snapshot@ywcrew.local", "commit", "-m", "ywcrew: dirty state snapshot", "--no-verify", "--quiet"],
        { stdio: "pipe" }
      );
    }
  } catch (err) {
    warnings.push(`\u672A\u63D0\u4EA4\u6539\u52A8\u540C\u6B65\u5230 worktree \u5931\u8D25\uFF08\u88AB\u8C03\u6A21\u578B\u770B\u5230\u7684\u662F HEAD \u7248\u672C\uFF09\uFF1A${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
  return { wtDir, warnings };
}
function collectPatch(runId, wtDir) {
  try {
    execFileSync("git", ["-C", wtDir, "add", "-A", "-N"], { stdio: "pipe" });
    const patch = execFileSync("git", ["-C", wtDir, "diff", "HEAD", "--binary"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    });
    if (!patch.trim()) return void 0;
    const patchFile = path5.join(paths.runDir(runId), "changes.patch");
    fs5.writeFileSync(patchFile, patch);
    return patchFile;
  } catch {
    return void 0;
  }
}
function parseContractFromText(text) {
  const obj = extractJsonObject(text);
  if (!obj) return {};
  if (obj.status === "need_more_context" && Array.isArray(obj.files)) {
    return { needMoreContext: { files: obj.files, reason: obj.reason } };
  }
  if (typeof obj.summary === "string") {
    return {
      result: {
        summary: obj.summary,
        evidence: Array.isArray(obj.evidence) ? obj.evidence : [],
        confidence: obj.confidence
      }
    };
  }
  return {};
}
async function runWorker(runId) {
  const spec = readTask(runId);
  if (!spec) throw new Error(`run ${runId} \u7F3A task.json`);
  const meta = readRun(runId);
  const threadId = meta?.threadId;
  const config = loadConfig();
  const backend = spec.backend;
  const adapter = getAdapter(backend);
  const backendCfg = config.backends[backend];
  updateRun(runId, { workerPid: process.pid, workerIdentity: processIdentity(process.pid) });
  writeHeartbeat(runId);
  const deadline = Date.now() + SLOT_WAIT_MAX_MS;
  let backendSlot;
  let globalSlot;
  while (Date.now() < deadline) {
    writeHeartbeat(runId);
    backendSlot = tryAcquireSlot(backend, backendCfg?.maxParallel ?? 2);
    if (backendSlot) {
      globalSlot = tryAcquireSlot("global", config.defaults.maxParallelGlobal);
      if (globalSlot) break;
      releaseSlot(backendSlot);
      backendSlot = void 0;
    }
    await sleep(SLOT_WAIT_INTERVAL_MS);
  }
  if (!backendSlot || !globalSlot) {
    writeResult(runId, {
      status: "timeout",
      summary: "\u6392\u961F\u8D85\u65F6\uFF1A\u5E76\u53D1 slot 30 \u5206\u949F\u5185\u672A\u7A7A\u51FA\u3002",
      evidence: [],
      warnings: []
    });
    return;
  }
  const heartbeatTimer = setInterval(() => {
    writeHeartbeat(runId);
    renewSlot(backendSlot);
    renewSlot(globalSlot);
  }, HEARTBEAT_INTERVAL_MS);
  const warnings = [];
  try {
    updateRun(runId, {
      state: "running",
      workerPid: process.pid,
      workerIdentity: processIdentity(process.pid)
    });
    writeHeartbeat(runId);
    const continuation = planContinuation(threadId, backend);
    const sourceCwd = path5.resolve(spec.cwd ?? process.cwd());
    const bundle = bundleFiles({ files: spec.files, cwd: sourceCwd }, config.defaults.tokenBudget);
    if (!bundle.ok) {
      writeResult(runId, {
        status: "failed",
        summary: bundle.overBudgetReport,
        evidence: [],
        warnings
      });
      return;
    }
    for (const s of bundle.skipped) {
      if (s.reason.includes("\u51ED\u636E") || s.reason.includes("\u5BC6\u94A5") || s.reason.includes("\u9003\u9038"))
        warnings.push(`\u5DF2\u62D2\u7EDD\u9644\u5E26 ${s.rel}\uFF08${s.reason}\uFF09`);
    }
    let cwd = sourceCwd;
    let wtDir;
    if (continuation.mode === "native" && continuation.cwd && fs5.existsSync(continuation.cwd)) {
      cwd = continuation.cwd;
    } else if (spec.strict && spec.mode === "read-only") {
      cwd = createShadowDir(runId, bundle.files);
    } else {
      if (spec.strict) warnings.push("strict \u4EC5\u5BF9 read-only \u4EFB\u52A1\u751F\u6548\uFF0Cedit \u4EFB\u52A1\u8D70 worktree \u9694\u79BB");
      const needsIsolation = spec.mode === "edit" || !adapter.capabilities.nativeReadOnly;
      if (needsIsolation) {
        const wt = setupWorktree(runId, sourceCwd);
        if (wt) {
          wtDir = wt.wtDir;
          cwd = wtDir;
          warnings.push(...wt.warnings);
        } else if (spec.mode === "edit") warnings.push("\u975E git \u76EE\u5F55\uFF0Cedit \u4EFB\u52A1\u672A\u505A worktree \u9694\u79BB");
        else warnings.push(`${backend} \u65E0\u539F\u751F\u53EA\u8BFB\u6863\u4E14\u975E git \u76EE\u5F55\uFF0C\u53EA\u8BFB\u4EFB\u52A1\u4EC5\u9760 prompt \u7EA6\u675F`);
      }
    }
    const model = spec.model ?? backendCfg?.defaultModel;
    const effort = adapter.capabilities.supportsEffort ? spec.effort ?? backendCfg?.defaultEffort : void 0;
    if (spec.effort && !adapter.capabilities.supportsEffort)
      warnings.push(`${backend} \u4E0D\u652F\u6301\u601D\u8003\u5F3A\u5EA6\u53C2\u6570\uFF0C\u5DF2\u5FFD\u7565 effort=${spec.effort}`);
    const prompt = renderPrompt(spec, bundle, {
      historyBlock: continuation.mode === "rebuild" ? continuation.historyBlock : void 0
    });
    const req = { prompt, model, effort, mode: spec.mode, cwd };
    const plan = continuation.mode === "native" ? adapter.planResume(continuation.sessionRef, req) : adapter.planDispatch(req);
    const eventsFile = path5.join(paths.runDir(runId), "events.ndjson");
    const startedAt = Date.now();
    let outcome = await execBackend(adapter.binary, plan.argv, plan.stdin, cwd, spec.timeoutMs, eventsFile);
    let text = adapter.extractText(outcome.stdout);
    let sessionRef = adapter.extractSessionRef(outcome.stdout);
    let contract = parseContractFromText(text);
    if (contract.needMoreContext && sessionRef) {
      const extra = bundleFiles({ files: contract.needMoreContext.files, cwd: sourceCwd }, config.defaults.tokenBudget);
      if (extra.ok && extra.files.length > 0) {
        const followPrompt = `\u8865\u5145\u4F60\u8BF7\u6C42\u7684\u6587\u4EF6\uFF1A

${extra.files.map((f) => `=== FILE: ${f.rel} ===
${f.content}
=== END FILE ===`).join("\n\n")}

\u8BF7\u57FA\u4E8E\u8865\u5145\u5185\u5BB9\u5B8C\u6210\u4EFB\u52A1\uFF0C\u8F93\u51FA\u8981\u6C42\u4E0D\u53D8\u3002`;
        const followPlan = adapter.planResume(sessionRef, { ...req, prompt: followPrompt });
        outcome = await execBackend(adapter.binary, followPlan.argv, followPlan.stdin, cwd, spec.timeoutMs, eventsFile);
        text = adapter.extractText(outcome.stdout);
        sessionRef = adapter.extractSessionRef(outcome.stdout) ?? sessionRef;
        contract = parseContractFromText(text);
        warnings.push(`\u88AB\u8C03\u65B9\u8BF7\u6C42\u8865\u5145\u4E0A\u4E0B\u6587\uFF0C\u5DF2\u81EA\u52A8\u8865\u4E00\u8F6E\uFF08${extra.files.length} \u4E2A\u6587\u4EF6\uFF09`);
      } else {
        warnings.push("\u88AB\u8C03\u65B9\u8BF7\u6C42\u8865\u5145\u4E0A\u4E0B\u6587\uFF0C\u4F46\u8BF7\u6C42\u7684\u6587\u4EF6\u4E0D\u53EF\u7528/\u88AB guard \u62D2\u7EDD");
      }
    }
    const durationMs = Date.now() - startedAt;
    if (outcome.timedOut) {
      writeResult(runId, {
        status: "timeout",
        summary: `\u4EFB\u52A1\u8D85\u65F6\uFF08${spec.timeoutMs}ms\uFF09\u88AB\u7EC8\u6B62\u3002${sessionRef ? `\u4F1A\u8BDD ${sessionRef} \u53EF\u7528 followup \u7EED\u63A5\uFF0C\u4E0D\u8981\u91CD\u590D\u6D3E\u6D3B\u3002` : ""}`,
        evidence: [],
        session_ref: sessionRef,
        warnings
      });
      return;
    }
    const errorClass = outcome.code !== 0 ? adapter.classifyError(outcome.stdout + outcome.stderr, outcome.code) : void 0;
    if (errorClass) {
      writeResult(runId, {
        status: errorClass,
        summary: errorClass === "auth_required" ? `${backend} \u767B\u5F55\u6001\u5931\u6548\u3002\u4FEE\u590D\uFF1A${adapter.loginCommand}` : `${backend} \u8FD4\u56DE ${errorClass}\u3002\u8BE6\u89C1 events.ndjson\u3002`,
        evidence: [],
        fix_command: errorClass === "auth_required" ? adapter.loginCommand : void 0,
        warnings
      });
      return;
    }
    if (outcome.code !== 0) {
      writeResult(runId, {
        status: "failed",
        summary: `${backend} \u9000\u51FA\u7801 ${outcome.code ?? "null\uFF08\u8FDB\u7A0B\u542F\u52A8\u5931\u8D25\uFF09"}\u3002stderr\uFF1A${outcome.stderr.slice(0, 500)}${text.trim() ? `
\u4E2D\u65AD\u524D\u7684\u8F93\u51FA\u7247\u6BB5\uFF1A${text.slice(0, 1e3)}` : ""}`,
        evidence: [],
        session_ref: sessionRef,
        warnings
      });
      return;
    }
    const patchFile = wtDir ? collectPatch(runId, wtDir) : void 0;
    const result = {
      status: contract.result ? "ok" : "contract_violated",
      summary: contract.result?.summary ?? text.slice(0, 6e3),
      evidence: verifyEvidence(contract.result?.evidence ?? [], cwd),
      confidence: contract.result?.confidence,
      artifacts: patchFile ? { patch: patchFile, files: [] } : void 0,
      usage: { ...adapter.extractUsage?.(outcome.stdout), durationMs },
      session_ref: sessionRef,
      takeover_command: sessionRef ? `cd ${JSON.stringify(cwd)} && ${adapter.interactiveResume(sessionRef)}` : void 0,
      warnings: contract.result ? warnings : [...warnings, "\u8F93\u51FA\u672A\u9075\u5B88\u7ED3\u679C\u5951\u7EA6\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u539F\u6587\u6458\u8981"]
    };
    if (result.status === "contract_violated" && result.summary.trim()) result.status = "ok";
    writeResult(runId, result);
    if (threadId) {
      appendTurn(threadId, {
        at: Date.now(),
        backend,
        model,
        sessionRef,
        objective: spec.task.objective.slice(0, 500),
        resultSummary: result.summary.slice(0, 2e3),
        files: bundle.files.map((f) => f.rel),
        cwd
      });
    }
  } catch (err) {
    writeResult(runId, {
      status: "failed",
      summary: `worker \u5F02\u5E38\uFF1A${err instanceof Error ? err.message : String(err)}`,
      evidence: [],
      warnings
    });
  } finally {
    clearInterval(heartbeatTimer);
    releaseSlot(backendSlot);
    releaseSlot(globalSlot);
  }
}
export {
  runWorker
};
//# sourceMappingURL=worker-OUZTMHCN.js.map