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
const BASE = process.env.CHECK_I18N_BASE
const REF = `refs/heads/${BRANCH}`
const DIFF = fs.readFileSync(process.env.CHECK_I18N_DIFF, 'utf8')

// ---------- 读取某一 ref（分支 / merge-base 提交）里的文件 blob ----------
function showAt(ref, path) {
  try {
    return cp.execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' })
  } catch (e) {
    return '' // 该 ref 里没有这个文件（如被删除）
  }
}
// 分支树里的文件 blob（参考文件一律读分支版本，看开发者在分支里改过的内容）
function show(path) { return showAt(REF, path) }
function jsonObj(text) {
  try { return JSON.parse(text) } catch (e) { return null }
}
function jsonKeys(text) {
  const o = jsonObj(text)
  return o ? new Set(Object.keys(o)) : new Set()
}

// ---------- 解析 unified diff，按文件分组出「新增行」（含行号） ----------
// added[file] = [{ no: 新增行号(1-based), text: 行内容 }]
// 判定 / 是否开启正则：前一个有效字符是这些（或行首）可视为正则开始。
// 必须在 stripFileComments 首次被调用（下方「填充 stripped」循环）前初始化。
const REGEX_PREV = new Set(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|', '+', '-', '*', '%', '^', '~', '<', '>'])
function parseDiff(diff) {
  const added = {}   // file -> [{ no, text }]
  let cur = null
  let newNo = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {          // 文件头：+++ b/<path>
      cur = line.slice(6).trim()
      if (!(cur in added)) added[cur] = []
      continue
    }
    if (!cur) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    const mh = /^@@ -[^ ]+ \+(\d+)(?:,\d+)? @@/.exec(line)
    if (mh) { newNo = Number(mh[1]); continue }
    if (line.startsWith('+')) { added[cur].push({ no: newNo, text: line.slice(1) }); newNo++ }
  }
  return added
}
const added = parseDiff(DIFF)

// 为 src/** 的每个新增行填充「剥离注释后」的文本（检查 1/2/5 用）：
// 按文件整体剥离一次，行号对齐原文（注释字符替换为空格、换行保留）。
for (const [file, lines] of Object.entries(added)) {
  if (!file.startsWith('src/')) continue
  const strippedLines = stripFileComments(show(file)).split('\n')
  for (const entry of lines) {
    entry.stripped = strippedLines[entry.no - 1] ?? entry.text
  }
}

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

// 按文件跑注释状态机，生成与原文逐字符等长、逐行对齐的「剥离注释」文本：
// 注释字符替换为空格（保留换行），字符串/模板串原样保留——字符串里的中文是
// 硬编码，检查 5 仍应命中；只有注释里的中文要放过。逐行正则处理不了跨行
// /* ... */（中间行没有 /* 标记），所以必须整文件状态机。模板串内识别
// ${...} 插值：插值区回到 code（插值里是真实代码，注释/字符串照常解析），
// 遇 } 回模板文本。用 tplDepth 计数处理嵌套模板串。状态：code / 行注释 /
// 块注释 / 单引串 / 双引串 / 模板串 / 正则字面量。
//
// 正则字面量与除法同以 / 开头：按「前一个有效非空白字符」判断——是操作符
// （( [ { = : , ; ! ? & | + - * % ^ ~ < > 或行首）则视为正则开始，否则为
// 除法。正则内部用 regex 状态防解析（处理 \ 转义与 [ ] 字符类），避免
// 例：.replace(/"/g, ...) 中 /"/ 里的 " 被误当字符串起点。启发式并非
// 完全精确（如 a / b 后跟 ) 的极端情况），但对注释剥离的用途足够。
function stripFileComments(text) {
  let out = ''
  let state = 'code'
  let tplDepth = 0 // code 内未闭合的 ${ 插值层数
  let prevSig = '' // 上一个有效非空白字符（code 区）
  let inCharClass = false // 正则字符类 [ ]
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const nx = text[i + 1] ?? ''
    if (state === 'code') {
      if (ch === '/' && nx === '/') { out += '  '; state = 'line'; i += 2; continue }
      if (ch === '/' && nx === '*') { out += '  '; state = 'block'; i += 2; continue }
      if (ch === '/' && REGEX_PREV.has(prevSig)) { out += '/'; state = 'regex'; inCharClass = false; i++; continue }
      if (ch === "'") { out += ch; prevSig = ch; state = 's1'; i++; continue }
      if (ch === '"') { out += ch; prevSig = ch; state = 's2'; i++; continue }
      if (ch === '`') { out += ch; state = 'tpl'; i++; continue }
      if (ch === '}' && tplDepth > 0) { tplDepth--; out += ch; state = 'tpl'; i++; continue }
      if (!/\s/.test(ch)) prevSig = ch
      out += ch; i++; continue
    }
    if (state === 'line') {
      out += ch === '\n' ? '\n' : ' '
      if (ch === '\n') state = 'code'
      i++; continue
    }
    if (state === 'block') {
      if (ch === '*' && nx === '/') { out += '  '; state = 'code'; i += 2 }
      else { out += ch === '\n' ? '\n' : ' '; i++ }
      continue
    }
    if (state === 'regex') {
      out += ch
      if (ch === '\\') { out += nx ?? ''; i += 2; continue }
      if (ch === '[') inCharClass = true
      else if (ch === ']') inCharClass = false
      else if (ch === '/' && !inCharClass) { state = 'code'; prevSig = '/'; i++; continue }
      i++; continue
    }
    if (state === 'tpl') {
      // 插值入口 ${：进入 code，层数 +1
      if (ch === '$' && nx === '{') { out += '${'; tplDepth++; state = 'code'; i += 2; continue }
      if (ch === '`') { out += ch; state = 'code'; i++; continue }
      if (ch === '\\') { out += nx ?? ''; i += 2; continue }
      // 模板串多为 CSS/HTML 文本：/* ... */（CSS 块注释）、<!-- ... -->（HTML 注释）
      // 也剥掉，模板文本里的真实文案（中文）不受影响。
      if (ch === '/' && nx === '*') { out += '  '; state = 'tplBlock'; i += 2; continue }
      if (ch === '<' && nx === '!' && text[i + 2] === '-' && text[i + 3] === '-') { out += '    '; state = 'tplHtml'; i += 4; continue }
      out += ch; i++; continue
    }
    if (state === 'tplBlock') {
      if (ch === '*' && nx === '/') { out += '  '; state = 'tpl'; i += 2 }
      else { out += ch === '\n' ? '\n' : ' '; i++ }
      continue
    }
    if (state === 'tplHtml') {
      if (ch === '-' && nx === '-' && text[i + 2] === '>') { out += '   '; state = 'tpl'; i += 3 }
      else { out += ch === '\n' ? '\n' : ' '; i++ }
      continue
    }
    // 字符串：保留内容（含换行），只处理转义与结束符
    out += ch
    if (ch === '\\') { out += nx ?? ''; i += 2; continue }
    if ((state === 's1' && ch === "'") || (state === 's2' && ch === '"')) state = 'code'
    i++
  }
  return out
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
  for (const { no, text, stripped } of lines) {
    for (const key of hostKeys(stripped ?? text)) {
      if (!enBundle.has(key)) {
        push(`[host] ${file}: vscode.l10n.t("${key}") 的 key 不在 l10n/bundle.l10n.json`)
      }
    }
  }
}

// ========== 2. webview 层：裸 t() 的 key 必须在中文译文表 ==========
for (const [file, lines] of Object.entries(added)) {
  if (!isWebviewFile(file)) continue
  for (const { no, text, stripped } of lines) {
    for (const key of webviewKeys(stripped ?? text)) {
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

// 4a. nls 命令标题在分支里被改/删 => README 里旧标题是否残留。
//     按「新旧值语义对比」，不受 JSON 格式化/整文件重写产生的 diff 噪声影响。
const baseEnNls = jsonObj(showAt(BASE, 'package.nls.json')) || {}
const baseZhNls = jsonObj(showAt(BASE, 'package.nls.zh-cn.json')) || {}
for (const [file, baseObj, newObj] of [
  ['package.nls.json', baseEnNls, enNls],
  ['package.nls.zh-cn.json', baseZhNls, zhNls],
]) {
  const keys = new Set([...Object.keys(baseObj), ...Object.keys(newObj)])
  for (const k of keys) {
    if (!k.endsWith('.title')) continue
    const oldV = baseObj[k]
    const newV = newObj[k]
    if (oldV === newV) continue // 值没变（或都不存在），忽略
    if (oldV && (enReadme.includes(oldV) || zhReadme.includes(oldV))) {
      push(`[docs] ${file} 命令标题 "${k}" 由 "${oldV}" 改为/删除 "${newV ?? '(无)'}"，但 README 里仍在引用旧标题 "${oldV}"（需同步更新）`)
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
  for (const { no, text, stripped } of lines) {
    const probe = stripped ?? text
    if (hasCJK(probe)) {
      push(`[src-chinese] ${file}: 疑似硬编码中文字符串字面量（漏翻）: ${text.trim()}`)
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
