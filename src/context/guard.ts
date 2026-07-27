import fs from "node:fs";
import path from "node:path";

/** 已知凭据文件（按 basename 精确/前缀匹配，避免 *key* 误杀 keyboard.ts 之类） */
const CREDENTIAL_BASENAMES = new Set([
  ".env",
  ".npmrc",
  ".netrc",
  ".pgpass",
  "credentials",
  "credentials.json",
  "service-account.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
]);
const CREDENTIAL_PREFIXES = [".env.", "id_rsa.", "id_ed25519."];
const CREDENTIAL_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".keystore"]);
const CREDENTIAL_DIRS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);

/** 内容特征：私钥块、常见 token 格式 */
const CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI 风格
  /\bghp_[A-Za-z0-9]{36,}\b/, // GitHub PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
];

export interface GuardVerdict {
  allowed: boolean;
  reason?: string;
}

/** 路径级检查：containment + symlink 逃逸 + 凭据文件名 */
export function checkPath(absFile: string, rootDir: string): GuardVerdict {
  const real = fs.existsSync(absFile) ? fs.realpathSync(absFile) : absFile;
  const realRoot = fs.realpathSync(rootDir);
  if (!real.startsWith(realRoot + path.sep) && real !== realRoot) {
    return { allowed: false, reason: `路径逃逸工作区: ${absFile}` };
  }
  const base = path.basename(real);
  if (CREDENTIAL_BASENAMES.has(base)) return { allowed: false, reason: `凭据文件: ${base}` };
  if (CREDENTIAL_PREFIXES.some((p) => base.startsWith(p)))
    return { allowed: false, reason: `凭据文件: ${base}` };
  if (CREDENTIAL_EXTENSIONS.has(path.extname(base)))
    return { allowed: false, reason: `密钥类扩展名: ${base}` };
  for (const seg of real.split(path.sep)) {
    if (CREDENTIAL_DIRS.has(seg)) return { allowed: false, reason: `敏感目录: ${seg}` };
  }
  return { allowed: true };
}

/** 内容级扫描：检测到密钥特征即拒绝该文件 */
export function checkContent(content: string, file: string): GuardVerdict {
  for (const re of CONTENT_PATTERNS) {
    if (re.test(content)) return { allowed: false, reason: `内容含密钥特征 (${re.source.slice(0, 30)}…): ${file}` };
  }
  return { allowed: true };
}
