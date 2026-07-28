import type { BackendId, Effort, ModelInfo, ResultStatus, TaskMode } from "../config/schema.js";

export interface ProbeResult {
  installed: boolean;
  version?: string;
  authState: "ok" | "unauthenticated" | "unknown";
}

export interface DispatchRequest {
  prompt: string;
  model?: string;
  effort?: Effort;
  mode: TaskMode;
  cwd: string;
  /** 结构化输出的 JSON schema 文件路径（仅支持的后端使用） */
  schemaPath?: string;
}

export interface SpawnSpec {
  argv: string[];
  /** prompt 通过 stdin 传入（超长 prompt 避免 ARG_MAX） */
  stdin?: string;
}

export interface AdapterCapabilities {
  supportsEffort: boolean;
  supportsNativeResume: boolean;
  supportsSchemaOutput: boolean;
  /** 无头模式是否有原生只读档；false 时 worker 会用 worktree 兜底隔离读任务 */
  nativeReadOnly: boolean;
  /** 只读模式的实现语义说明（写进 doctor 输出，提醒用户这不是 OS 级隔离） */
  readOnlyMechanism: string;
}

/**
 * Adapter 是声明式的：只负责「怎么拼命令、怎么解析输出、怎么归类错误」，
 * 进程生命周期完全由 worker 统一管理。
 */
export interface Adapter {
  id: BackendId;
  binary: string;
  capabilities: AdapterCapabilities;
  /** 登录失效时给用户的确切修复命令 */
  loginCommand: string;

  probe(): Promise<ProbeResult>;
  listModels(): Promise<ModelInfo[]>;

  planDispatch(req: DispatchRequest): SpawnSpec;
  planResume(sessionRef: string, req: DispatchRequest): SpawnSpec;

  /** 从完整 stdout 中提取原生会话 ID（尽力而为，取不到则该线程降级为历史重建续聊） */
  extractSessionRef(stdout: string): string | undefined;
  /** 从完整 stdout 中提取最终回答文本 */
  extractText(stdout: string): string;
  /** 归类失败原因；返回 undefined 表示按普通 failed 处理 */
  classifyError(output: string, exitCode: number | null): ResultStatus | undefined;
  /** 可选：从输出提取 token 用量 */
  extractUsage?(stdout: string): { inputTokens?: number; outputTokens?: number } | undefined;
  /** 用户亲自接管会话的交互式命令（不含 cd 前缀，worker 负责拼目录） */
  interactiveResume(sessionRef: string): string;
}
