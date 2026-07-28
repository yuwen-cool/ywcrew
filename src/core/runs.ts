import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "../config/paths.js";
import type { ResultContract, TaskSpec } from "../config/schema.js";
import { atomicWriteJson, readJson } from "./store.js";
import { processIdentity } from "./lock.js";

export type RunState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface RunMeta {
  runId: string;
  state: RunState;
  backend: string;
  model?: string;
  label?: string;
  threadId?: string;
  createdAt: number;
  updatedAt: number;
  workerPid?: number;
  workerIdentity?: string;
}

const HEARTBEAT_STALE_MS = 120_000;

export function createRun(spec: TaskSpec, threadId: string): RunMeta {
  const runId = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString("hex")}`;
  const dir = paths.runDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteJson(path.join(dir, "task.json"), spec);
  const meta: RunMeta = {
    runId,
    state: "queued",
    backend: spec.backend,
    model: spec.model,
    label: spec.label,
    threadId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  atomicWriteJson(path.join(dir, "meta.json"), meta);
  return meta;
}

export function updateRun(runId: string, patch: Partial<RunMeta>): void {
  const file = path.join(paths.runDir(runId), "meta.json");
  const meta = readJson<RunMeta>(file);
  if (!meta) return;
  atomicWriteJson(file, { ...meta, ...patch, updatedAt: Date.now() });
}

export function writeHeartbeat(runId: string): void {
  fs.writeFileSync(path.join(paths.runDir(runId), "heartbeat"), String(Date.now()));
}

export function writeResult(runId: string, result: ResultContract): void {
  atomicWriteJson(path.join(paths.runDir(runId), "result.json"), result);
  updateRun(runId, { state: result.status === "ok" ? "done" : "failed" });
}

export function readResult(runId: string): ResultContract | undefined {
  return readJson<ResultContract>(path.join(paths.runDir(runId), "result.json"));
}

export function readTask(runId: string): TaskSpec | undefined {
  return readJson<TaskSpec>(path.join(paths.runDir(runId), "task.json"));
}

/**
 * 读取 run 状态，惰性回收僵死 worker：
 * 心跳超时 + 进程身份（pid+启动时间）不再匹配 → kill 进程组并标 failed。
 */
const QUEUED_STALE_MS = 40 * 60_000; // worker 排队上限 30 分钟 + 余量

export function readRun(runId: string): RunMeta | undefined {
  const dir = paths.runDir(runId);
  const meta = readJson<RunMeta>(path.join(dir, "meta.json"));
  if (!meta) return undefined;
  if (meta.state !== "running" && meta.state !== "queued") return meta;

  let heartbeatAt = 0;
  try {
    heartbeatAt = Number(fs.readFileSync(path.join(dir, "heartbeat"), "utf8"));
  } catch {
    heartbeatAt = meta.updatedAt;
  }

  // queued 卡死：worker 从未拉起（spawn 失败/排队时被杀），永远不会有人来更新状态
  if (meta.state === "queued") {
    const staleFor = Date.now() - Math.max(heartbeatAt, meta.createdAt);
    if (staleFor < QUEUED_STALE_MS) return meta;
    if (meta.workerPid && meta.workerIdentity && processIdentity(meta.workerPid) === meta.workerIdentity)
      return meta; // 排队进程还活着
    updateRun(runId, { state: "failed" });
    if (!readResult(runId)) {
      writeResult(runId, {
        status: "failed",
        summary: "worker 未能启动或排队期间消亡（run 长期停留在 queued）。检查 worker.log 排查原因。",
        evidence: [],
        warnings: [],
      });
      updateRun(runId, { state: "failed" });
    }
    return readJson<RunMeta>(path.join(dir, "meta.json"));
  }

  if (Date.now() - heartbeatAt < HEARTBEAT_STALE_MS) return meta;

  // 心跳过期：核验进程身份后再判死。
  // 身份匹配 → 活着（可能刚从休眠恢复），不回收；
  // 身份不匹配 → PID 已被无关进程复用，绝不能发信号（会误杀无辜进程组），只标记失败。
  if (meta.workerPid && meta.workerIdentity) {
    const identity = processIdentity(meta.workerPid);
    if (identity === meta.workerIdentity) return meta;
  }
  updateRun(runId, { state: "failed" });
  const existing = readResult(runId);
  if (!existing) {
    writeResult(runId, {
      status: "failed",
      summary: "worker 心跳丢失且进程已不存在，已回收。events.ndjson 保留可排查。",
      evidence: [],
      warnings: [],
    });
    updateRun(runId, { state: "failed" });
  }
  return readJson<RunMeta>(path.join(dir, "meta.json"));
}

export function listRuns(limit = 20): RunMeta[] {
  if (!fs.existsSync(paths.runs)) return [];
  return fs
    .readdirSync(paths.runs)
    .map((id) => readJson<RunMeta>(path.join(paths.runs, id, "meta.json")))
    .filter((m): m is RunMeta => Boolean(m))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
