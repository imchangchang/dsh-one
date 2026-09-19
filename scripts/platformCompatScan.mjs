/**
 * 平台兼容性合入门禁（#6）的扫描与声明校验：纯函数 + CLI 入口，可单测。
 *
 * 为什么存在：Windows 上「只有那个平台才现形」的问题（recover-token-from-log 的
 * 无记录防护死循环、spawn 输出与控制台行为、冷启动时序）在 macOS 开发机上测不出来，
 * 合入时只能靠开发者自己说清「这条平台路径在哪验证过」。本模块负责两件事：
 *   1. 从本次合入的新增行里找出平台相关代码（规则数据在 platform-compat-rules.json）；
 *   2. 核对任务提交的声明（test/sandbox/verify.<slug>.platform.json）是否逐条覆盖
 *      了这些路径、以及按状态分叉的逻辑有没有给出分支矩阵。
 *
 * 判据（命中即要求声明，不降级、不给静默通过）：
 *   - platformRules 命中 => 「同 file + 同 rule」必须有一条 platformCoverage 条目，
 *     写清这条平台路径在哪验证过（ci-runner / real-machine / unit-test）；
 *   - matrixTriggers 命中 => branchMatrix.rows 必须给出分支矩阵（分支条件 / 预期行为 /
 *     验证方式），行缺字段、或验证方式写成占位词（未验证/TBD）即拒绝。
 *
 * 为什么矩阵只在特定形状下要求：每条合入都举手会变成橡皮图章，反而被绕过。这里的
 * 可执行判据是「按**状态变量**分叉」的三类形状（规则见 rules.matrixTriggers）：
 *   a) 命中平台路径——平台本身就是状态变量；
 *   b) 存在性/可读性探测（existsSync / statSync / accessSync…）与条件分叉同文件出现
 *      ——「有记录 vs 无记录」这类分支，rc.4 事故正是这一形状；
 *   c) switch + 2 个以上 case——同一状态变量的多路分派。
 * 普通的类型分派 / 早退式 if 不会命中，不打扰。
 *
 * 扫描范围：只看**新增代码行**（像 check-i18n.sh 一样以 merge-base 为基点），只扫
 * 代码后缀（见 rules.scan），跳过 test/ 与 docs/ ——测试与夹具是「验证证据」本身，
 * 文档里的命令举例不该被当成平台路径。注释先按整文件状态机剥离（与
 * scripts/check-i18n.sh 里的同一套算法，逐字符等长、逐行对齐），所以注释里提到
 * `taskkill` 不会命中。
 *
 * 边界（写清楚，免得当成万能）：只看新增行的静态文本，不懂语义——「命中但确非平台
 * 路径」的情形由声明里的 verifiedBy: not-a-platform-path + reason 交人工复核；矩阵
 * 「缺行」只能查「有矩阵且每行字段齐全」，行是否把状态覆盖全由人看（门禁把矩阵打印
 * 出来，人工审查时逐行对照）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

export const MODULE_DIR = import.meta.dirname
export const DEFAULT_RULES_PATH = path.join(MODULE_DIR, 'platform-compat-rules.json')
export const DECL_DIR = 'test/sandbox'
export const VERIFIED_BY = new Set(['ci-runner', 'real-machine', 'unit-test', 'not-a-platform-path'])
/** 矩阵行里的「验证方式」不许是这些占位词（写了等于没验证）。 */
const PLACEHOLDER_RE =
  /^(未验证|待验证|未定义|待定|待补|无|暂无|none|null|n\/?a|tbd|todo|t\.b\.d\.|-|—|\.\.\.)$/i

export function loadRules(rulesPath = DEFAULT_RULES_PATH) {
  return JSON.parse(fs.readFileSync(rulesPath, 'utf8'))
}

/** 声明文件名：test/sandbox/verify.<slug>.platform.json（slug 与任务分支同名）。 */
export function declPathFor(slug) {
  return `${DECL_DIR}/verify.${slug}.platform.json`
}

export function slugFromBranch(branch) {
  const raw = branch.startsWith('agent/') ? branch.slice('agent/'.length) : branch
  // 分支名里的 `/` 等字符不能进文件名（独立跑门禁时分支可能不叫 agent/*）。
  return raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

// ---------- 扫描范围 ----------
export function makeScope(scan) {
  const exts = new Set(scan.extensions.map((e) => e.toLowerCase()))
  const excludeRe = new RegExp(scan.excludePathRegex)
  return (file) => {
    if (!exts.has(path.extname(file).toLowerCase())) return false
    if (excludeRe.test(file)) return false
    return true
  }
}

// ---------- 解析 unified diff 的新增行 ----------
// added: Map<file, [{no, text}]>，no 是分支树里的行号（1-based）。
export function parseAddedLines(diff) {
  const added = new Map()
  let cur = null
  let newNo = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      cur = line.slice(6).trim()
      if (!added.has(cur)) added.set(cur, [])
      continue
    }
    if (!cur) continue
    if (line.startsWith('--- ')) continue
    const mh = /^@@ -[^ ]+ \+(\d+)(?:,\d+)? @@/.exec(line)
    if (mh) {
      newNo = Number(mh[1])
      continue
    }
    if (line.startsWith('+')) {
      added.get(cur).push({ no: newNo, text: line.slice(1) })
      newNo++
      continue
    }
    // 上下文行（diff 没带 -U0 时才有）也要推进新行号，否则行号会漂；
    // dev-merge 传的是 --unified=0，这里只是让解析器对任何 diff 都成立。
    if (line.startsWith(' ')) newNo++
  }
  return added
}

// ---------- 注释剥离（与 scripts/check-i18n.sh 内的同一套状态机） ----------
// 生成与原文逐字符等长、逐行对齐的文本：注释字符变空格、换行保留，字符串/模板串
// 内容原样保留。逐行正则处理不了跨行 /* ... */，所以必须整文件状态机。
// 正则字面量与除法同以 / 开头：按前一个有效字符是否操作符判断；关键字
// （return /typeof/case…）后紧跟 / 也是正则。细节与理由见 check-i18n.sh 的注释。
const REGEX_PREV = new Set(['(', '[', '{', '=', ':', ',', ';', '!', '?', '&', '|', '+', '-', '*', '%', '^', '~', '<', '>'])
const REGEX_KEYWORD_RE =
  /(?:^|[^A-Za-z0-9_$])(?:return|typeof|case|throw|in|of|instanceof|delete|void|yield|new|do|else|await)\s+$/

export function stripFileComments(text) {
  let out = ''
  let state = 'code'
  let tplDepth = 0
  let prevSig = ''
  let inCharClass = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const nx = text[i + 1] ?? ''
    if (state === 'code') {
      if (ch === '/' && nx === '/') {
        out += '  '
        state = 'line'
        i += 2
        continue
      }
      if (ch === '/' && nx === '*') {
        out += '  '
        state = 'block'
        i += 2
        continue
      }
      if (ch === '/' && (REGEX_PREV.has(prevSig) || REGEX_KEYWORD_RE.test(text.slice(0, i)))) {
        out += '/'
        state = 'regex'
        inCharClass = false
        i++
        continue
      }
      if (ch === "'") {
        out += ch
        prevSig = ch
        state = 's1'
        i++
        continue
      }
      if (ch === '"') {
        out += ch
        prevSig = ch
        state = 's2'
        i++
        continue
      }
      if (ch === '`') {
        out += ch
        state = 'tpl'
        i++
        continue
      }
      if (ch === '}' && tplDepth > 0) {
        tplDepth--
        out += ch
        state = 'tpl'
        i++
        continue
      }
      if (!/\s/.test(ch)) prevSig = ch
      out += ch
      i++
      continue
    }
    if (state === 'line') {
      out += ch === '\n' ? '\n' : ' '
      if (ch === '\n') state = 'code'
      i++
      continue
    }
    if (state === 'block') {
      if (ch === '*' && nx === '/') {
        out += '  '
        state = 'code'
        i += 2
      } else {
        out += ch === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (state === 'regex') {
      out += ch
      if (ch === '\\') {
        out += nx ?? ''
        i += 2
        continue
      }
      if (ch === '[') inCharClass = true
      else if (ch === ']') inCharClass = false
      else if (ch === '/' && !inCharClass) {
        state = 'code'
        prevSig = '/'
        i++
        continue
      }
      i++
      continue
    }
    if (state === 'tpl') {
      if (ch === '$' && nx === '{') {
        out += '${'
        tplDepth++
        state = 'code'
        i += 2
        continue
      }
      if (ch === '`') {
        out += ch
        state = 'code'
        i++
        continue
      }
      if (ch === '\\') {
        out += nx ?? ''
        i += 2
        continue
      }
      if (ch === '/' && nx === '*') {
        out += '  '
        state = 'tplBlock'
        i += 2
        continue
      }
      if (ch === '<' && nx === '!' && text[i + 2] === '-' && text[i + 3] === '-') {
        out += '    '
        state = 'tplHtml'
        i += 4
        continue
      }
      out += ch
      i++
      continue
    }
    if (state === 'tplBlock') {
      if (ch === '*' && nx === '/') {
        out += '  '
        state = 'tpl'
        i += 2
      } else {
        out += ch === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (state === 'tplHtml') {
      if (ch === '-' && nx === '-' && text[i + 2] === '>') {
        out += '   '
        state = 'tpl'
        i += 3
      } else {
        out += ch === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    out += ch
    if (ch === '\\') {
      out += nx ?? ''
      i += 2
      continue
    }
    if ((state === 's1' && ch === "'") || (state === 's2' && ch === '"')) state = 'code'
    i++
  }
  return out
}

/**
 * shell 脚本的注释剥离：未落在引号里的 `#` 起（含 `#!`、`#requires`）到行尾算注释。
 * 与 JS 那套状态机不同，这里按行处理即可（shell 的 `#` 注释不跨行）；截断行尾不影响
 * 行号对齐——按 `\n` 切分后行数不变。`.ps1` 的 `<# ... #>` 块注释不剥（少见，且真被
 * 误命中时声明里用 not-a-platform-path 说明即可）。
 */
export function stripHashComments(text) {
  return text
    .split('\n')
    .map((line) => {
      let quote = null
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quote) {
          if (ch === '\\' && quote === '"') i++
          else if (ch === quote) quote = null
          continue
        }
        if (ch === "'" || ch === '"') quote = ch
        else if (ch === '#') return line.slice(0, i)
      }
      return line
    })
    .join('\n')
}

/** 按语言选注释剥离方式：shell / PowerShell / bat 用 `#`，其余（JS/TS）用状态机。 */
export function stripCommentsInFile(file, text) {
  return /\.(sh|bash|zsh|ps1|psm1|bat|cmd)$/i.test(file) ? stripHashComments(text) : stripFileComments(text)
}

/**
 * 每个待扫文件的新增行补上「注释已剥离」的 code 文本。
 * readBlob(ref, file) 取分支树里的整文件内容（取不到返回 ''），此时退回原文。
 */
export function stripAddedLines(added, shouldScan, readBlob) {
  const scanned = new Map()
  for (const [file, lines] of added) {
    if (!shouldScan(file)) continue
    let strippedLines = null
    try {
      const source = readBlob(file)
      if (source) strippedLines = stripCommentsInFile(file, source).split('\n')
    } catch {
      strippedLines = null
    }
    scanned.set(
      file,
      lines.map(({ no, text }) => ({ no, text, code: strippedLines?.[no - 1] ?? text })),
    )
  }
  return scanned
}

// ---------- 平台路径命中 ----------
export function compilePlatformRules(rules) {
  return rules.platformRules.map((r) => ({ ...r, re: new RegExp(r.pattern) }))
}

export function scanPlatformHits(scanned, rules) {
  const compiled = compilePlatformRules(rules)
  const hits = []
  for (const [file, lines] of scanned) {
    for (const line of lines) {
      const code = line.code
      for (const r of compiled) {
        if (!r.re.test(code)) continue
        hits.push({
          file,
          rule: r.id,
          rulePath: r.path,
          no: line.no,
          text: line.text.trim(),
          tags: [...new Set(code.match(/\b(win32|darwin|linux|freebsd|posix)\b/gi) ?? [])],
        })
      }
    }
  }
  return hits
}

export function hitKeys(hits) {
  return [...new Set(hits.map((h) => `${h.file}\u0000${h.rule}`))].sort()
}

/** 声明里声明为「确非平台路径」的 file+rule —— 这些命中不触发矩阵。 */
export function exemptKeys(decl) {
  const set = new Set()
  for (const entry of Array.isArray(decl?.platformCoverage) ? decl.platformCoverage : []) {
    if (entry && entry.verifiedBy === 'not-a-platform-path' && entry.file && entry.rule) {
      set.add(`${entry.file}\u0000${entry.rule}`)
    }
  }
  return set
}

// ---------- 状态分支矩阵：什么时候必须给 ----------
export function detectMatrixTriggers(scanned, hits, exempt, rules) {
  const mt = rules.matrixTriggers
  const reasons = []
  const liveHits = hits.filter((h) => !exempt.has(`${h.file}\u0000${h.rule}`))
  if (liveHits.length) {
    const ruleset = [...new Set(liveHits.map((h) => h.rule))].join('、')
    reasons.push({ id: 'platform', file: null, reason: `${mt.platform}（命中 ${ruleset}）` })
  }
  const probeRe = new RegExp(mt.stateProbe.probe)
  const branchRe = new RegExp(mt.stateProbe.branch)
  const switchRe = new RegExp(mt.switchState.switch)
  const caseRe = new RegExp(mt.switchState.case)
  const assignRe = new RegExp(mt.probeResultBranch.assign)
  const stateyRe = new RegExp(mt.probeResultBranch.statey, 'i')
  for (const [file, lines] of scanned) {
    const probes = lines.filter((l) => probeRe.test(l.code))
    if (probes.length && lines.some((l) => branchRe.test(l.code))) {
      const sample = probes[0].text.trim().slice(0, 80)
      reasons.push({
        id: 'state-probe',
        file,
        reason: `${mt.stateProbe.what}（${file}：${probes.length} 处探测，如 ${sample}）`,
      })
    }
    // 「探测有没有结果」分叉：赋值自一次调用 + 紧随其后（同一文件、行号相距不超过
    // windowLines）按 undefined/null/真假分叉。只认被调函数名或变量名带状态词
    // （record/owned/state/log/port/pid/file/token…）的那些——纯内存查找
    // （uiWorkspace()、querySelector()）同形状但不属「持久/外部状态」，要求矩阵会变成
    // 橡皮图章。这条宁可漏也不误伤：漏掉的部分由人工审查 ledger 兜底。
    for (let i = 0; i < lines.length; i++) {
      const m = assignRe.exec(lines[i].code)
      if (!m) continue
      const [, name, callee] = m
      if (!stateyRe.test(callee) && !stateyRe.test(name)) continue
      const varBranchRe = new RegExp(mt.probeResultBranch.branch.replaceAll('%VAR%', name))
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].no - lines[i].no > mt.probeResultBranch.windowLines) break
        if (!varBranchRe.test(lines[j].code)) continue
        reasons.push({
          id: 'probe-result-branch',
          file,
          reason: `${mt.probeResultBranch.what}（${file}:${lines[i].no} ${lines[i].text.trim().slice(0, 60)} → :${lines[j].no} ${lines[j].text.trim().slice(0, 60)}）`,
        })
        break
      }
    }
    const cases = new Set(lines.filter((l) => caseRe.test(l.code)).map((l) => l.text.trim().replace(/\s+/g, ' ')))
    if (lines.some((l) => switchRe.test(l.code)) && cases.size >= mt.switchState.minCases) {
      reasons.push({
        id: 'switch-state',
        file,
        reason: `${mt.switchState.what}（${file}：${cases.size} 个 case）`,
      })
    }
  }
  return reasons
}

// ---------- 声明校验 ----------
export function validateDeclaration(decl, ctx) {
  const { branch, hits, matrixReasons, rules } = ctx
  const problems = []
  const warnings = []
  if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) {
    return { problems: ['声明不是 JSON 对象。'], warnings, exempt: new Set() }
  }
  if (typeof decl.branch !== 'string' || decl.branch !== branch) {
    problems.push(`声明里的 "branch" 必须是本次待合分支 "${branch}"（当前是 ${JSON.stringify(decl.branch ?? null)}）——防止把别的任务的声明抄过来。`)
  }
  const entries = Array.isArray(decl.platformCoverage) ? decl.platformCoverage : []
  const byKey = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      problems.push(`platformCoverage 里有非对象条目：${JSON.stringify(entry)}`)
      continue
    }
    byKey.set(`${entry.file}\u0000${entry.rule}`, entry)
  }
  const needKeys = hitKeys(hits)
  for (const key of needKeys) {
    const [file, rule] = key.split('\u0000')
    const entry = byKey.get(key)
    if (!entry) {
      problems.push(`platformCoverage 缺条目：file=${file} rule=${rule}`)
      continue
    }
    const where = `platformCoverage 里 file=${file} rule=${rule} 的条目`
    if (typeof entry.path !== 'string' || !entry.path.trim()) problems.push(`${where} 缺 "path"（这条平台路径是什么、走的是哪几个平台）。`)
    if (!VERIFIED_BY.has(entry.verifiedBy)) {
      problems.push(`${where} 的 "verifiedBy" 必须是 ${[...VERIFIED_BY].join(' / ')} 之一（当前是 ${JSON.stringify(entry.verifiedBy ?? null)}）。`)
    }
    if (typeof entry.evidence !== 'string' || !entry.evidence.trim()) {
      problems.push(`${where} 缺 "evidence"（写清证据：CI job 名 + runner / 真机与步骤 / 测试文件与用例名）。`)
    }
    if (entry.verifiedBy === 'not-a-platform-path') {
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
        problems.push(`${where} 用了 not-a-platform-path，必须给非空 "reason"（为什么这不是平台路径）。`)
      } else {
        warnings.push(`豁免（确非平台路径，人工复核）：${file} / ${rule}——${entry.reason}`)
      }
    }
  }
  for (const key of byKey.keys()) {
    if (!needKeys.includes(key)) {
      const [file, rule] = key.split('\u0000')
      warnings.push(`声明里的条目在本次新增行里没有对应命中（可能已过时）：file=${file} rule=${rule}`)
    }
  }
  if (matrixReasons.length) {
    const matrix = decl.branchMatrix
    const rows = Array.isArray(matrix?.rows) ? matrix.rows : null
    if (!rows || rows.length === 0) {
      problems.push('缺 "branchMatrix.rows"：本次改动按状态变量分叉，需要给出分支矩阵（每行：condition / expected / verification）。')
    } else {
      rows.forEach((row, i) => {
        const at = `branchMatrix.rows[${i}]`
        if (!row || typeof row !== 'object') {
          problems.push(`${at} 不是对象。`)
          return
        }
        for (const field of ['condition', 'expected', 'verification']) {
          if (typeof row[field] !== 'string' || !row[field].trim()) {
            problems.push(`${at} 缺 "${field}"。`)
          }
        }
        if (typeof row.verification === 'string' && PLACEHOLDER_RE.test(row.verification.trim())) {
          problems.push(`${at} 的 "verification" 是占位词（${JSON.stringify(row.verification)}）——矩阵里出现「未验证/未定义」的行就是风险项，必须写清怎么验证的。`)
        }
      })
      if (typeof matrix?.trigger !== 'string' || !matrix.trigger.trim()) {
        warnings.push('"branchMatrix.trigger" 没写触发原因（不拦合入，但建议写清是哪一类状态分叉）。')
      }
    }
  }
  return { problems, warnings, exempt: exemptKeys(decl) }
}

// ---------- 输出：模板与报告 ----------
/** 规则 id → 人话描述（模板与报告都用它，命中对象上带不带 rulePath 都能取到）。 */
export function rulePathOf(rules, id) {
  return rules.platformRules.find((r) => r.id === id)?.path ?? id
}

export function renderTemplate({ branch, slug, missingKeys, matrixReasons, hits, rules }) {
  const hitByKey = new Map()
  for (const h of hits) {
    const key = `${h.file}\u0000${h.rule}`
    if (!hitByKey.has(key)) hitByKey.set(key, { file: h.file, rule: h.rule, rulePath: rulePathOf(rules, h.rule), first: h })
  }
  const coverage = missingKeys.map((key) => {
    const info = hitByKey.get(key)
    return {
      file: info.file,
      rule: info.rule,
      path: `<这条平台路径是什么（${info.rulePath}）>`,
      verifiedBy: 'unit-test | real-machine | ci-runner | not-a-platform-path',
      evidence: '<在哪验证过：测试文件与用例名 / 哪台真机与步骤 / CI job 名>',
    }
  })
  const decl = {
    branch,
    slug,
    platformCoverage: coverage,
    branchMatrix: matrixReasons.length
      ? {
          trigger: matrixReasons.map((r) => r.id).join(' + '),
          rows: matrixReasons.map((r) => ({
            condition: `<分支条件>（触发原因：${r.reason}）`,
            expected: '<这条分支的预期行为>',
            verification: '<这条分支怎么验证的；没验证过就补验证，别写「未验证」>',
          })),
        }
      : { trigger: '', rows: [] },
  }
  return JSON.stringify(decl, null, 2)
}

export function renderMatrixTable(rows) {
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  return [
    '    | 分支条件 | 预期行为 | 验证方式 |',
    '    | --- | --- | --- |',
    ...rows.map((r) => `    | ${cell(r.condition)} | ${cell(r.expected)} | ${cell(r.verification)} |`),
  ]
}

/**
 * 门禁主流程（纯函数，输出与退出码都在返回值里）。
 * opts: { branch, baseRef, diffText, declText|null, rules, readBlob(file) }
 */
export function run(opts) {
  const { branch, baseRef, diffText, declText, rules, readBlob } = opts
  const shouldScan = makeScope(rules.scan)
  const added = parseAddedLines(diffText)
  const scanned = stripAddedLines(added, shouldScan, readBlob)
  const hits = scanPlatformHits(scanned, rules)

  let decl = null
  let declError = null
  if (declText !== null && declText !== undefined) {
    try {
      decl = JSON.parse(declText)
    } catch (e) {
      declError = e.message
    }
  }
  const out = []
  const okLine = (msg) => out.push(msg)

  if (declError) {
    out.push(`[platform] 拒绝合入：声明文件 ${declPathFor(slugFromBranch(branch))} 不是合法 JSON——${declError}`)
    out.push('  修好 JSON 后重跑，或删掉该文件重新生成：门禁会打印可复制的完整模板。')
    return { ok: false, output: out.join('\n'), hits, triggers: [] }
  }

  const exempt = declError ? new Set() : exemptKeys(decl)
  const triggers = detectMatrixTriggers(scanned, hits, exempt, rules)
  const needKeys = hitKeys(hits)

  if (decl === null) {
    if (needKeys.length === 0 && triggers.length === 0) {
      okLine(`[platform] OK：分支 ${branch} 相对 ${baseRef} 的新增行没有平台分支代码、也没有状态分支（无需声明文件）。`)
      return { ok: true, output: out.join('\n'), hits, triggers }
    }
    out.push(`[platform] 拒绝合入：分支 ${branch} 相对 ${baseRef} 的新增行命中平台/状态分支代码，但缺声明文件 ${declPathFor(slugFromBranch(branch))}。`)
    if (hits.length) out.push(...renderHits(hits, []))
    out.push(...renderTriggers(triggers))
    out.push('  补齐方式：把下面这段存成 ' + declPathFor(slugFromBranch(branch)) + '（把每处 <...> 换成实际内容），提交后再合入。')
    out.push(
      renderTemplate({ branch, slug: slugFromBranch(branch), missingKeys: needKeys, matrixReasons: triggers, hits, rules })
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    )
    return { ok: false, output: out.join('\n'), hits, triggers }
  }

  const verdict = validateDeclaration(decl, { branch, hits, matrixReasons: triggers, rules })
  if (verdict.problems.length) {
    out.push(`[platform] 拒绝合入：分支 ${branch} 相对 ${baseRef} 的声明 ${declPathFor(slugFromBranch(branch))} 未覆盖本次改动：`)
    for (const p of verdict.problems) out.push(`  - ${p}`)
    if (hits.length) out.push(...renderHits(hits, needKeys))
    out.push(...renderTriggers(triggers))
    const missingKeys = needKeys.filter((key) => {
      const [file, rule] = key.split('\u0000')
      return !(decl.platformCoverage ?? []).some((e) => e?.file === file && e?.rule === rule)
    })
    out.push('  补齐方式：按下面的模板补进 ' + declPathFor(slugFromBranch(branch)) + '——模板里 platformCoverage 是缺的条目，branchMatrix 是缺的矩阵行。')
    out.push(
      renderTemplate({ branch, slug: slugFromBranch(branch), missingKeys, matrixReasons: triggers, hits, rules })
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    )
    return { ok: false, output: out.join('\n'), hits, triggers }
  }

  for (const w of verdict.warnings) out.push(`  ⚠ ${w}`)
  const rows = Array.isArray(decl.branchMatrix?.rows) ? decl.branchMatrix.rows : []
  const covered = needKeys.length
    ? needKeys.map((key) => {
        const [file, rule] = key.split('\u0000')
        const e = (decl.platformCoverage ?? []).find((x) => x?.file === file && x?.rule === rule)
        return `    - ${file}（${rule}）→ ${e.verifiedBy}：${e.evidence}`
      }).join('\n')
    : '    （无平台路径命中）'
  okLine(`[platform] OK：分支 ${branch} 相对 ${baseRef} 的平台路径逐条有声明。`)
  okLine(`  平台路径声明（${needKeys.length} 条）：`)
  okLine(covered)
  if (triggers.length) {
    okLine(`  状态分支矩阵（${rows.length} 行，触发原因：${triggers.map((t) => t.id).join(' + ')}）：`)
    okLine(renderMatrixTable(rows).join('\n'))
  } else {
    okLine('  状态分支矩阵：未触发（本次新增行没有按状态变量分叉的形状）。')
  }
  return { ok: true, output: out.join('\n'), hits, triggers }
}

function renderHits(hits, needKeys) {
  if (!hits.length) return ['  命中：无']
  const lines = [`  命中（${hits.length} 处，${needKeys.length || hitKeys(hits).length} 条 file+rule 路径）：`]
  for (const h of hits) {
    const tags = h.tags.length ? ` [提到 ${h.tags.join('/')}]` : ''
    lines.push(`    - ${h.file}:${h.no}  rule=${h.rule}（${h.rulePath}）${tags}`)
    lines.push(`        ${h.text}`)
  }
  return lines
}

function renderTriggers(triggers) {
  if (!triggers.length) return []
  const lines = ['  状态分支矩阵要求（命中以下形状即须给 branchMatrix.rows）：']
  for (const t of triggers) lines.push(`    - [${t.id}] ${t.reason}`)
  return lines
}

// ---------- CLI ----------
function main() {
  const branch = process.env.COMPAT_BRANCH
  const baseRef = process.env.COMPAT_BASE_REF || 'main'
  const diffFile = process.env.COMPAT_DIFF
  const declFile = process.env.COMPAT_DECL
  const repo = process.env.COMPAT_REPO || process.cwd()
  const rules = loadRules(process.env.COMPAT_RULES || DEFAULT_RULES_PATH)
  if (!branch || !diffFile) {
    console.error('内部用法：COMPAT_BRANCH / COMPAT_DIFF 环境变量必填（由 scripts/check-platform-compat.sh 传入）。')
    process.exit(2)
  }
  const ref = `refs/heads/${branch}`
  const readBlob = (file) => {
    try {
      return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', cwd: repo, maxBuffer: 64 * 1024 * 1024 })
    } catch {
      return ''
    }
  }
  const declText = fs.existsSync(declFile) ? fs.readFileSync(declFile, 'utf8') : null
  const result = run({
    branch,
    baseRef,
    diffText: fs.readFileSync(diffFile, 'utf8'),
    declText,
    rules,
    readBlob,
  })
  console.log(result.output)
  process.exit(result.ok ? 0 : 1)
}

/** 是不是被当脚本直接跑。这里比的是 realpath：macOS 上 /tmp 是指向 /private/tmp 的
 * 符号链接，按路径字符串比较会让主流程静默不跑——门禁于是「什么都不说地通过」。 */
function isMainModule() {
  try {
    return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(import.meta.filename)
  } catch {
    return false
  }
}

if (isMainModule()) main()
