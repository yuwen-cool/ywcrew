import fs from "node:fs";
import path from "node:path";
import type { ResultContract } from "../config/schema.js";

/**
 * 自动核验模型返回的 evidence：文件真实存在、行号范围不越界。
 * 核验不通过不删除条目（模型可能引用了目录外的常识性路径），只如实标记，
 * 由宿主/用户据 verified 决定信任程度。
 */
export function verifyEvidence(evidence: ResultContract["evidence"], cwd: string): ResultContract["evidence"] {
  return evidence.map((e) => {
    const abs = path.resolve(cwd, e.file);
    if (!abs.startsWith(path.resolve(cwd) + path.sep)) {
      return { ...e, verified: false, verify_note: "文件路径在工作目录之外" };
    }
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      return { ...e, verified: false, verify_note: "文件不存在或不可读" };
    }
    if (e.lines) {
      const m = e.lines.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return { ...e, verified: false, verify_note: `行号格式无法解析: ${e.lines}` };
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      const total = content.split("\n").length;
      if (start < 1 || end < start || end > total) {
        return { ...e, verified: false, verify_note: `行号越界（文件共 ${total} 行）` };
      }
    }
    return { ...e, verified: true };
  });
}
