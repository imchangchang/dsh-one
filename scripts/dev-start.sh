#!/usr/bin/env bash
# 用法: scripts/dev-start.sh <任务名> [--force]
# 主线空闲 -> 在主线上锁，直接在主线开发；主线被占 -> 自动创建 worktree + agent/<任务名> 分支。
# --force 仅在"锁还在但工作区干净"（上一个 session 忘了释放）时接管主线；有未提交改动时一律不让用主线。
set -euo pipefail

FORCE=0
TASK=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      if [ -z "$TASK" ]; then TASK="$arg"; else
        echo "多余参数: $arg" >&2; exit 2
      fi ;;
  esac
done
[ -n "$TASK" ] || { echo "用法: scripts/dev-start.sh <任务名> [--force]" >&2; exit 2; }

SLUG=$(echo "$TASK" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
[ -n "$SLUG" ] || { echo "任务名转不出合法 slug: $TASK" >&2; exit 2; }

# 定位主线工作区根目录（即使当前在某个 worktree 里也能找到）
MAIN_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
cd "$MAIN_ROOT"
LOCK=.dev-lock

lock_exists() { [ -f "$LOCK" ]; }
tree_dirty() { [ -n "$(git status --porcelain)" ]; }

BRANCH="agent/$SLUG"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "分支 $BRANCH 已存在，换个任务名，或先用 scripts/dev-merge.sh $SLUG 合并/清理。" >&2
  exit 1
fi

if ! tree_dirty && { ! lock_exists || [ "$FORCE" -eq 1 ]; }; then
  if lock_exists; then
    echo "接管旧锁（--force），旧锁内容："
    cat "$LOCK"
  fi
  cat > "$LOCK" <<EOF
task: $TASK
branch: main
since: $(date '+%Y-%m-%d %H:%M:%S')
EOF
  echo "主线空闲，已上锁（${LOCK}）。直接在主线开发，收尾提交后跑 scripts/dev-unlock.sh 释放锁。"
  exit 0
fi

echo "主线被占用："
if lock_exists; then echo "--- $LOCK ---"; cat "$LOCK"; fi
if tree_dirty; then echo "--- 未提交改动 ---"; git status --short; fi
echo

WT=".worktrees/$SLUG"
git worktree add "$WT" -b "$BRANCH"
echo "安装依赖（npm ci）..."
npm ci --prefix "$WT" --no-audit --no-fund
cat <<EOF

worktree 就绪：${WT}（分支 ${BRANCH}）
接下来：
  cd $WT
  ...开发，高频小提交...
  scripts/dev-finish.sh        # 自测 + 打完成标记
主线空闲后，由主线 session 执行：
  scripts/dev-merge.sh $SLUG
EOF
