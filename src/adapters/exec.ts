import { execFile } from "node:child_process";

/** probe/listModels 用的轻量执行器（非任务执行——任务走 detached worker） */
export function run(
  cmd: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException).code === "number"
        ? ((err as NodeJS.ErrnoException).code as unknown as number)
        : err
          ? ((err as { code?: number }).code ?? 1)
          : 0;
      resolve({ code: typeof code === "number" ? code : 1, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

export async function binaryExists(cmd: string): Promise<{ ok: boolean; version?: string }> {
  const r = await run(cmd, ["--version"]);
  if (r.code !== 0 && !r.stdout && !r.stderr) return { ok: false };
  const text = (r.stdout + r.stderr).trim();
  const m = text.match(/\d+\.\d+[.\d]*/);
  return { ok: r.code === 0 || Boolean(m), version: m?.[0] };
}

/** 从混合输出里尽力抽出第一个合法 JSON 对象（kimi/agy 契约兜底用） */
export function extractJsonObject(text: string): unknown | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  for (let end = text.length; end > start; end--) {
    const slice = text.slice(start, end);
    try {
      return JSON.parse(slice);
    } catch {
      /* shrink */
    }
  }
  return undefined;
}

export function ndjsonEvents(stdout: string): unknown[] {
  const events: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* partial line */
    }
  }
  return events;
}
