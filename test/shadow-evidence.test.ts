import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.YWCREW_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-shadow-home-"));

import { createShadowDir } from "../src/core/shadow.js";
import { verifyEvidence } from "../src/core/evidence.js";

describe("strict 影子目录", () => {
  it("只物化白名单文件，保留相对路径结构", () => {
    const dir = createShadowDir("test-run-1", [
      { rel: "src/a.ts", content: "export const a = 1;\n", tokens: 5 },
      { rel: "docs/readme.md", content: "# hi\n", tokens: 2 },
    ]);
    expect(fs.readFileSync(path.join(dir, "src/a.ts"), "utf8")).toContain("const a");
    expect(fs.readFileSync(path.join(dir, "docs/readme.md"), "utf8")).toContain("# hi");
    expect(fs.readdirSync(dir).sort()).toEqual(["docs", "src"]);
  });

  it("拒绝路径逃逸的 rel", () => {
    const dir = createShadowDir("test-run-2", [
      { rel: "../escape.txt", content: "x", tokens: 1 },
      { rel: "ok.txt", content: "y", tokens: 1 },
    ]);
    expect(fs.existsSync(path.join(dir, "..", "escape.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "ok.txt"))).toBe(true);
  });

  it("重复创建同 runId 会清空重建", () => {
    createShadowDir("test-run-3", [{ rel: "old.txt", content: "old", tokens: 1 }]);
    const dir = createShadowDir("test-run-3", [{ rel: "new.txt", content: "new", tokens: 1 }]);
    expect(fs.existsSync(path.join(dir, "old.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(true);
  });
});

describe("evidence 自动核验", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-ev-proj-"));
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src/x.ts"), "line1\nline2\nline3\n");

  it("文件存在且行号合法 → verified: true", () => {
    const out = verifyEvidence([{ file: "src/x.ts", lines: "1-3", claim: "c" }], proj);
    expect(out[0].verified).toBe(true);
    expect(out[0].verify_note).toBeUndefined();
  });

  it("行号越界 → verified: false + 原因", () => {
    const out = verifyEvidence([{ file: "src/x.ts", lines: "2-99", claim: "c" }], proj);
    expect(out[0].verified).toBe(false);
    expect(out[0].verify_note).toContain("越界");
  });

  it("文件不存在 → verified: false", () => {
    const out = verifyEvidence([{ file: "src/ghost.ts", claim: "c" }], proj);
    expect(out[0].verified).toBe(false);
    expect(out[0].verify_note).toContain("不存在");
  });

  it("路径逃逸 → verified: false", () => {
    const out = verifyEvidence([{ file: "../../etc/passwd", claim: "c" }], proj);
    expect(out[0].verified).toBe(false);
    expect(out[0].verify_note).toContain("之外");
  });

  it("单行号与无行号都能核验", () => {
    const out = verifyEvidence(
      [
        { file: "src/x.ts", lines: "2", claim: "c" },
        { file: "src/x.ts", claim: "c" },
      ],
      proj,
    );
    expect(out.every((e) => e.verified)).toBe(true);
  });
});
