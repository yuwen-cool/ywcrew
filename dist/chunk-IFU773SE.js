import {
  atomicWriteJson,
  paths,
  readJson
} from "./chunk-QEBUZYAA.js";

// src/core/lock.ts
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
var LEASE_INIT_GRACE_MS = 15e3;
function processIdentity(pid) {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim() || void 0;
  } catch {
    return void 0;
  }
}
function leaseAlive(lease) {
  const identity = processIdentity(lease.pid);
  return identity !== void 0 && identity === lease.pidStartedAt;
}
function tryAcquireSlot(scope, maxSlots) {
  const scopeDir = path.join(paths.locks, scope);
  fs.mkdirSync(scopeDir, { recursive: true });
  const myIdentity = processIdentity(process.pid) ?? String(process.pid);
  for (let i = 0; i < maxSlots; i++) {
    const slotDir = path.join(scopeDir, `slot-${i}`);
    try {
      fs.mkdirSync(slotDir);
    } catch {
      const lease = readJson(path.join(slotDir, "lease.json"));
      if (lease && leaseAlive(lease)) continue;
      if (!lease) {
        try {
          if (Date.now() - fs.statSync(slotDir).mtimeMs < LEASE_INIT_GRACE_MS) continue;
        } catch {
          continue;
        }
      }
      try {
        const reclaimMark = path.join(scopeDir, `reclaim-${i}-${process.pid}-${Date.now()}`);
        fs.renameSync(slotDir, reclaimMark);
        fs.rmSync(reclaimMark, { recursive: true, force: true });
        fs.mkdirSync(slotDir);
      } catch {
        continue;
      }
    }
    atomicWriteJson(path.join(slotDir, "lease.json"), {
      pid: process.pid,
      pidStartedAt: myIdentity,
      acquiredAt: Date.now(),
      renewedAt: Date.now()
    });
    return slotDir;
  }
  return void 0;
}
function renewSlot(slotDir) {
  const lease = readJson(path.join(slotDir, "lease.json"));
  if (lease && lease.pid === process.pid) {
    atomicWriteJson(path.join(slotDir, "lease.json"), { ...lease, renewedAt: Date.now() });
  }
}
function releaseSlot(slotDir) {
  const lease = readJson(path.join(slotDir, "lease.json"));
  if (lease && lease.pid !== process.pid) return;
  fs.rmSync(slotDir, { recursive: true, force: true });
}

// src/core/runs.ts
import fs2 from "fs";
import path2 from "path";
import crypto from "crypto";
var HEARTBEAT_STALE_MS = 12e4;
function createRun(spec, threadId) {
  const runId = `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
  const dir = paths.runDir(runId);
  fs2.mkdirSync(dir, { recursive: true });
  atomicWriteJson(path2.join(dir, "task.json"), spec);
  const meta = {
    runId,
    state: "queued",
    backend: spec.backend,
    model: spec.model,
    label: spec.label,
    threadId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  atomicWriteJson(path2.join(dir, "meta.json"), meta);
  return meta;
}
function updateRun(runId, patch) {
  const file = path2.join(paths.runDir(runId), "meta.json");
  const meta = readJson(file);
  if (!meta) return;
  atomicWriteJson(file, { ...meta, ...patch, updatedAt: Date.now() });
}
function writeHeartbeat(runId) {
  fs2.writeFileSync(path2.join(paths.runDir(runId), "heartbeat"), String(Date.now()));
}
function writeResult(runId, result) {
  atomicWriteJson(path2.join(paths.runDir(runId), "result.json"), result);
  updateRun(runId, { state: result.status === "ok" ? "done" : "failed" });
}
function readResult(runId) {
  return readJson(path2.join(paths.runDir(runId), "result.json"));
}
function readTask(runId) {
  return readJson(path2.join(paths.runDir(runId), "task.json"));
}
var QUEUED_STALE_MS = 40 * 6e4;
function readRun(runId) {
  const dir = paths.runDir(runId);
  const meta = readJson(path2.join(dir, "meta.json"));
  if (!meta) return void 0;
  if (meta.state !== "running" && meta.state !== "queued") return meta;
  let heartbeatAt = 0;
  try {
    heartbeatAt = Number(fs2.readFileSync(path2.join(dir, "heartbeat"), "utf8"));
  } catch {
    heartbeatAt = meta.updatedAt;
  }
  if (meta.state === "queued") {
    const staleFor = Date.now() - Math.max(heartbeatAt, meta.createdAt);
    if (staleFor < QUEUED_STALE_MS) return meta;
    if (meta.workerPid && meta.workerIdentity && processIdentity(meta.workerPid) === meta.workerIdentity)
      return meta;
    updateRun(runId, { state: "failed" });
    if (!readResult(runId)) {
      writeResult(runId, {
        status: "failed",
        summary: "worker \u672A\u80FD\u542F\u52A8\u6216\u6392\u961F\u671F\u95F4\u6D88\u4EA1\uFF08run \u957F\u671F\u505C\u7559\u5728 queued\uFF09\u3002\u68C0\u67E5 worker.log \u6392\u67E5\u539F\u56E0\u3002",
        evidence: [],
        warnings: []
      });
      updateRun(runId, { state: "failed" });
    }
    return readJson(path2.join(dir, "meta.json"));
  }
  if (Date.now() - heartbeatAt < HEARTBEAT_STALE_MS) return meta;
  if (meta.workerPid && meta.workerIdentity) {
    const identity = processIdentity(meta.workerPid);
    if (identity === meta.workerIdentity) return meta;
  }
  updateRun(runId, { state: "failed" });
  const existing = readResult(runId);
  if (!existing) {
    writeResult(runId, {
      status: "failed",
      summary: "worker \u5FC3\u8DF3\u4E22\u5931\u4E14\u8FDB\u7A0B\u5DF2\u4E0D\u5B58\u5728\uFF0C\u5DF2\u56DE\u6536\u3002events.ndjson \u4FDD\u7559\u53EF\u6392\u67E5\u3002",
      evidence: [],
      warnings: []
    });
    updateRun(runId, { state: "failed" });
  }
  return readJson(path2.join(dir, "meta.json"));
}
function listRuns(limit = 20) {
  if (!fs2.existsSync(paths.runs)) return [];
  return fs2.readdirSync(paths.runs).map((id) => readJson(path2.join(paths.runs, id, "meta.json"))).filter((m) => Boolean(m)).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export {
  processIdentity,
  tryAcquireSlot,
  renewSlot,
  releaseSlot,
  createRun,
  updateRun,
  writeHeartbeat,
  writeResult,
  readResult,
  readTask,
  readRun,
  listRuns
};
//# sourceMappingURL=chunk-IFU773SE.js.map