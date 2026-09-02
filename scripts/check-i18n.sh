#!/usr/bin/env bash
# i18n 合入门禁：检查「待合入分支相对 main 的新增行」是否需要同步 i18n。
#
# 用法: scripts/check-i18n.sh <branch>
#   <branch> 缺省为当前分支。dev-merge.sh 在校验阶段调用，传当前待合入分支
#   （agent/<slug>）；也可单独跑，exit 0 = 通过，非 0 = 拒绝合入（且有明确原因）。
#
# 只查「相对 merge-base 新增的行」(git diff base..branch 的 + 内容)，不扫整分支历史，
# 避免对既有历史误报。参考文件（bundle / nls / README）一律从分支树读（git show），
# 保证看到的是开发者在分支里改过的版本，而不是主线工作区。
#
# 检查口径（与 docs/backlog/doing/i18n-merge-gate.md 定稿一致）：
#   1. 宿主层   src/**:     新增 `vscode.l10n.t('KEY')`   => KEY 必须在 l10n/bundle.l10n.json（英文基线）
#   2. webview 层(定义本地 t() 的 src/ui/*.ts):
#                          新增裸 `t('KEY')`             => KEY 必须在 l10n/bundle.l10n.zh-cn.json
#   3. manifest 层 package.json: 新增 `%KEY%`             => KEY 必须在 package.nls.json 与 package.nls.zh-cn.json
#   4. 文档层  对外 README.md / README.zh-CN.md（不含 docs/）:
#                          命令标题语言一致性（英文 README 不出现中文命令标题，反之亦然）；
#                          若 nls 命令标题在 diff 中被改/删，检查 README 里旧标题是否残留。
#   5. 兜底     src/**:     新增行出现中文字符串字面量（排除注释、测试夹具）=> 疑似漏翻
#
# 依赖: bash + node（仓库本身是 node 项目，node 必然存在；不新增任何依赖）。
#       用 git diff / git show 常规命令；key 抽取、JSON 成员判定、Unicode 判中文
#       交给 node，避免 macOS(BSD grep 无 -P) 与 CI 之间的可移植性问题。
# 硬编码中文命中即 fail（不做降级）。
set -euo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  BRANCH=$(git branch --show-current 2>/dev/null || true)
  [ -n "$BRANCH" ] || { echo "未指定分支且当前处于 detached HEAD。" >&2; exit 2; }
fi
git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null || {
  echo "分支 $BRANCH 不存在。" >&2; exit 2; }

# 合并基点：分支 fork 出 main 的那个点。diff 只看这一基点到分支之间的改动。
BASE=$(git merge-base main "$BRANCH")

# 相对 merge-base 的 diff（只看新增行，+ 内容）。
DIFF_FILE=$(mktemp)
NODE_FILE=$(mktemp)
trap 'rm -f "$DIFF_FILE" "$NODE_FILE"' EXIT
git diff -M --unified=0 "$BASE" "$BRANCH" > "$DIFF_FILE"

# 把 node 分析程序落到临时 .cjs（避免 heredoc 嵌 $() 在部分 bash 上解析不了）。
cat > "$NODE_FILE" <<'NODE'
'use strict'
const fs = require('fs')
const cp = require('child_process')

const BRANCH = process.env.CHECK_I18N_BRANCH
const REF = `refs/heads/${BRANCH}`
const DIFF = fs.readFileSync(process.env.CHECK_I18N_DIFF, 'utf8')

// ---------- 读取分支树里的文件 blob ----------
function show(path) {
  try {
    return cp.execFileSync('git', ['show', `${REF}:${path}`], { encoding: 'utf8' })
  } catch (e) {
    return '' // 分支里没有该文件（如被删除）
  }
}
function jsonObj(text) {
  try { return JSON.parse(text) } catch (e) { return null }
}
function jsonKeys(text) {
  const o = jsonObj(text)
  return o ? new Set(Object.keys(o)) : new Set()
}

// ---------- 解析 unified diff，按文件分组出「新增行」和「删除行」 ----------
function parseDiff(diff) {
  const added = {}   // file -> [新增行内容]
  const removed = {} // file -> [删除行内容]
  let cur = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {          // 文件头：+++ b/<path>
      cur = line.slice(6).trim()
      if (!(cur in added)) { added[cur] = []; removed[cur] = [] }
      continue
    }
    if (!cur) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) added[cur].push(line.slice(1))
    else if (line.startsWith('-')) removed[cur].push(line.slice(1))
  }
  return { added, removed }
}
const { added, removed } = parseDiff(DIFF)

// ---------- 判断是否为 webview 文件（定义本地 t() 的浏览器侧代码） ----------
function isWebviewFile(path) {
  if (!path.startsWith('src/')) return false
  return /\bfunction\s+t\s*\(/.test(show(path))
}

// ---------- 从一行里抽 i18n key ----------
function hostKeys(line) { // vscode.l10n.t('KEY') / vscode.l10n.t("KEY")
  return [...line.matchAll(/vscode\.l10n\.t\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
}
// 裸 t('KEY')——要求紧邻 t 的左侧不能是字母/数字/下划线/点，从而排除
// vscode.l10n.t、createElement('button') 这类误命中。
function webviewKeys(line) {
  return [...line.matchAll(/(^|[^A-Za-z0-9_.])t\(\s*['"]([^'"]+)['"]/g)].map((m) => m[2])
}
function pctKeys(line) { // %KEY%
  return [...line.matchAll(/%([^%]+)%/g)].map((m) => m[1])
}

// ---------- 是否属测试 / 夹具（兜底检查 5 的排除项） ----------
const FIXTURE_RE = /\/(__tests__|tests?|fixtures?|mocks?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i
function isFixturePath(path) { return FIXTURE_RE.test(path) }

// 剥离 JS/TS 注释后再判中文：去掉 /* ... */ 块注释与本行 // 注释。
function stripComments(line) {
  return line.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '')
}
function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s) }

// ---------- 参考文件（都从分支树读） ----------
const enBundle = jsonKeys(show('l10n/bundle.l10n.json'))          // 英文基线
const zhBundle = jsonKeys(show('l10n/bundle.l10n.zh-cn.json'))    // 中文宿主/webview
const enNls = jsonObj(show('package.nls.json')) || {}
const zhNls = jsonObj(show('package.nls.zh-cn.json')) || {}
const pkg = jsonObj(show('package.json'))

const problems = [] // 命中即视为检查失败
const push = (msg) => problems.push(msg)

// ========== 1. 宿主层：vscode.l10n.t 的 key 必须在英文基线 ==========
for (const [file, lines] of Object.entries(added)) {
  if (!file.startsWith('src/')) continue
  for (const line of lines) {
    for (const key of hostKeys(line)) {
      if (!enBundle.has(key)) {
        push(`[host] ${file}: vscode.l10n.t("${key}") 的 key 不在 l10n/bundle.l10n.json`)
      }
    }
  }
}

// ========== 2. webview 层：裸 t() 的 key 必须在中文译文表 ==========
for (const [file, lines] of Object.entries(added)) {
  if (!isWebviewFile(file)) continue
  for (const line of lines) {
    for (const key of webviewKeys(line)) {
      if (!zhBundle.has(key)) {
        push(`[webview] ${file}: t("${key}") 的 key 不在 l10n/bundle.l10n.zh-cn.json`)
      }
    }
  }
}

// ========== 3. manifest 层：package.json 新增 %KEY% 必须两个 nls 都有 ==========
for (const line of (added['package.json'] || [])) {
  for (const key of pctKeys(line)) {
    const missing = []
    if (!(key in enNls)) missing.push('package.nls.json')
    if (!(key in zhNls)) missing.push('package.nls.zh-cn.json')
    if (missing.length) {
      push(`[manifest] package.json: "%${key}%" 不在 ${missing.join('、')}`)
    }
  }
}

// ========== 4. 文档层：只对 README.md / README.zh-CN.md（不含 docs/） ==========
const enReadme = show('README.md')
const zhReadme = show('README.zh-CN.md')

// 4a. nls 命令标题在 diff 中被删除 => README 里旧标题是否残留
for (const file of ['package.nls.json', 'package.nls.zh-cn.json']) {
  for (const line of (removed[file] || [])) {
    const m = /"([^"]+)\.title"\s*:\s*"([^"]*)"/.exec(line)
    if (!m) continue
    const oldValue = m[2]
    if (oldValue && (enReadme.includes(oldValue) || zhReadme.includes(oldValue))) {
      push(`[docs] ${file} 删除了命令标题 "${oldValue}"，但 README 里仍在引用（需同步更新）`)
    }
  }
}

// 4b. 全量对照：命令标题语言一致性（取自 package.json contributes.commands 引用的 %key%）
const titleKeys = new Set()
for (const c of (pkg && pkg.contributes && pkg.contributes.commands) || []) {
  const m = /^%(.+)%$/.exec(c.title || '')
  if (m) titleKeys.add(m[1])
}
for (const k of titleKeys) {
  const ev = enNls[k]
  const zv = zhNls[k]
  if (ev === undefined || zv === undefined) {
    push(`[docs] 命令标题 key "${k}" 未在 package.nls.json / package.nls.zh-cn.json 中定义`)
    continue
  }
  if (zv && enReadme.includes(zv)) {
    push(`[docs] 英文 README.md 出现中文命令标题 "${zv}"（应对照 "${ev}"）`)
  }
  if (ev && zhReadme.includes(ev)) {
    push(`[docs] 中文 README.zh-CN.md 出现英文命令标题 "${ev}"（应对照 "${zv}"）`)
  }
}

// ========== 5. 兜底：src/** 新增行里的硬编码中文（疑似漏翻） ==========
for (const [file, lines] of Object.entries(added)) {
  if (!file.startsWith('src/') || isFixturePath(file)) continue
  for (const line of lines) {
    if (hasCJK(stripComments(line))) {
      push(`[src-chinese] ${file}: 疑似硬编码中文字符串字面量（漏翻）: ${line.trim()}`)
    }
  }
}

// ---------- 输出 ----------
if (problems.length) {
  console.log(`[i18n] 拒绝合入：分支 ${BRANCH} 相对 main 的新增行存在 i18n 漏同步：`)
  for (const p of problems) console.log(`  ${p}`)
  console.log(`[i18n] 共 ${problems.length} 处，请补齐对应 i18n 文件后再合并。`)
  process.exit(1)
} else {
  console.log(`[i18n] OK：分支 ${BRANCH} 相对 main 的新增行无 i18n 漏同步。`)
  process.exit(0)
}
NODE

set +e
OUTPUT=$(
  CHECK_I18N_BRANCH="$BRANCH" \
  CHECK_I18N_BASE="$BASE" \
  CHECK_I18N_DIFF="$DIFF_FILE" \
  node "$NODE_FILE"
)
STATUS=$?
set -e

printf '%s\n' "$OUTPUT"
if [ "$STATUS" -ne 0 ]; then
  echo "i18n 合入门禁未通过，拒绝合入。" >&2
  exit 1
fi
exit 0
