#!/usr/bin/env bash
# 发布门禁：version + CHANGELOG 收口 + 干净打包 + vsix 校验 + tag 三件套强绑定。
#
# 用法:
#   scripts/release-gate.sh               # dry-run：只输出将执行的步骤 + 跑只读校验，不写任何文件
#   scripts/release-gate.sh --apply       # 执行（两段式）：
#                                           第一遍：交互输入版本 → bump package.json version
#                                                   + CHANGELOG [Unreleased] → [x.y.z] → 停下
#                                           人工 review 并 commit 后重跑 --apply：
#                                           干净 checkout → npm ci → typecheck/test/build/vsce package
#                                           → 验 vsix 内容与版本 → 打 tag v<x.y.z> → 校验 tag == 打包 commit
#
# 不跑 vsce publish：发布动作永远由人执行（dev-merge 合入 + 人工验收之后）。
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
find_vsix() { ls -t dsh-one-*.vsix 2>/dev/null | head -1 || true; }

# 校验 vsix：内容（dist/assets/package.json/README/LICENSE，无 src/test/docs/map/ts）+ 版本 == 期望
verify_vsix() {
  local vsix=$1 expect=$2 actual list
  [ -f "$vsix" ] || die "找不到 vsix: $vsix"
  actual=$(unzip -p "$vsix" package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")
  [ "$actual" = "$expect" ] || die "vsix 内版本 $actual != 期望 $expect"
  list=$(unzip -l "$vsix")
  for f in dist/extension.js package.json README.md LICENSE; do
    echo "$list" | grep -q "$f" || die "vsix 缺少 $f"
  done
  echo "$list" | grep -q 'assets/' || die "vsix 缺少 assets/"
  for bad in ' src/' ' test/' ' docs/' '.map' '.ts' 'node_modules/'; do
    echo "$list" | grep -q "$bad" && die "vsix 不应包含 $bad"
  done
  say "  vsix 内容与版本校验通过（version=${actual}）"
}

report_state() {
  say "当前状态:"
  say "  package.json version = $VERSION"
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
  local vsix; vsix=$(find_vsix)
  [ -n "$vsix" ] && say "  已有 vsix: $vsix" || say "  无已打包 vsix"
}

plan() {
  say "将执行的步骤（--apply）:"
  if changelog_unreleased; then
    say "  1. 交互输入新版本号并校验 semver"
    say "  2. 改 package.json version → <新版本>；CHANGELOG [Unreleased] → [<新版本>]"
    say "  3. 停下：人工 review + git commit（建议只提交这两个文件）"
  fi
  say "  4. 干净 checkout（临时 worktree @ HEAD）→ npm ci → typecheck + test + build + vsce package"
  say "  5. 验 vsix 内容（dist/assets/package.json/README/LICENSE，无 src/test/docs/map/ts）与版本 == <版本>"
  say "  6. 打 annotated tag v<版本>（指向 HEAD）并校验 == 打包 commit"
  say "  7. 把 vsix 复制到仓库根目录"
}

dry_run() {
  report_state
  say ""
  plan
  # 已收口且有 tag/vsix 时补做只读的一致性校验
  if ! changelog_unreleased && changelog_has "$VERSION" && tag_exists "$VERSION"; then
    local vsix tagcommit headcommit
    vsix=$(find_vsix)
    if [ -n "$vsix" ]; then
      say ""
      say "校验已产出的 vsix: $vsix"
      verify_vsix "$vsix" "$VERSION"
      tagcommit=$(git rev-parse "v$VERSION^{commit}"); headcommit=$(git rev-parse HEAD)
      if [ "$tagcommit" = "$headcommit" ]; then
        say "  tag v$VERSION 指向 HEAD == 打包 commit ✓"
      else
        say "  注意: tag v$VERSION 指向 $(git rev-parse --short "v$VERSION")，当前 HEAD 是 $(git rev-parse --short HEAD)"
      fi
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
    read -rp "输入新版本号（当前 ${VERSION}）: " newver
    [ -n "$newver" ] || die "未输入版本号"
    echo "$newver" | grep -Eq "$SEMVER_RE" || die "版本号必须形如 x.y.z（${newver}）"
    tag_exists "$newver" && die "tag v$newver 已存在，确认是否已发布过"
    node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" "$newver"
    node -e "const fs=require('fs');const p='CHANGELOG.md';const s=fs.readFileSync(p,'utf8');const m=/^## \[Unreleased\]$/m;if(!m.test(s)){console.error('CHANGELOG 无 [Unreleased] 段');process.exit(1)}fs.writeFileSync(p,s.replace(m,'## ['+process.argv[1]+']'))" "$newver"
    say "已改: package.json version → ${newver}；CHANGELOG [Unreleased] → [${newver}]"
    say ""
    say "下一步（人工）:"
    say "  1. git diff 检查这两个文件"
    say "  2. git commit（建议只提交这两个文件，如: git commit -m 'release: v$newver'）"
    say "  3. 重跑 scripts/release-gate.sh --apply，完成 干净打包 + 验 vsix + 打 tag"
    exit 0
  fi

  # 第二遍：已收口，干净打包 + 验 vsix + 打 tag
  changelog_has "$VERSION" || die "CHANGELOG 没有 [$VERSION] 段也没有 [Unreleased]，状态异常"
  worktree_clean || die "工作树有未提交改动：bump 要先提交（打包 commit 必须是 HEAD）"
  tag_exists "$VERSION" && die "tag v$VERSION 已存在，疑似已发布过（确认后可用 git tag -d v$VERSION 重来）"

  local pkgdir=".dev-host/release-pkg-$VERSION"
  say "创建干净 checkout: ${pkgdir}（commit $(git rev-parse --short HEAD)）"
  git worktree add --detach "$pkgdir" HEAD >/dev/null
  trap 'git worktree remove --force "$pkgdir" 2>/dev/null || true' EXIT
  (
    cd "$pkgdir"
    npm ci --no-audit --no-fund >/dev/null
    npm run typecheck
    npm test
    npm run build
    npx vsce package
  )
  local vsix="$pkgdir/dsh-one-$VERSION.vsix"
  verify_vsix "$vsix" "$VERSION"
  git tag -a "v$VERSION" -m "release v$VERSION"
  local tagcommit headcommit
  tagcommit=$(git rev-parse "v$VERSION^{commit}"); headcommit=$(git rev-parse HEAD)
  [ "$tagcommit" = "$headcommit" ] || die "tag v$VERSION ($tagcommit) != HEAD ($headcommit)"
  cp "$vsix" "dsh-one-$VERSION.vsix"
  git worktree remove --force "$pkgdir"
  trap - EXIT
  say ""
  say "完成: dsh-one-$VERSION.vsix（打包 commit $(git rev-parse --short HEAD) == tag v${VERSION}）"
  say "下一步: 按 docs/release-checklist.md 人工验收，然后 vsce publish（本脚本不发布）"
}

case "${1:-}" in
  -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | grep -v '^!' ; exit 0 ;;
  --apply) apply ;;
  "") dry_run ;;
  *) die "未知参数: $1（用法: scripts/release-gate.sh [--apply]）" ;;
esac
