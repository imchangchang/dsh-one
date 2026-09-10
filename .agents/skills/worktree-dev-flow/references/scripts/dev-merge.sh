#!/usr/bin/env bash
# 用法: [MERGE_TARGET=<branch>] scripts/dev-merge.sh <slug>
#   —— 在集成线运行，把已完成的 worktree 分支合入集成线（默认 main）。
# 流程：校验 -> 在 worktree 里 rebase 到最新集成线 -> rebase 后复测 -> --no-ff 合入 -> 清理。
# 集成线不开发，只负责测试、集成和合入；合入必须串行：一次只跑一个 dev-merge，
# 等它完全结束（含末尾重建 dist）再合下一个任务。
# 串行靠 main-lock.sh 的写锁强制（不是约定）：从校验到合入全程持锁，
# 并发跑第二个 dev-merge 会拿不到锁直接退出，杜绝两个进程同时写集成线。
# 不带参数时列出所有待合并的 done 标记。
#
# MERGE_TARGET：集成线分支名，默认 main。指定它可把任务合到别的长期分支
# （一条 main + 若干长期分支的并行集成线）。该分支必须已被某个 worktree 检出：
# rebase 目标、合并执行位置、复测和 dist 重建都在那个 worktree 里进行，主工作区不受影响。
set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "用法: MERGE_TARGET=<branch> scripts/dev-merge.sh <slug>" >&2
  echo "待合并的任务："
  git tag -l 'done/*' | sed 's/^done\//  /' || true
  exit 2
fi

MAIN_ROOT=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
cd "$MAIN_ROOT"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$SCRIPT_DIR/main-lock.sh"
BRANCH="agent/$SLUG"
TARGET="${MERGE_TARGET:-main}"

git show-ref --verify --quiet "refs/heads/$BRANCH" || { echo "分支 $BRANCH 不存在。" >&2; exit 1; }
git show-ref --verify --quiet "refs/heads/$TARGET" || { echo "集成线分支 $TARGET 不存在。" >&2; exit 1; }

# 检出集成线的那个 worktree：合并、复测、dist 重建都要在检出该分支的地方做——
# 在别处 merge 会移动别的分支，在那儿 build 产出的是别的分支的 dist。
TARGET_WT=$(git worktree list --porcelain | awk -v b="refs/heads/$TARGET" '
  /^worktree /{p=$2} /^branch /{if ($2==b) print p}')
[ -n "$TARGET_WT" ] || { echo "集成线分支 $TARGET 没有被任何 worktree 检出。" >&2; exit 1; }

# 拿写锁：之后所有写集成线的操作（rebase 结果、--no-ff 合并、清理、重建 dist）
# 都在锁内完成，EXIT trap 保证成功/失败/中断都释放。
acquire_main_lock "dev-merge $SLUG -> $TARGET" || exit 1
trap release_main_lock EXIT

git rev-parse --verify --quiet "refs/tags/done/$SLUG" >/dev/null || {
  echo "缺少 done/$SLUG 标记——先在对应 worktree 里跑 scripts/dev-finish.sh 完成自测。" >&2; exit 1; }
[ "$(git rev-parse "$BRANCH")" = "$(git rev-parse "done/$SLUG^{commit}")" ] || {
  echo "done/$SLUG 不在分支最新提交上（rebase 或新提交后没重跑 dev-finish）。" >&2; exit 1; }
[ -z "$(git -C "$TARGET_WT" status --porcelain)" ] || {
  echo "${TARGET_WT}（${TARGET}）有未提交改动，先收尾再合并：" >&2; git -C "$TARGET_WT" status --short; exit 1; }

WT=$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
  /^worktree /{p=$2} /^branch /{if ($2==b) print p}')
[ -n "$WT" ] || { echo "找不到 $BRANCH 对应的 worktree。" >&2; exit 1; }

echo "== rebase $BRANCH 到最新 $TARGET =="
# GIT_EDITOR=true：非交互场景跑 rebase/commit 会被 core.editor（常见配置 code --wait）
# 拉起外部编辑器并阻塞等待，导致窗口莫名弹出、流程挂死。冲突解决后的
# `git rebase --continue` 内部带 `-e`，必须显式抑制编辑器。
if ! GIT_EDITOR=true git -C "$WT" rebase "$TARGET"; then
  cat >&2 <<EOF
rebase 有冲突。进入 $WT 解决：
  cd $WT
  ...解决冲突后 git add，然后 GIT_EDITOR=true git rebase --continue...
  scripts/dev-finish.sh        # 重新自测 + 更新 done 标记
再回到集成线重跑：MERGE_TARGET=$TARGET scripts/dev-merge.sh $SLUG
EOF
  exit 1
fi

echo "== rebase 后复测 =="
npm --prefix "$WT" run typecheck
npm --prefix "$WT" test
npm --prefix "$WT" run build

SUMMARY=$(git log --reverse --format='- %s' "$TARGET..$BRANCH")
git -C "$TARGET_WT" merge --no-ff "$BRANCH" \
  -m "merge(agent): 合入 $SLUG" \
  -m "任务分支 $BRANCH 已完成自测（typecheck/test/build），包含提交：
$SUMMARY"

git worktree remove "$WT"
# -d 的「已合并」判定看的是当前 HEAD：必须在检出 $TARGET 的 worktree 里删，
# 否则分支只合进了 ${TARGET}、没合进 main 时会被误判成未合并。
git -C "$TARGET_WT" branch -d "$BRANCH" >/dev/null
git tag -d "done/$SLUG" >/dev/null

# 扩展运行时装载的是集成线的 dist/；合并只带了源码，不重建则 reload 后还是旧代码。
echo "== 重建 ${TARGET} 的 dist（${TARGET_WT}）=="
npm --prefix "$TARGET_WT" run build

echo
echo "已合入 $TARGET 并清理 worktree / 分支 / done 标记（$TARGET 的 dist 已重建，reload 窗口生效）。"
