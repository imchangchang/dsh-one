#!/usr/bin/env bash
# 发布门禁（本地段）：version + CHANGELOG 收口 + tag 强绑定。
# 构建与 Release 产物由 GitHub Actions 完成（tag push 触发 .github/workflows/release.yml），
# 本地不再打包 vsix——上市场的产物 = GitHub Release 的 vsix；验收 GitHub Release 产物后才 publish。
#
# 用法:
#   scripts/release-gate.sh               # dry-run：只读校验，不写任何文件
#   scripts/release-gate.sh --apply       # 执行（两段式）：
#                                           第一遍：交互输入新版本（建议 patch+1）→ bump package.json version
#                                                   + CHANGELOG [Unreleased] → [x.y.z] → 停下
#                                           人工 review 并 commit 后重跑 --apply：
#                                           校验收口与工作树 → 打 tag v<x.y.z> → 校验 tag == HEAD
#                                           输出 push 指令（push 后 Actions 构建 GitHub Release）
#
# 不跑 vsce package / vsce publish：打包由 Actions 做，发布永远由人执行（验收 Release 产物之后）。
# 版本策略：每次发布 patch +1（首发 1.0.0）；版本唯一——市场不可同版本重发。
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+$'

say() { printf '%s\n' "$*"; }
die() { say "错误: $*" >&2; exit 1; }

changelog_unreleased() { grep -q '^## \[Unreleased\]$' CHANGELOG.md; }
changelog_has() { grep -q "^## \[$1\]$" CHANGELOG.md; }
tag_exists() { git rev-parse -q --verify "refs/tags/v$1" >/dev/null; }
worktree_clean() { [ -z "$(git status --porcelain)" ]; }
suggest_patch() { node -e 'const v=process.argv[1].split(".").map(Number); v[2]++; console.log(v.join("."))' "$VERSION"; }
newver_gt() { node -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);for(let i=0;i<3;i++){if(b[i]>a[i])process.exit(0);if(b[i]<a[i])process.exit(1)}process.exit(1)' "$1" "$2"; }

report_state() {
  say "当前状态:"
  say "  package.json version = ${VERSION}（建议下次发布 patch+1: $(suggest_patch)）"
  if changelog_unreleased; then
    say "  CHANGELOG: 有 [Unreleased]（未收口）"
  else
    changelog_has "$VERSION" && say "  CHANGELOG: 已收口为 [$VERSION]" || say "  CHANGELOG: 无 [Unreleased] 也无 [$VERSION]（状态异常）"
  fi
  if tag_exists "$VERSION"; then
    say "  tag v$VERSION 已存在（指向 $(git rev-parse --short "refs/tags/v$VERSION")）"
  else
    say "  tag v$VERSION 不存在"
  fi
  worktree_clean && say "  工作树干净" || say "  工作树有未提交改动"
}

plan() {
  say "将执行的步骤（--apply）:"
  if changelog_unreleased; then
    say "  1. 交互输入新版本号并校验（须 > 当前 ${VERSION}，建议 patch+1）"
    say "  2. 改 package.json version → <新版本>；CHANGELOG [Unreleased] → [<新版本>]"
    say "  3. 停下：人工 review + git commit（建议只提交这两个文件）"
  fi
  say "  4. 校验工作树干净 + 打 annotated tag v<版本>（指向 HEAD）并校验 == HEAD"
  say "  5. 输出 push 指令（git push origin main v<版本>）——push 后触发 .github/workflows/release.yml 构建 GitHub Release 产物"
  say "  6. 人工验收 GitHub Release 产物（docs/release-checklist.md）→ 验收通过后 vsce publish 该产物（由人执行，带路径不重打包）"
}

dry_run() {
  report_state
  say ""
  plan
  # 已收口且有 tag 时补做只读的一致性校验
  if ! changelog_unreleased && changelog_has "$VERSION" && tag_exists "$VERSION"; then
    local tagcommit headcommit
    tagcommit=$(git rev-parse "v$VERSION^{commit}"); headcommit=$(git rev-parse HEAD)
    if [ "$tagcommit" = "$headcommit" ]; then
      say ""
      say "  tag v$VERSION 指向 HEAD == 收口 commit ✓（push 后 Actions 将构建 Release 产物）"
    else
      say ""
      say "  注意: tag v$VERSION 指向 $(git rev-parse --short "v$VERSION")，当前 HEAD 是 $(git rev-parse --short HEAD)"
    fi
  fi
  say ""
  say "（dry-run 结束，未写任何文件。--apply 才真正执行。）"
}

apply() {
  report_state
  say ""
  if changelog_unreleased; then
    # 第一遍：bump 后停下
    worktree_clean || die "工作树有未提交改动，先提交或清理再跑"
    local newver
    read -rp "输入新版本号（当前 ${VERSION}，建议 patch+1: $(suggest_patch)）: " newver
    [ -n "$newver" ] || die "未输入版本号"
    echo "$newver" | grep -Eq "$SEMVER_RE" || die "版本号必须形如 x.y.z（${newver}）"
    newver_gt "$VERSION" "$newver" || die "新版本 ${newver} 不大于当前 ${VERSION}（每次发布 patch+1）"
    tag_exists "$newver" && die "tag v$newver 已存在，确认是否已发布过"
    node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" "$newver"
    node -e "const fs=require('fs');const p='CHANGELOG.md';const s=fs.readFileSync(p,'utf8');const m=/^## \[Unreleased\]$/m;if(!m.test(s)){console.error('CHANGELOG 无 [Unreleased] 段');process.exit(1)}fs.writeFileSync(p,s.replace(m,'## ['+process.argv[1]+']'))" "$newver"
    say "已改: package.json version → ${newver}；CHANGELOG [Unreleased] → [${newver}]"
    say ""
    say "下一步（人工）:"
    say "  1. git diff 检查这两个文件"
    say "  2. git commit（建议只提交这两个文件，如: git commit -m 'release: v$newver'）"
    say "  3. 重跑 scripts/release-gate.sh --apply 打 tag，然后 git push origin main v$newver 触发 Actions 构建 GitHub Release"
    exit 0
  fi

  # 第二遍：已收口，打 tag 并校验（构建由 Actions 做，本地不再打包）
  changelog_has "$VERSION" || die "CHANGELOG 没有 [$VERSION] 段也没有 [Unreleased]，状态异常"
  worktree_clean || die "工作树有未提交改动：bump 要先提交（tag 必须指向收口 commit）"
  tag_exists "$VERSION" && die "tag v$VERSION 已存在，疑似已发布过（确认后可用 git tag -d v$VERSION 重来）"

  git tag -a "v$VERSION" -m "release v$VERSION"
  local tagcommit headcommit
  tagcommit=$(git rev-parse "v$VERSION^{commit}"); headcommit=$(git rev-parse HEAD)
  [ "$tagcommit" = "$headcommit" ] || die "tag v$VERSION ($tagcommit) != HEAD ($headcommit)"
  say ""
  say "完成: tag v${VERSION} 指向 HEAD（$(git rev-parse --short HEAD)）"
  say "下一步:"
  say "  1. git push origin main v${VERSION}（触发 .github/workflows/release.yml）"
  say "  2. 等 Actions 跑完，GitHub Release 出现 dsh-one-${VERSION}.vsix"
  say "  3. 按 docs/release-checklist.md 验收 GitHub Release 产物（不本地打包）"
  say "  4. 验收通过后执行 npx vsce publish dsh-one-${VERSION}.vsix（带路径、用 Release 那份，不重打包）"
}

case "${1:-}" in
  -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | grep -v '^!' ; exit 0 ;;
  --apply) apply ;;
  "") dry_run ;;
  *) die "未知参数: $1（用法: scripts/release-gate.sh [--apply]）" ;;
esac
