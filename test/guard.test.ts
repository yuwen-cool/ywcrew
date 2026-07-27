import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkContent, checkPath } from "../src/context/guard.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-guard-"));

function touch(rel: string): string {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "content");
  return abs;
}

describe("checkPath", () => {
  it("拒绝 .env 及变体", () => {
    expect(checkPath(touch(".env"), tmp).allowed).toBe(false);
    expect(checkPath(touch(".env.local"), tmp).allowed).toBe(false);
  });
  it("拒绝密钥扩展名与凭据文件", () => {
    expect(checkPath(touch("certs/server.pem"), tmp).allowed).toBe(false);
    expect(checkPath(touch(".npmrc"), tmp).allowed).toBe(false);
    expect(checkPath(touch("id_rsa"), tmp).allowed).toBe(false);
  });
  it("不误杀 keyboard.ts / token.ts 这类正常代码文件", () => {
    expect(checkPath(touch("src/keyboard.ts"), tmp).allowed).toBe(true);
    expect(checkPath(touch("src/tokenizer.ts"), tmp).allowed).toBe(true);
  });
  it("拒绝路径逃逸工作区", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-outside-"));
    const f = path.join(outside, "a.txt");
    fs.writeFileSync(f, "x");
    expect(checkPath(f, tmp).allowed).toBe(false);
  });
  it("拒绝 symlink 逃逸", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ywcrew-sym-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "x");
    const link = path.join(tmp, "link.txt");
    fs.symlinkSync(path.join(outside, "secret.txt"), link);
    expect(checkPath(link, tmp).allowed).toBe(false);
  });
});

describe("checkContent", () => {
  it("拒绝私钥块与已知 token 格式", () => {
    expect(checkContent("-----BEGIN RSA PRIVATE KEY-----\nxxx", "a").allowed).toBe(false);
    expect(checkContent("const k = 'sk-abcdefghijklmnopqrstuvwx123456'", "a").allowed).toBe(false);
    expect(checkContent("token: ghp_" + "a".repeat(40), "a").allowed).toBe(false);
  });
  it("放行普通代码", () => {
    expect(checkContent("export const skew = 1; // risk-free", "a").allowed).toBe(true);
  });
});
