import type { BackendId } from "../config/schema.js";
import type { Adapter } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { grokAdapter } from "./grok.js";
import { kimiAdapter } from "./kimi.js";
import { agyAdapter } from "./agy.js";

export const adapters: Record<BackendId, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
  kimi: kimiAdapter,
  agy: agyAdapter,
};

export function getAdapter(id: BackendId): Adapter {
  const a = adapters[id];
  if (!a) throw new Error(`未知后端: ${id}`);
  return a;
}
