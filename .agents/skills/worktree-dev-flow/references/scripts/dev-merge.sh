#!/usr/bin/env bash
# 用法: scripts/dev-merge.sh <slug>   —— 在主线运行，把已完成的 worktree 分支合入 main。
# 流程：校验 -> 在 worktree 里 rebase 到最新 main -> rebase 后复测 -> --no-ff 合入 -> 清理。
# 主线不开发，只负责测试、集成和合入；合入必须串行：一次只跑一个 dev-merge，
# 等它完全结束（含末尾重建 dist）再合下一个任务。
# 串行靠 main-lock.sh 的主线写锁强制（不是约定）：从校验到合入全程持锁，
# 并发跑第二个 dev-merge 会拿不到锁直接退出，杜绝两个进程同时写 main。
# 不带参数时列出所有待合并的 done 标记。
set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "用法: scripts/dev-merge.sh <slug>" >&2
  echo "待合并的任务："
  git tag -l 'done/*' | sed 's/^done\//  /' || true
  exit 2
fi

MAIN_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
cd "$MAIN_ROOT"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$SCRIPT_DIR/main-lock.sh"
BRANCH="agent/$SLUG"

git show-ref --verify --quiet "refs/heads/$BRANCH" || { echo "分支 $BRANCH 不存在。" >&2; exit 1; }

# 拿主线写锁：之后所有写 main 的操作（rebase 结果、--no-ff 合并、清理、重建 dist）
# 都在锁内完成，EXIT trap 保证成功/失败/中断都释放。
acquire_main_lock "dev-merge $SLUG" || exit 1
trap release_main_lock EXIT

git rev-parse --verify --quiet "refs/tags/done/$SLUG" >/dev/null || {
  echo "缺少 done/$SLUG 标记——先在对应 worktree 里跑 scripts/dev-finish.sh 完成自测。" >&2; exit 1; }
[ "$(git rev-parse "$BRANCH")" = "$(git rev-parse "done/$SLUG^{commit}")" ] || {
  echo "done/$SLUG 不在分支最新提交上（rebase 或新提交后没重跑 dev-finish）。" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || {
  echo "主线有未提交改动，先收尾再合并：" >&2; git status --short; exit 1; }

WT=$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
  /^worktree /{p=$2} /^branch /{if ($2==b) print p}')
[ -n "$WT" ] || { echo "找不到 $BRANCH 对应的 worktree。" >&2; exit 1; }

echo "== rebase $BRANCH 到最新 main =="
if ! git -C "$WT" rebase main; then
  cat >&2 <<EOF
rebase 有冲突。进入 $WT 解决：
  cd $WT
  ...解决冲突后 git add，然后 git rebase --continue...
  scripts/dev-finish.sh        # 重新自测 + 更新 done 标记
再回到主线重跑：scripts/dev-merge.sh $SLUG
EOF
  exit 1
fi

echo "== rebase 后复测 =="
npm --prefix "$WT" run typecheck
npm --prefix "$WT" test
npm --prefix "$WT" run build

SUMMARY=$(git log --reverse --format='- %s' "main..$BRANCH")
git merge --no-ff "$BRANCH" \
  -m "merge(agent): 合入 $SLUG" \
  -m "任务分支 $BRANCH 已完成自测（typecheck/test/build），包含提交：
$SUMMARY"

git worktree remove "$WT"
git branch -d "$BRANCH" >/dev/null
git tag -d "done/$SLUG" >/dev/null

# 扩展运行时装载的是主线的 dist/；合并只带了源码，不重建则 reload 后还是旧代码。
echo "== 重建主线 dist =="
npm run build

echo
echo "已合入 main 并清理 worktree / 分支 / done 标记（dist 已重建，reload 窗口生效）。"
