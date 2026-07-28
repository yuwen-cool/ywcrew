import fs from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";
import ignore from "ignore";
import type { TaskSpec } from "../config/schema.js";
import { checkContent, checkPath } from "./guard.js";

export interface BundledFile {
  rel: string;
  content: string;
  tokens: number;
}

export interface BundleResult {
  ok: boolean;
  files: BundledFile[];
  skipped: Array<{ rel: string; reason: string }>;
  totalTokens: number;
  /** 超预算时的 per-file 用量报告（不静默截断，交回宿主收敛范围） */
  overBudgetReport?: string;
}

const estimateTokens = (s: string) => Math.ceil(s.length / 3.6);
const ALWAYS_IGNORE = ["node_modules/**", ".git/**", "dist/**", "build/**", "*.lock", "package-lock.json"];

export function bundleFiles(spec: Pick<TaskSpec, "files" | "cwd">, tokenBudget: number): BundleResult {
  const root = path.resolve(spec.cwd ?? process.cwd());
  const include = spec.files.filter((g) => !g.startsWith("!"));
  const exclude = spec.files.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  if (include.length === 0) return { ok: true, files: [], skipped: [], totalTokens: 0 };

  const ig = ignore().add(ALWAYS_IGNORE).add(exclude);
  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) ig.add(fs.readFileSync(gitignorePath, "utf8"));

  const matched = globSync(include, { cwd: root, dot: false, onlyFiles: true, followSymbolicLinks: false });
  const files: BundledFile[] = [];
  const skipped: Array<{ rel: string; reason: string }> = [];

  for (const rel of matched.sort()) {
    if (ig.ignores(rel)) {
      skipped.push({ rel, reason: "ignore 规则" });
      continue;
    }
    const abs = path.join(root, rel);
    const pathVerdict = checkPath(abs, root);
    if (!pathVerdict.allowed) {
      skipped.push({ rel, reason: pathVerdict.reason! });
      continue;
    }
    let content: string;
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 1024 * 1024) {
        skipped.push({ rel, reason: "单文件超 1MB" });
        continue;
      }
      content = fs.readFileSync(abs, "utf8");
    } catch {
      skipped.push({ rel, reason: "读取失败/二进制" });
      continue;
    }
    if (content.includes("\u0000")) {
      skipped.push({ rel, reason: "二进制文件" });
      continue;
    }
    const contentVerdict = checkContent(content, rel);
    if (!contentVerdict.allowed) {
      skipped.push({ rel, reason: contentVerdict.reason! });
      continue;
    }
    files.push({ rel, content, tokens: estimateTokens(content) });
  }

  const totalTokens = files.reduce((s, f) => s + f.tokens, 0);
  if (totalTokens > tokenBudget) {
    const report = files
      .sort((a, b) => b.tokens - a.tokens)
      .map((f) => `  ${f.rel}: ~${f.tokens} tokens`)
      .join("\n");
    return {
      ok: false,
      files: [],
      skipped,
      totalTokens,
      overBudgetReport: `文件总量 ~${totalTokens} tokens 超预算 ${tokenBudget}。请收敛 files glob。各文件用量：\n${report}`,
    };
  }
  return { ok: true, files, skipped, totalTokens };
}

const RESULT_CONTRACT_INSTRUCTIONS = `
## 输出要求（必须严格遵守）
你的最终回答必须是一个 JSON 对象（可以在推理后输出，但最终回答只含这个 JSON）：
{
  "summary": "结论与关键推理，中文，控制在 1500 字内",
  "evidence": [{"file": "路径", "lines": "12-40", "claim": "该证据支撑的论断"}],
  "confidence": "low|medium|high"
}
如果提供的上下文不足以完成任务，改为只输出：
{"status": "need_more_context", "files": ["你需要的文件相对路径"], "reason": "为什么需要"}
`.trim();

export interface RenderOptions {
  historyBlock?: string;
  omitContract?: boolean;
}

/** 渲染发给被调后端的完整 prompt：五段式 + 环境声明 + 历史 + 文件 + 契约 */
export function renderPrompt(spec: TaskSpec, bundle: BundleResult, opts: RenderOptions = {}): string {
  const t = spec.task;
  const parts: string[] = [];
  parts.push("# 任务委托（你对该项目零背景，以下是全部上下文）");
  parts.push(`## 项目背景\n${t.briefing}`);
  if (t.locations) parts.push(`## 关键位置\n${t.locations}`);
  parts.push(`## 任务目标\n${t.objective}`);
  if (t.constraints) parts.push(`## 边界约束\n${t.constraints}`);

  // 环境声明：被调的是 agentic CLI（可自行探索工作目录），不是一次性问答；
  // mode 行为约束在 prompt 层再声明一遍，与权限 flag / worktree / shadow 隔离形成双保险
  const modeStatement =
    spec.mode === "edit"
      ? "本次任务允许改代码：直接在工作目录中修改（这是隔离的 git 工作副本，改动会以 patch 收集交付，不会直接落到用户仓库）。完成后自行确认改动可通过构建/测试。"
      : "本次任务只读：不得修改、创建或删除任何文件，不得执行有副作用的命令。";
  const envStatement =
    spec.strict && spec.mode !== "edit"
      ? `你以 agentic 方式运行在一个严格隔离目录中：这里只物化了下方「参考文件」，项目的其他文件不存在于此，不要尝试读取白名单以外的内容；确需更多文件时用 need_more_context 请求。${modeStatement}`
      : `你以 agentic 方式运行在项目工作目录中。下方「参考文件」只是发起方挑选的起点，需要更多信息时优先自行读取工作目录中的其他文件，而不是急于求助。${modeStatement}`;
  parts.push(`## 执行环境\n${envStatement}`);

  if (opts.historyBlock) parts.push(`## 此前的讨论线程\n${opts.historyBlock}`);
  if (bundle.files.length > 0) {
    const fileBlocks = bundle.files
      .map((f) => `=== FILE: ${f.rel} ===\n${f.content}\n=== END FILE ===`)
      .join("\n\n");
    parts.push(`## 参考文件（共 ${bundle.files.length} 个）\n${fileBlocks}`);
  }

  // JSON 结果契约永远保留（worker 依赖它做结构化解析）；
  // 宿主的 output_contract 描述的是 summary 的内容组织形态，两者叠加而非互斥
  const contract = t.output_contract
    ? `${RESULT_CONTRACT_INSTRUCTIONS}\n\n其中 summary 字段的内容按以下要求组织：\n${t.output_contract}`
    : RESULT_CONTRACT_INSTRUCTIONS;
  parts.push(contract);
  return parts.join("\n\n");
}
