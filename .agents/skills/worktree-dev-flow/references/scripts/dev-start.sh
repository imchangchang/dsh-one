#!/usr/bin/env bash
# 用法: scripts/dev-start.sh <任务名>
# 所有开发都在 worktree 里进行：创建 .worktrees/<slug>（分支 agent/<slug>）并装好依赖。
# 主线不开发，只负责测试、集成和合入（scripts/dev-merge.sh）。
set -euo pipefail

TASK=""
for arg in "$@"; do
  case "$arg" in
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)
      if [ -z "$TASK" ]; then TASK="$arg"; else
        echo "多余参数: $arg" >&2; exit 2
      fi ;;
  esac
done
[ -n "$TASK" ] || { echo "用法: scripts/dev-start.sh <任务名>" >&2; exit 2; }

SLUG=$(echo "$TASK" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
[ -n "$SLUG" ] || { echo "任务名转不出合法 slug: $TASK" >&2; exit 2; }

# 定位主线工作区根目录（即使当前在某个 worktree 里也能找到）
MAIN_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
cd "$MAIN_ROOT"

BRANCH="agent/$SLUG"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "分支 $BRANCH 已存在，换个任务名，或先用 scripts/dev-merge.sh $SLUG 合并/清理。" >&2
  exit 1
fi

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
然后由主线执行合入：
  scripts/dev-merge.sh $SLUG
EOF
