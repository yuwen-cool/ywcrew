import fs from "node:fs";
import { paths } from "./paths.js";
import { Config, ConfigSchema, CapabilitiesCache, CapabilitiesCacheSchema } from "./schema.js";
import { atomicWriteJson, readJson } from "../core/store.js";

export function loadConfig(): Config {
  const raw = readJson<unknown>(paths.config);
  if (!raw) return ConfigSchema.parse({});
  return ConfigSchema.parse(raw);
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
