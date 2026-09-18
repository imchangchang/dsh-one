#!/usr/bin/env bash
# 平台兼容性合入门禁（#6）：扫描待合入分支相对集成线的新增行，命中平台相关代码时
# 要求任务逐项声明「这条平台路径在哪验证过」；命中按状态变量分叉的逻辑时要求给出
# 分支矩阵。缺失即拒绝合入，不做降级、不给静默通过。
#
# 用法: scripts/check-platform-compat.sh <branch>
#   <branch> 缺省为当前分支。dev-merge.sh 在校验阶段（i18n 门禁之后、rebase 之前）调用，
#   传当前待合入分支（agent/<slug>）；也可单独跑，exit 0 = 通过，非 0 = 拒绝合入
#   （并打印缺什么、模板长什么样）。
#
# 声明落点（唯一的、机器可检查的落点）：
#   test/sandbox/verify.<slug>.platform.json   —— <slug> 即分支名去掉 agent/ 前缀
#   格式与字段含义见 docs/development.md 的「合入门禁」一节；门禁拒绝时会直接打印
#   可复制的模板（缺失条目已按命中项填好 file/rule）。
#
# 基点同 i18n 门禁：默认 main，dev-merge 用 COMPAT_BASE 传集成线分支
# （合入 develop/* 这类长期分支时若不跟着换，整条分支与 main 之间的历史改动都会
# 被当成「新增行」来扫）。只看新增行，不扫整分支历史。
#
# 规则数据在 scripts/platform-compat-rules.json，扫描/校验实现在
# scripts/platformCompatScan.mjs（纯函数，单测在 test/platformCompatGate.test.ts）。
#
# 依赖: bash + node + git（与 check-i18n.sh 同一套，不新增依赖）。
set -euo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  BRANCH=$(git branch --show-current 2>/dev/null || true)
  [ -n "$BRANCH" ] || { echo "未指定分支且当前处于 detached HEAD。" >&2; exit 2; }
fi
git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null || {
  echo "分支 $BRANCH 不存在。" >&2; exit 2; }

BASE_REF="${COMPAT_BASE:-main}"
git rev-parse --verify --quiet "$BASE_REF" >/dev/null || {
  echo "集成线分支 $BASE_REF 不存在（用 COMPAT_BASE=<分支> 指定）。" >&2; exit 2; }
BASE=$(git merge-base "$BASE_REF" "$BRANCH")

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(git rev-parse --show-toplevel)
# slug 与 node 侧 slugFromBranch 保持同一口径（分支名里的 `/` 等不能进文件名）。
SLUG=$(printf '%s' "${BRANCH#agent/}" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/^-+|-+$//g')
DECL="test/sandbox/verify.${SLUG}.platform.json"

DIFF_FILE=$(mktemp)
DECL_FILE=$(mktemp)
trap 'rm -f "$DIFF_FILE" "$DECL_FILE"' EXIT

git diff -M --unified=0 "$BASE" "$BRANCH" > "$DIFF_FILE"
# 声明从**分支树**读（开发者提交的那一份），不是工作区；没有这个文件时把临时文件删掉，
# 让 node 侧按「缺声明文件」处理。
if ! git show "${BRANCH}:${DECL}" > "$DECL_FILE" 2>/dev/null; then
  rm -f "$DECL_FILE"
fi

set +e
OUTPUT=$(
  COMPAT_BRANCH="$BRANCH" \
  COMPAT_BASE_REF="$BASE_REF" \
  COMPAT_REPO="$REPO_ROOT" \
  COMPAT_DIFF="$DIFF_FILE" \
  COMPAT_DECL="$DECL_FILE" \
  node "$SCRIPT_DIR/platformCompatScan.mjs"
)
STATUS=$?
set -e

printf '%s\n' "$OUTPUT"
if [ "$STATUS" -ne 0 ]; then
  echo "平台兼容性合入门禁未通过，拒绝合入。" >&2
  exit 1
fi
exit 0
