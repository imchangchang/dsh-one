#!/usr/bin/env bash
# 在 worktree 内运行：确认全部提交、跑自测、打 done/<slug> 标记。
# 打标后等主线空闲，由主线 session 跑 scripts/dev-merge.sh <slug> 合入。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
BRANCH=$(git branch --show-current)
case "$BRANCH" in
  agent/*) ;;
  *) echo "当前分支是 ${BRANCH:-（detached）}，dev-finish 只用于 agent/* 分支的 worktree。" >&2; exit 1 ;;
esac
SLUG=${BRANCH#agent/}

if [ -n "$(git status --porcelain)" ]; then
  echo "还有未提交改动，先提交再标记完成：" >&2
  git status --short
  exit 1
fi
if [ "$(git rev-parse HEAD)" = "$(git rev-parse main)" ]; then
  echo "分支 $BRANCH 相对 main 还没有任何提交，没什么好标记的。" >&2
  exit 1
fi

echo "== 自测（typecheck + test + build）=="
npm run typecheck
npm test
npm run build

git tag -f "done/$SLUG" HEAD >/dev/null
echo
echo "自测通过，已标记 done/$SLUG → $(git rev-parse --short HEAD)"
echo "主线空闲后由主线执行：scripts/dev-merge.sh $SLUG"
