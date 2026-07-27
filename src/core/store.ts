import fs from "node:fs";
import path from "node:path";

/** 原子写：tmp + rename + fsync（多宿主实例并发安全的基础） */
export function atomicWriteJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}
