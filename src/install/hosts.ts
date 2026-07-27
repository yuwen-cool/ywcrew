import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface HostTarget {
  name: string;
  skillDir: string;
}

/** 宿主 skills 目录（存在才分发，不猜测、不新建宿主目录） */
function detectHosts(): { unified?: string; hosts: HostTarget[] } {
  const home = os.homedir();
  const unified = path.join(home, ".agents", "skills");
  const candidates: HostTarget[] = [
    { name: "Cursor", skillDir: path.join(home, ".cursor", "skills") },
    { name: "Claude Code", skillDir: path.join(home, ".claude", "skills") },
    { name: "Codex", skillDir: path.join(home, ".codex", "skills") },
    { name: "Grok", skillDir: path.join(home, ".grok", "skills") },
    { name: "Kimi", skillDir: path.join(home, ".kimi-code", "skills") },
  ];
  return {
    unified: fs.existsSync(unified) ? unified : undefined,
    hosts: candidates.filter((h) => fs.existsSync(h.skillDir)),
  };
}

function skillSourceDir(): string {
  // 入口（src/cli.ts 或 dist/cli.js）的上一级即包根；先 realpath 解掉全局 bin symlink
  const entry = fs.realpathSync(process.argv[1]);
  return path.resolve(path.dirname(entry), "..", "skills", "ywcrew");
}

function copySkill(targetParent: string): void {
  const target = path.join(targetParent, "ywcrew");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(skillSourceDir(), target, { recursive: true });
}

export function installSkills(): void {
  const { unified, hosts } = detectHosts();
  if (unified) {
    copySkill(unified);
    console.log(`✅ 检测到统一 skills 目录，已放置: ${unified}/ywcrew`);
    console.log("   （如果你的同步工具没有自动分发到各宿主，可再运行 ywcrew install --each）");
    if (!process.argv.includes("--each")) return;
  }
  if (hosts.length === 0 && !unified) {
    console.log("⚠️  未发现任何宿主 skills 目录。请手动把 skills/ywcrew 放入宿主的技能目录。");
    return;
  }
  for (const h of hosts) {
    copySkill(h.skillDir);
    console.log(`✅ ${h.name}: ${h.skillDir}/ywcrew`);
  }
}

export function doctorHosts(): void {
  const { unified, hosts } = detectHosts();
  console.log("宿主装载状态：");
  if (unified) {
    const ok = fs.existsSync(path.join(unified, "ywcrew", "SKILL.md"));
    console.log(`  ${ok ? "✅" : "❌"} 统一目录 ${unified} ${ok ? "" : "（运行 ywcrew install 修复）"}`);
  }
  for (const h of hosts) {
    const ok = fs.existsSync(path.join(h.skillDir, "ywcrew", "SKILL.md"));
    console.log(`  ${ok ? "✅" : "❌"} ${h.name} ${h.skillDir} ${ok ? "" : "（运行 ywcrew install 修复）"}`);
  }
}
