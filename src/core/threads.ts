import crypto from "node:crypto";
import type { BackendId } from "../config/schema.js";
import { paths } from "../config/paths.js";
import { atomicWriteJson, readJson } from "./store.js";

export interface ThreadTurn {
  at: number;
  backend: BackendId;
  model?: string;
  sessionRef?: string;
  objective: string;
  resultSummary: string;
  files: string[];
  /** 实际执行目录（可能是 worktree）。kimi 等把会话绑定到创建目录，续聊必须回到原地跑 */
  cwd?: string;
}

export interface Thread {
  threadId: string;
  createdAt: number;
  turns: ThreadTurn[];
}

const HISTORY_TOKEN_CAP = 8_000;
const estimateTokens = (s: string) => Math.ceil(s.length / 3.6);

export function createThread(): Thread {
  const t: Thread = { threadId: crypto.randomUUID(), createdAt: Date.now(), turns: [] };
  atomicWriteJson(paths.threadFile(t.threadId), t);
  return t;
}

export function getThread(threadId: string): Thread | undefined {
  return readJson<Thread>(paths.threadFile(threadId));
}

export function appendTurn(threadId: string, turn: ThreadTurn): void {
  const t = getThread(threadId);
  if (!t) return;
  t.turns.push(turn);
  atomicWriteJson(paths.threadFile(threadId), t);
}

export type ContinuationPlan =
  | { mode: "native"; sessionRef: string; cwd?: string }
  | { mode: "rebuild"; historyBlock: string }
  | { mode: "fresh" };

/**
 * 续聊路由：
 * - 目标后端与线程最后一轮相同且有原生会话 ID → native resume（保被调方 KV 缓存，近零成本）
 * - 否则重建历史：选材可以从新到旧，呈现必须严格时间正序（终审修正），
 *   超预算时旧轮折叠为一句话，最近轮保留完整摘要。
 */
export function planContinuation(threadId: string | undefined, targetBackend: BackendId): ContinuationPlan {
  if (!threadId) return { mode: "fresh" };
  const thread = getThread(threadId);
  if (!thread || thread.turns.length === 0) return { mode: "fresh" };

  const last = thread.turns[thread.turns.length - 1];
  if (last.backend === targetBackend && last.sessionRef) {
    return { mode: "native", sessionRef: last.sessionRef, cwd: last.cwd };
  }

  // 从新到旧挑选放得下的轮次（新轮优先保真），再按时间正序呈现
  const kept: ThreadTurn[] = [];
  let budget = HISTORY_TOKEN_CAP;
  const elided: ThreadTurn[] = [];
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
  const parts: string[] = [];
  if (elided.length > 0) {
    parts.push(
      `（更早的 ${elided.length} 轮讨论已折叠：${elided.map((t) => `${t.backend} 讨论过「${t.objective.slice(0, 60)}」`).join("；")}）`,
    );
  }
  for (const turn of kept) {
    parts.push(`### ${turn.backend}${turn.model ? `(${turn.model})` : ""} 的一轮\n问题：${turn.objective}\n结论：${turn.resultSummary}`);
  }
  return { mode: "rebuild", historyBlock: parts.join("\n\n") };
}
