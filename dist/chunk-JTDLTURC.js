import {
  atomicWriteJson,
  paths,
  readJson
} from "./chunk-QEBUZYAA.js";

// src/adapters/exec.ts
import { execFile } from "child_process";
function run(cmd, args, timeoutMs = 2e4) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof err.code === "number" ? err.code : err ? err.code ?? 1 : 0;
      resolve({ code: typeof code === "number" ? code : 1, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}
async function binaryExists(cmd) {
  const r = await run(cmd, ["--version"]);
  if (r.code !== 0 && !r.stdout && !r.stderr) return { ok: false };
  const text = (r.stdout + r.stderr).trim();
  const m = text.match(/\d+\.\d+[.\d]*/);
  return { ok: r.code === 0 || Boolean(m), version: m?.[0] };
}
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return void 0;
  for (let end = text.length; end > start; end--) {
    const slice = text.slice(start, end);
    try {
      return JSON.parse(slice);
    } catch {
    }
  }
  return void 0;
}
function ndjsonEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
    }
  }
  return events;
}

// src/adapters/claude.ts
var claudeAdapter = {
  id: "claude",
  binary: "claude",
  loginCommand: "claude /login\uFF08\u4EA4\u4E92\u5F0F\u8FD0\u884C claude \u540E\u767B\u5F55\uFF09",
  capabilities: {
    supportsEffort: false,
    supportsNativeResume: true,
    supportsSchemaOutput: false,
    nativeReadOnly: true,
    readOnlyMechanism: "--permission-mode plan\uFF08\u884C\u4E3A\u7EA6\u675F\uFF0C\u975E OS \u7EA7\u9694\u79BB\uFF09"
  },
  async probe() {
    const bin = await binaryExists("claude");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    return { installed: true, version: bin.version, authState: "unknown" };
  },
  async listModels() {
    return [
      { id: "opus", efforts: [], isDefault: false },
      { id: "sonnet", efforts: [], isDefault: true },
      { id: "haiku", efforts: [], isDefault: false }
    ];
  },
  planDispatch(req) {
    const argv = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      req.mode === "read-only" ? "plan" : "acceptEdits"
    ];
    if (req.model) argv.push("--model", req.model);
    return { argv, stdin: req.prompt };
  },
  planResume(sessionRef, req) {
    const spec = this.planDispatch(req);
    return { argv: ["--resume", sessionRef, ...spec.argv], stdin: spec.stdin };
  },
  extractSessionRef(stdout) {
    for (const ev of ndjsonEvents(stdout)) {
      if (typeof ev.session_id === "string") return ev.session_id;
    }
    return void 0;
  },
  extractText(stdout) {
    for (const ev of ndjsonEvents(stdout)) {
      if (ev.type === "result" && typeof ev.result === "string") return ev.result;
    }
    return stdout.trim();
  },
  classifyError(output, _exitCode) {
    const t = output.toLowerCase();
    if (t.includes("please run /login") || t.includes("not logged in") || t.includes("invalid api key"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("usage limit") || t.includes("quota")) return "quota";
    return void 0;
  },
  interactiveResume(sessionRef) {
    return `claude --resume ${sessionRef}`;
  }
};

// src/adapters/codex.ts
var codexAdapter = {
  id: "codex",
  binary: "codex",
  loginCommand: "codex login",
  capabilities: {
    supportsEffort: true,
    supportsNativeResume: true,
    supportsSchemaOutput: true,
    nativeReadOnly: true,
    readOnlyMechanism: "--sandbox read-only\uFF08\u539F\u751F\u6C99\u7BB1\uFF09"
  },
  async probe() {
    const bin = await binaryExists("codex");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    return { installed: true, version: bin.version, authState: "unknown" };
  },
  async listModels() {
    return [
      { id: "gpt-5.6-sol", efforts: ["low", "medium", "high"], isDefault: true },
      { id: "gpt-5.6-terra", efforts: ["low", "medium", "high"], isDefault: false }
    ];
  },
  planDispatch(req) {
    const globalArgs = [
      "-a",
      "never",
      "-s",
      req.mode === "read-only" ? "read-only" : "workspace-write",
      "-C",
      req.cwd
    ];
    if (req.model) globalArgs.push("-m", req.model);
    if (req.effort) globalArgs.push("-c", `model_reasoning_effort=${req.effort}`);
    const execArgs = ["exec", "--json"];
    if (req.schemaPath) execArgs.push("--output-schema", req.schemaPath);
    execArgs.push("-");
    return { argv: [...globalArgs, ...execArgs], stdin: req.prompt };
  },
  planResume(sessionRef, req) {
    const spec = this.planDispatch(req);
    const execIdx = spec.argv.indexOf("exec");
    const argv = [...spec.argv.slice(0, execIdx + 1), "resume", sessionRef, ...spec.argv.slice(execIdx + 1)];
    return { argv, stdin: spec.stdin };
  },
  extractSessionRef(stdout) {
    for (const ev of ndjsonEvents(stdout)) {
      const id = ev.thread_id ?? ev.session_id ?? ev.conversation_id;
      if (typeof id === "string") return id;
    }
    return void 0;
  },
  extractText(stdout) {
    let last = "";
    for (const ev of ndjsonEvents(stdout)) {
      if (ev.type === "item.completed") {
        const item = ev.item;
        if (item?.type === "agent_message" && typeof item.text === "string") last = item.text;
      }
    }
    return last || stdout.trim();
  },
  classifyError(output, _exitCode) {
    const t = output.toLowerCase();
    if (t.includes("not logged in") || t.includes("please run `codex login`") || t.includes("401"))
      return "auth_required";
    if (t.includes("usage limit") || t.includes("rate limit") || t.includes("quota")) return "quota";
    return void 0;
  },
  extractUsage(stdout) {
    for (const ev of ndjsonEvents(stdout)) {
      if (ev.type === "turn.completed") {
        const u = ev.usage;
        if (u) return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
      }
    }
    return void 0;
  },
  interactiveResume(sessionRef) {
    return `codex resume ${sessionRef}`;
  }
};

// src/adapters/grok.ts
var grokAdapter = {
  id: "grok",
  binary: "grok",
  loginCommand: "grok login",
  capabilities: {
    supportsEffort: true,
    supportsNativeResume: true,
    supportsSchemaOutput: true,
    nativeReadOnly: true,
    readOnlyMechanism: "--permission-mode plan + --sandbox\uFF08\u884C\u4E3A\u7EA6\u675F+\u6C99\u7BB1\u914D\u7F6E\uFF09"
  },
  async probe() {
    const bin = await binaryExists("grok");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    const models = await run("grok", ["models"], 6e4);
    const all = models.stdout + models.stderr;
    const authState = /logged in/i.test(all) ? "ok" : /not authenticated/i.test(all) ? "unauthenticated" : "unknown";
    return { installed: true, version: bin.version, authState };
  },
  async listModels() {
    const r = await run("grok", ["models"], 6e4);
    const models = [];
    for (const line of r.stdout.split("\n")) {
      const m = line.match(/^\s*\*?\s*([\w.-]+)\s*(\(default\))?\s*$/);
      if (m && m[1] && !/^(available|default)/i.test(m[1])) {
        models.push({ id: m[1], efforts: ["low", "medium", "high"], isDefault: Boolean(m[2]) });
      }
    }
    return models;
  },
  planDispatch(req) {
    const argv = [
      "--output-format",
      "json",
      "--permission-mode",
      req.mode === "read-only" ? "plan" : "auto",
      "--cwd",
      req.cwd,
      "--no-subagents"
    ];
    if (req.model) argv.push("-m", req.model);
    if (req.effort) argv.push("--reasoning-effort", req.effort);
    if (req.schemaPath) argv.push("--json-schema", `@${req.schemaPath}`);
    argv.push("--prompt-file", "/dev/stdin");
    return { argv, stdin: req.prompt };
  },
  planResume(sessionRef, req) {
    const spec = this.planDispatch(req);
    return { argv: ["-r", sessionRef, ...spec.argv], stdin: spec.stdin };
  },
  // 实测 --output-format json 信封：{text, stopReason, sessionId, usage, modelUsage, ...}
  extractSessionRef(stdout) {
    const parsed = extractJsonObject(stdout);
    if (parsed && typeof parsed.sessionId === "string") return parsed.sessionId;
    const m = stdout.match(/"session_?id"\s*:\s*"([0-9a-f-]{36})"/i);
    return m?.[1];
  },
  extractText(stdout) {
    const parsed = extractJsonObject(stdout);
    if (parsed) {
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed.result === "string") return parsed.result;
    }
    return stdout.trim();
  },
  extractUsage(stdout) {
    const parsed = extractJsonObject(stdout);
    if (!parsed?.usage) return void 0;
    return { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens };
  },
  classifyError(output, _exitCode) {
    const t = output.toLowerCase();
    if (t.includes("not authenticated") || t.includes("please sign in") || t.includes("grok login"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("quota")) return "quota";
    return void 0;
  },
  interactiveResume(sessionRef) {
    return `grok -r ${sessionRef}`;
  }
};

// src/adapters/kimi.ts
var kimiAdapter = {
  id: "kimi",
  binary: "kimi",
  loginCommand: "kimi login",
  capabilities: {
    supportsEffort: false,
    supportsNativeResume: true,
    supportsSchemaOutput: false,
    nativeReadOnly: false,
    readOnlyMechanism: "-p \u6A21\u5F0F\u4E0D\u63A5\u53D7\u4EFB\u4F55\u6743\u9650 flag\uFF08\u5B9E\u6D4B\u4E92\u65A5\uFF09\u2192 worktree \u9694\u79BB + prompt \u7EA6\u675F"
  },
  async probe() {
    const bin = await binaryExists("kimi");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    const r = await run("kimi", ["provider", "list"]);
    const authState = /oauth|managed/i.test(r.stdout) ? "ok" : "unauthenticated";
    return { installed: true, version: bin.version, authState };
  },
  async listModels() {
    const r = await run("kimi", ["provider", "list"]);
    const models = [];
    const defaultMatch = r.stdout.match(/Default model:\s*(\S+)/);
    if (defaultMatch) models.push({ id: defaultMatch[1], efforts: [], isDefault: true });
    return models;
  },
  planDispatch(req) {
    const argv = ["-p", req.prompt, "--output-format", "stream-json"];
    if (req.model) argv.push("-m", req.model);
    return { argv };
  },
  planResume(sessionRef, req) {
    const spec = this.planDispatch(req);
    return { argv: ["-r", sessionRef, ...spec.argv] };
  },
  extractSessionRef(stdout) {
    const m = stdout.match(/session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0];
    for (const ev of ndjsonEvents(stdout)) {
      const id = ev.session_id ?? ev.sessionId;
      if (typeof id === "string") return id;
    }
    return void 0;
  },
  extractText(stdout) {
    let text = "";
    for (const ev of ndjsonEvents(stdout)) {
      if (typeof ev.content === "string" && (ev.role === "assistant" || ev.type === "message"))
        text = ev.content;
      if (ev.type === "result" && typeof ev.result === "string") text = ev.result;
    }
    return text || stdout.trim();
  },
  classifyError(output, _exitCode) {
    const t = output.toLowerCase();
    if (t.includes("not logged in") || t.includes("unauthorized") || t.includes("login required"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("quota")) return "quota";
    return void 0;
  },
  interactiveResume(sessionRef) {
    return `kimi -r ${sessionRef}`;
  }
};

// src/adapters/agy.ts
var EFFORTS = ["low", "medium", "high"];
function decomposeAgyModel(raw) {
  for (const e of EFFORTS) {
    if (raw.endsWith(`-${e}`)) return { base: raw.slice(0, -(e.length + 1)), effort: e };
  }
  return { base: raw };
}
var agyAdapter = {
  id: "agy",
  binary: "agy",
  loginCommand: "agy\uFF08\u4EA4\u4E92\u5F0F\u542F\u52A8\u540E\u767B\u5F55\uFF09",
  capabilities: {
    supportsEffort: true,
    supportsNativeResume: true,
    supportsSchemaOutput: false,
    nativeReadOnly: true,
    readOnlyMechanism: "--mode plan + --sandbox\uFF08\u884C\u4E3A\u7EA6\u675F+\u7EC8\u7AEF\u9650\u5236\u6C99\u7BB1\uFF09"
  },
  async probe() {
    const bin = await binaryExists("agy");
    if (!bin.ok) return { installed: false, authState: "unknown" };
    const r = await run("agy", ["models"], 6e4);
    const all = r.stdout + r.stderr;
    const authState = /sign in|authentication required/i.test(all) ? "unauthenticated" : r.code === 0 && r.stdout.trim().length > 0 ? "ok" : "unknown";
    return { installed: true, version: bin.version, authState };
  },
  async listModels() {
    const r = await run("agy", ["models"]);
    const byBase = /* @__PURE__ */ new Map();
    for (const line of r.stdout.split("\n")) {
      const raw = line.trim();
      if (!raw || raw.includes(" ")) continue;
      const { base, effort } = decomposeAgyModel(raw);
      if (!byBase.has(base)) byBase.set(base, /* @__PURE__ */ new Set());
      if (effort) byBase.get(base).add(effort);
    }
    return [...byBase.entries()].map(([id, efforts]) => ({
      id,
      efforts: [...efforts],
      isDefault: false
    }));
  },
  planDispatch(req) {
    const argv = ["-p", req.prompt, "--print-timeout", "20m"];
    argv.push("--mode", req.mode === "read-only" ? "plan" : "accept-edits");
    if (req.model) {
      const { base, effort: embedded } = decomposeAgyModel(req.model);
      const hasEffortVariants = /^(gemini|gpt-oss)/i.test(base);
      const effort = embedded ?? (hasEffortVariants ? req.effort : void 0);
      argv.push("--model", effort && hasEffortVariants ? `${base}-${effort}` : req.model);
    } else if (req.effort) {
      argv.push("--effort", req.effort);
    }
    return { argv };
  },
  planResume(sessionRef, req) {
    const spec = this.planDispatch(req);
    return { argv: ["--conversation", sessionRef, ...spec.argv] };
  },
  extractSessionRef(stdout) {
    const m = stdout.match(/conversation[_ ]?id["\s:]*([\w-]{8,})/i);
    return m?.[1];
  },
  extractText(stdout) {
    return stdout.trim();
  },
  classifyError(output, _exitCode) {
    const t = output.toLowerCase();
    if (t.includes("authentication required") || t.includes("authentication failed") || t.includes("not logged in") || t.includes("sign in") || t.includes("unauthenticated"))
      return "auth_required";
    if (t.includes("rate limit") || t.includes("quota")) return "quota";
    return void 0;
  },
  interactiveResume(sessionRef) {
    return `agy --conversation ${sessionRef}`;
  }
};

// src/adapters/registry.ts
var adapters = {
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
  kimi: kimiAdapter,
  agy: agyAdapter
};
function getAdapter(id) {
  const a = adapters[id];
  if (!a) throw new Error(`\u672A\u77E5\u540E\u7AEF: ${id}`);
  return a;
}

// src/core/threads.ts
import crypto from "crypto";
var HISTORY_TOKEN_CAP = 8e3;
var estimateTokens = (s) => Math.ceil(s.length / 3.6);
function createThread() {
  const t = { threadId: crypto.randomUUID(), createdAt: Date.now(), turns: [] };
  atomicWriteJson(paths.threadFile(t.threadId), t);
  return t;
}
function getThread(threadId) {
  return readJson(paths.threadFile(threadId));
}
function appendTurn(threadId, turn) {
  const t = getThread(threadId);
  if (!t) return;
  t.turns.push(turn);
  atomicWriteJson(paths.threadFile(threadId), t);
}
function planContinuation(threadId, targetBackend) {
  if (!threadId) return { mode: "fresh" };
  const thread = getThread(threadId);
  if (!thread || thread.turns.length === 0) return { mode: "fresh" };
  const last = thread.turns[thread.turns.length - 1];
  if (last.backend === targetBackend && last.sessionRef) {
    return { mode: "native", sessionRef: last.sessionRef, cwd: last.cwd };
  }
  const kept = [];
  let budget = HISTORY_TOKEN_CAP;
  const elided = [];
  for (let i = thread.turns.length - 1; i >= 0; i--) {
    const turn = thread.turns[i];
    const cost = estimateTokens(turn.objective + turn.resultSummary);
    if (budget - cost > 0) {
      kept.unshift(turn);
      budget -= cost;
    } else {
      elided.unshift(turn);
    }
  }
  const parts = [];
  if (elided.length > 0) {
    parts.push(
      `\uFF08\u66F4\u65E9\u7684 ${elided.length} \u8F6E\u8BA8\u8BBA\u5DF2\u6298\u53E0\uFF1A${elided.map((t) => `${t.backend} \u8BA8\u8BBA\u8FC7\u300C${t.objective.slice(0, 60)}\u300D`).join("\uFF1B")}\uFF09`
    );
  }
  for (const turn of kept) {
    parts.push(`### ${turn.backend}${turn.model ? `(${turn.model})` : ""} \u7684\u4E00\u8F6E
\u95EE\u9898\uFF1A${turn.objective}
\u7ED3\u8BBA\uFF1A${turn.resultSummary}`);
  }
  return { mode: "rebuild", historyBlock: parts.join("\n\n") };
}

export {
  extractJsonObject,
  adapters,
  getAdapter,
  createThread,
  getThread,
  appendTurn,
  planContinuation
};
//# sourceMappingURL=chunk-JTDLTURC.js.map