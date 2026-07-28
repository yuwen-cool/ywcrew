import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, loadCapabilities } from "../config/load.js";
import { renderDynamicSections } from "./skill-render.js";

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
  // 按用户真实配置渲染动态段落（后端表/路由表/panel）；无配置时保留静态占位
  try {
    const config = loadConfig();
    const caps = loadCapabilities();
    const dynamic = renderDynamicSections(config, caps);
    const skillFile = path.join(target, "SKILL.md");
    const content = fs.readFileSync(skillFile, "utf8");
    if (dynamic) {
      fs.writeFileSync(skillFile, content.replace("<!-- YWCREW:DYNAMIC -->", dynamic.trim()));
    } else {
      fs.writeFileSync(
        skillFile,
        content.replace(
          "<!-- YWCREW:DYNAMIC -->",
          "## 后端与路由\n\n尚未配置。先让用户运行 `ywcrew init`，再用 `ywcrew backends` 查询可用后端。",
        ),
      );
    }
  } catch {
    /* 渲染失败保留原始模板 */
  }
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
    // 宿主装了但 skills 目录还没建过（很多宿主首次装技能才建目录）：
    // 宿主根目录（~/.cursor 等）存在即可安全创建其 skills 子目录
    const created: HostTarget[] = [];
    const home = os.homedir();
    const roots: HostTarget[] = [
      { name: "Cursor", skillDir: path.join(home, ".cursor", "skills") },
      { name: "Claude Code", skillDir: path.join(home, ".claude", "skills") },
      { name: "Codex", skillDir: path.join(home, ".codex", "skills") },
      { name: "Grok", skillDir: path.join(home, ".grok", "skills") },
      { name: "Kimi", skillDir: path.join(home, ".kimi-code", "skills") },
    ];
    for (const h of roots) {
      if (fs.existsSync(path.dirname(h.skillDir))) {
        fs.mkdirSync(h.skillDir, { recursive: true });
        created.push(h);
      }
    }
    if (created.length > 0) {
      for (const h of created) {
        copySkill(h.skillDir);
        console.log(`✅ ${h.name}: 已创建 skills 目录并放置技能 → ${h.skillDir}/ywcrew`);
      }
      return;
    }
    console.log("⚠️  未发现任何宿主（Cursor/Claude Code/Codex/Grok/Kimi 的配置目录都不存在）。");
    console.log(`   技能源文件在: ${skillSourceDir()}`);
    console.log("   装好宿主后重新运行 ywcrew install 即可；或手动复制上述目录到宿主的 skills 目录。");
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
