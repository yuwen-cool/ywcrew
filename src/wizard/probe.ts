import { BACKEND_IDS, type CapabilitiesCache } from "../config/schema.js";
import { adapters } from "../adapters/registry.js";
import { saveCapabilities } from "../config/load.js";

/** 探测全部后端：安装态 + 登录态 + 模型清单，写入 capabilities 缓存 */
export async function probeAll(): Promise<CapabilitiesCache> {
  const cache: CapabilitiesCache = { fetchedAt: new Date().toISOString(), backends: {} as CapabilitiesCache["backends"] };
  await Promise.all(
    BACKEND_IDS.map(async (id) => {
      const adapter = adapters[id];
      const probe = await adapter.probe();
      let models: Awaited<ReturnType<typeof adapter.listModels>> = [];
      if (probe.installed) {
        try {
          models = await adapter.listModels();
        } catch {
          /* 离线或未登录时容忍 */
        }
      }
      cache.backends[id] = {
        installed: probe.installed,
        version: probe.version,
        authState: probe.authState,
        models,
      };
    }),
  );
  saveCapabilities(cache);
  return cache;
}
