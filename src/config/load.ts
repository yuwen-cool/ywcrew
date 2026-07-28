import fs from "node:fs";
import { paths } from "./paths.js";
import { Config, ConfigSchema, CapabilitiesCache, CapabilitiesCacheSchema } from "./schema.js";
import { atomicWriteJson, readJson } from "../core/store.js";

export function loadConfig(): Config {
  const raw = readJson<unknown>(paths.config);
  if (!raw) return ConfigSchema.parse({});
  // 绝不因解析失败而静默重置用户配置：报清楚路径让用户自己修
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`配置文件 ${paths.config} 不合法（未被覆盖，请手动修正或删除后重新 ywcrew init）：\n${issues}`);
  }
  return parsed.data;
}

export function saveConfig(config: Config): void {
  atomicWriteJson(paths.config, config);
}

export function loadCapabilities(): CapabilitiesCache | undefined {
  const raw = readJson<unknown>(paths.capabilities);
  if (!raw) return undefined;
  const parsed = CapabilitiesCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function saveCapabilities(cache: CapabilitiesCache): void {
  atomicWriteJson(paths.capabilities, cache);
}

export function ensureHome(): void {
  fs.mkdirSync(paths.runs, { recursive: true });
  fs.mkdirSync(paths.threads, { recursive: true });
  fs.mkdirSync(paths.locks, { recursive: true });
}
