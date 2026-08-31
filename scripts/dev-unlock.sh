#!/usr/bin/env bash
# 用法: scripts/dev-unlock.sh [--force]   —— 释放主线锁（.dev-lock）。
# 主线锁由 scripts/dev-merge.sh 在合并/集成期间持有，正常会自动释放；
# 这个脚本只用于清理残留锁（比如合并进程被杀掉）。
set -euo pipefail

MAIN_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
cd "$MAIN_ROOT"

[ -f .dev-lock ] || { echo "没有锁，无需释放。"; exit 0; }

if [ -n "$(git status --porcelain)" ] && [ "${1:-}" != "--force" ]; then
  echo "主线还有未提交改动，先提交收尾；确实要带着改动释放就加 --force：" >&2
  git status --short
  exit 1
fi

rm .dev-lock
echo "主线锁已释放。"
