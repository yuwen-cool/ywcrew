import fs from "node:fs";
import path from "node:path";
import { paths } from "../config/paths.js";
import type { BundledFile } from "../context/builder.js";

/**
 * strict 只读隔离：把白名单文件（已过 secret guard）物化到影子目录，
 * 被调模型的工作目录切到这里——无论它怎么探索，都只能看到白名单内的文件。
 * 这是对"权限档只是行为约束"的硬隔离补强。
 */
export function createShadowDir(runId: string, files: BundledFile[]): string {
  const dir = path.join(paths.home, "shadow", runId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    const dest = path.join(dir, f.rel);
    // 防路径逃逸：rel 必须落在影子目录内
    if (!path.resolve(dest).startsWith(path.resolve(dir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  return dir;
}
