#!/usr/bin/env bash
# 用法: scripts/dev-unlock.sh [--force]   —— 释放主线开发锁（.dev-lock）。
# 还有未提交改动时拒绝释放，除非 --force（改动会留给下一个 session，一般不该这么干）。
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
