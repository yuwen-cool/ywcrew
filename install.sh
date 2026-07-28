#!/usr/bin/env bash
# ywcrew 一键安装：curl -fsSL https://raw.githubusercontent.com/yuwen-cool/ywcrew/main/install.sh | bash
# 不需要任何账号。唯一前置要求是 Node.js ≥ 20（用它自带的包安装器装到全局）。
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 需要 Node.js ≥ 20，请先安装: https://nodejs.org（或 brew install node）"
  exit 1
fi
major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
if [ "${major}" -lt 20 ]; then
  echo "✗ Node 版本过低（$(node -v)），需要 ≥ 20"
  exit 1
fi

echo "▸ 下载并安装 ywcrew（来自 GitHub 仓库，无需任何账号）…"
npm install -g --silent https://github.com/yuwen-cool/ywcrew/archive/refs/heads/main.tar.gz

echo "▸ 初始化：探测本地 agent CLI 并分发技能…"
ywcrew init --yes
