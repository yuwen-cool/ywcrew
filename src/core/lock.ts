import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths } from "../config/paths.js";
import { readJson, atomicWriteJson } from "./store.js";

interface Lease {
  pid: number;
  pidStartedAt: string;
  acquiredAt: number;
  renewedAt: number;
}

const LEASE_TTL_MS = 180_000; // 3 分钟未续租视为失效（宽容系统休眠）

/** 进程身份 = pid + 启动时间，防 PID 复用误判 */
export function processIdentity(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function leaseAlive(lease: Lease): boolean {
  if (Date.now() - lease.renewedAt < LEASE_TTL_MS) {
    const identity = processIdentity(lease.pid);
    if (identity && identity === lease.pidStartedAt) return true;
  }
  // TTL 过期或进程身份不符 → 死锁
  const identity = processIdentity(lease.pid);
  return identity === lease.pidStartedAt && Date.now() - lease.renewedAt < LEASE_TTL_MS;
}

/**
 * mkdir 原子锁实现的并发 slot lease。
 * slot 命名：<scope>/<index>，scope 是 backend id 或 "global"。
 */
export function tryAcquireSlot(scope: string, maxSlots: number): string | undefined {
  const scopeDir = path.join(paths.locks, scope);
  fs.mkdirSync(scopeDir, { recursive: true });
  const myIdentity = processIdentity(process.pid) ?? String(process.pid);

  for (let i = 0; i < maxSlots; i++) {
    const slotDir = path.join(scopeDir, `slot-${i}`);
    try {
      fs.mkdirSync(slotDir); // 原子：已存在则抛错
    } catch {
      // 被占用 → 检查是否僵尸 lease
      const lease = readJson<Lease>(path.join(slotDir, "lease.json"));
      if (lease && leaseAlive(lease)) continue;
      // 回收僵尸：先抢占标记再复用（rename 原子性保证只有一个回收者成功）
      try {
        const reclaimMark = path.join(scopeDir, `reclaim-${i}-${process.pid}-${Date.now()}`);
        fs.renameSync(slotDir, reclaimMark);
        fs.rmSync(reclaimMark, { recursive: true, force: true });
        fs.mkdirSync(slotDir);
      } catch {
        continue; // 别人先回收了
      }
    }
    atomicWriteJson(path.join(slotDir, "lease.json"), {
      pid: process.pid,
      pidStartedAt: myIdentity,
      acquiredAt: Date.now(),
      renewedAt: Date.now(),
    } satisfies Lease);
    return slotDir;
  }
  return undefined;
}

export function renewSlot(slotDir: string): void {
  const lease = readJson<Lease>(path.join(slotDir, "lease.json"));
  if (lease && lease.pid === process.pid) {
    atomicWriteJson(path.join(slotDir, "lease.json"), { ...lease, renewedAt: Date.now() });
  }
}

export function releaseSlot(slotDir: string): void {
  fs.rmSync(slotDir, { recursive: true, force: true });
}
