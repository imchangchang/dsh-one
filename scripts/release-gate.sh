#!/usr/bin/env bash
# 发布门禁（本地段）：version + CHANGELOG 收口 + tag 强绑定。
# 构建与 Release 产物由 GitHub Actions 完成（tag push 触发 .github/workflows/release.yml），
# 本地不再打包 vsix——上市场的产物 = GitHub Release 的 vsix；验收 GitHub Release 产物后才 publish。
#
# 版本两种：
#   - 正式版  x.y.z（如 1.0.0）：--apply 时消费 CHANGELOG [Unreleased] → [x.y.z]
#   - 预发布  x.y.z-rc.N（如 1.0.0-rc.1）：--apply 只 bump package.json，CHANGELOG [Unreleased] 不消费，
#     构建产物在 GitHub Release 标 prerelease（内测用），测试通过后发同核心的正式版才收口
#
# 用法:
#   scripts/release-gate.sh               # dry-run：只读校验，不写任何文件
#   scripts/release-gate.sh --apply       # 第一遍：交互输入新版本 → bump package.json；
#                                           正式版 + CHANGELOG [Unreleased] → [x.y.z] / rc 不动 → 停下
#   scripts/release-gate.sh --tag         # 第二遍：校验工作树与状态 → 打 tag v<版本> → 校验 == HEAD
#                                           （不依赖 CHANGELOG 是否被收口，rc 与正式版同一路径）
#
# 不跑 vsce package / vsce publish：打包由 Actions 做，发布永远由人执行（验收 Release 产物之后）。
# 版本策略：每次发布 +1（正式版 patch+1，rc 按 rc.N 递增）；市场不可同版本重发。
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
# 正式版 x.y.z，或预发布 x.y.z-rc.N
VER_RE='^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$'

say() { printf '%s\n' "$*"; }
die() { say "错误: $*" >&2; exit 1; }

changelog_unreleased() { grep -q '^## \[Unreleased\]$' CHANGELOG.md; }
changelog_has() { grep -q "^## \[$1\]$" CHANGELOG.md; }
tag_exists() { git rev-parse -q --verify "refs/tags/v$1" >/dev/null; }
worktree_clean() { [ -z "$(git status --porcelain)" ]; }
# 预发布版本（rc）：只 bump package.json，CHANGELOG 不消费
is_rc() { echo "$1" | grep -qE -- '-rc\.[0-9]+$'; }
# 建议下一版：当前 rc → 同核心正式版（测试通过就发正式）；当前正式 → patch+1
suggest_next() { node -e 'const v=process.argv[1];const m=v.match(/^(\d+)\.(\d+)\.(\d+)-rc\.(\d+)$/);if(m){console.log(m[1]+"."+m[2]+"."+m[3])}else{const a=v.split(".").map(Number);a[2]++;console.log(a.join("."))}' "$VERSION"; }
# 版本比较（新 > 旧）：核心号数值比较；核心相同 → 正式版 > rc，rc 按 rc.N 数值
newver_gt() { node -e '
const p=s=>{const m=s.match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/);return{c:[+m[1],+m[2],+m[3]],r:m[4]===undefined?null:+m[4]}};
const a=p(process.argv[1]),b=p(process.argv[2]);
for(let i=0;i<3;i++){if(b.c[i]!==a.c[i])process.exit(b.c[i]>a.c[i]?0:1)}
if(a.r===null&&b.r===null)process.exit(1);
if(a.r===null)process.exit(1);
if(b.r===null)process.exit(0);
process.exit(b.r>a.r?0:1)' "$1" "$2"; }

report_state() {
  say "当前状态:"
  say "  package.json version = ${VERSION}（建议下一版: $(suggest_next)）"
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
  if is_rc "$VERSION"; then
    say "  模式: 预发布（rc）——CHANGELOG 不消费，构建产物将标 prerelease，内测用"
  fi
}

plan() {
  say "流程（--apply 打标 bump → commit → --tag 打 tag → push）:"
  say "  A. --apply：交互输入新版本（x.y.z 正式版 / x.y.z-rc.N 预发布，须 > 当前 ${VERSION}）→"
  say "     bump package.json；正式版同时把 CHANGELOG [Unreleased] 收口成 [<新版本>]（rc 保留不消费）→ 停下"
  say "  B. 人工 review + git commit"
  say "  C. --tag：校验工作树 → 打 annotated tag v<版本>（指向 HEAD）→ 校验 == HEAD"
  say "  D. push（git push origin main v<版本>）→ 触发 .github/workflows/release.yml 构建 GitHub Release 产物（rc 标 prerelease）"
  say "  E. 人工验收 GitHub Release 产物（docs/release-checklist.md）"
  say "  F. 正式版验收通过后 vsce publish 该产物（由人执行，带路径不重打包）；rc 到此为止，内测通过后 bump 同核心正式版再走 A-F"
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
  say "（dry-run 结束，未写任何文件。--apply / --tag 才真正执行。）"
}

apply() {
  report_state
  say ""
  worktree_clean || die "工作树有未提交改动，先提交或清理再跑"
  local newver
  read -rp "输入新版本号（当前 ${VERSION}，建议下一版: $(suggest_next)）: " newver
  [ -n "$newver" ] || die "未输入版本号"
  echo "$newver" | grep -Eq "$VER_RE" || die "版本号必须形如 x.y.z 或 x.y.z-rc.N（${newver}）"
  newver_gt "$VERSION" "$newver" || die "新版本 ${newver} 不大于当前 ${VERSION}"
  tag_exists "$newver" && die "tag v$newver 已存在，确认是否已发布过"
  node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" "$newver"
  if is_rc "$newver"; then
    changelog_unreleased || die "预发布（rc）需要 CHANGELOG [Unreleased] 段：rc 不消费它，正式版才收口"
    say "已改: package.json version → ${newver}；CHANGELOG [Unreleased] 保留（rc 不消费，正式版才收口）"
    say ""
    say "下一步:"
    say "  1. git diff 检查 package.json"
    say "  2. git commit（如: git commit -m 'release: v${newver}（预发布）'）"
    say "  3. scripts/release-gate.sh --tag 打 tag，然后 git push origin main v${newver} 触发 Actions 构建 GitHub Release（标 prerelease）"
    say "  4. 内测通过后发正式版：bump 同核心 x.y.z，CHANGELOG 收口"
  else
    changelog_unreleased || die "正式版需要 CHANGELOG [Unreleased] 段（发 rc 时被保留的就是它，或在发版前补上）"
    node -e "const fs=require('fs');const p='CHANGELOG.md';const s=fs.readFileSync(p,'utf8');const m=/^## \[Unreleased\]$/m;if(!m.test(s)){console.error('CHANGELOG 无 [Unreleased] 段');process.exit(1)}fs.writeFileSync(p,s.replace(m,'## ['+process.argv[1]+']'))" "$newver"
    say "已改: package.json version → ${newver}；CHANGELOG [Unreleased] → [${newver}]"
    say ""
    say "下一步:"
    say "  1. git diff 检查这两个文件"
    say "  2. git commit（建议只提交这两个文件，如: git commit -m 'release: v$newver'）"
    say "  3. scripts/release-gate.sh --tag 打 tag，然后 git push origin main v$newver 触发 Actions 构建 GitHub Release"
  fi
}

tag() {
  report_state
  say ""
  if changelog_unreleased; then
    is_rc "$VERSION" || die "CHANGELOG 还有 [Unreleased] 而当前版本 ${VERSION} 不是 rc：正式版必须先 --apply 收口（rc 版本则正常，直接打 tag）"
  elif ! changelog_has "$VERSION"; then
    die "CHANGELOG 没有 [${VERSION}] 段也没有 [Unreleased]，状态异常"
  fi
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
  say "  2. 等 Actions 跑完，GitHub Release 出现 dsh-one-${VERSION}.vsix${is_rc "$VERSION" && echo '（标 prerelease，内测用）' || echo ''}"
  say "  3. 按 docs/release-checklist.md 验收 GitHub Release 产物（不本地打包）"
  if is_rc "$VERSION"; then
    say "  4. rc 到此为止：内测通过后 bump 同核心正式版（CHANGELOG 收口）再发"
  else
    say "  4. 验收通过后执行 npx vsce publish dsh-one-${VERSION}.vsix（带路径、用 Release 那份，不重打包）"
  fi
}

case "${1:-}" in
  -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//' | grep -v '^!' ; exit 0 ;;
  --apply) apply ;;
  --tag) tag ;;
  "") dry_run ;;
  *) die "未知参数: $1（用法: scripts/release-gate.sh [--apply|--tag]）" ;;
esac
