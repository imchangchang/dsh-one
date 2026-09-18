/**
 * 平台兼容性合入门禁（#6，`scripts/check-platform-compat.sh` +
 * `scripts/platformCompatScan.mjs` + `scripts/platform-compat-rules.json`）的单测与
 * **端到端负向对照**。
 *
 * 分三段：
 * 1. 规则自检：规则数据里每条 platformRule 的 examples 必须命中、counterExamples
 *    必须不命中——「改了 pattern 忘了改说明」在测试里先红；
 * 2. 纯函数单测：注释剥离（含字符串里的 `//`、跨行块注释）、扫描范围、矩阵触发判据、
 *    声明校验与模板；
 * 3. 端到端：在临时 git 仓库里造分支（命中平台代码但没声明 / 补上声明 / 完全不命中 /
 *    命中状态分叉但缺矩阵 / 补上矩阵），跑真实门禁脚本对 exit code 与输出下断言——
 *    即验收要求的那四组负向对照，固化在这里，以后改门禁跑 `npm test` 就能看见。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = path.join(import.meta.dirname, '..')
const MODULE_PATH = path.join(ROOT, 'scripts', 'platformCompatScan.mjs')
const RULES_PATH = path.join(ROOT, 'scripts', 'platform-compat-rules.json')
const GATE_SCRIPT = path.join(ROOT, 'scripts', 'check-platform-compat.sh')

interface PlatformRule {
  id: string
  path: string
  pattern: string
  examples?: string[]
  counterExamples?: string[]
}
interface Rules {
  scan: { extensions: string[]; excludePathRegex: string }
  platformRules: PlatformRule[]
  matrixTriggers: {
    platform: string
    stateProbe: { probe: string; branch: string }
    probeResultBranch: { assign: string; statey: string; branch: string; windowLines: number }
    switchState: { switch: string; case: string; minCases: number }
  }
  verifiedBy: Record<string, string>
}
interface Hit {
  file: string
  rule: string
  no: number
  text: string
  rulePath?: string
}
interface Trigger {
  id: string
  file: string | null
  reason: string
}
interface GateModule {
  loadRules(p?: string): Rules
  makeScope(scan: Rules['scan']): (file: string) => boolean
  parseAddedLines(diff: string): Map<string, { no: number; text: string }[]>
  stripFileComments(text: string): string
  stripHashComments(text: string): string
  stripCommentsInFile(file: string, text: string): string
  stripAddedLines(
    added: Map<string, { no: number; text: string }[]>,
    shouldScan: (file: string) => boolean,
    readBlob: (file: string) => string,
  ): Map<string, { no: number; text: string; code: string }[]>
  scanPlatformHits(scanned: Map<string, { no: number; text: string; code: string }[]>, rules: Rules): Hit[]
  hitKeys(hits: Hit[]): string[]
  detectMatrixTriggers(
    scanned: Map<string, { no: number; text: string; code: string }[]>,
    hits: Hit[],
    exempt: Set<string>,
    rules: Rules,
  ): Trigger[]
  validateDeclaration(
    decl: unknown,
    ctx: { branch: string; hits: Hit[]; matrixReasons: Trigger[]; rules: Rules },
  ): { problems: string[]; warnings: string[]; exempt: Set<string> }
  renderTemplate(o: {
    branch: string
    slug: string
    missingKeys: string[]
    matrixReasons: Trigger[]
    hits: Hit[]
    rules: Rules
  }): string
  declPathFor(slug: string): string
  run(o: {
    branch: string
    baseRef: string
    diffText: string
    declText: string | null
    rules: Rules
    readBlob: (file: string) => string
  }): { ok: boolean; output: string; hits: Hit[]; triggers: Trigger[] }
}

const gate = (await import(MODULE_PATH)) as GateModule
const rules = gate.loadRules(RULES_PATH)

// ========== 1. 规则自检 ==========
test('规则数据：每条 platformRule 的 examples 命中、counterExamples 不命中', () => {
  assert.ok(rules.platformRules.length >= 6, '规则表不该被删空')
  for (const r of rules.platformRules) {
    const re = new RegExp(r.pattern)
    assert.ok((r.examples ?? []).length > 0, `${r.id} 缺 examples（规则没有说明书）`)
    assert.ok((r.counterExamples ?? []).length > 0, `${r.id} 缺 counterExamples（易误伤的写法没人钉）`)
    for (const ex of r.examples ?? []) assert.ok(re.test(ex), `${r.id} 的示例应当命中：${ex}`)
    for (const ex of r.counterExamples ?? []) assert.ok(!re.test(ex), `${r.id} 的对照写法不该命中：${ex}`)
  }
})

test('规则数据：verifiedBy 词表含三种验证方式与误报豁免', () => {
  for (const key of ['ci-runner', 'real-machine', 'unit-test', 'not-a-platform-path']) {
    assert.ok(key in rules.verifiedBy, `verifiedBy 词表缺 ${key}`)
  }
})

test('规则数据：扫描范围排除测试与文档、保留代码后缀', () => {
  const shouldScan = gate.makeScope(rules.scan)
  assert.ok(shouldScan('src/server/spawnDsh.ts'))
  assert.ok(shouldScan('packages/dsh-plugin-kit/src/index.ts'))
  assert.ok(shouldScan('scripts/verify-lab-version.mjs'))
  assert.ok(!shouldScan('test/platformCompatGate.test.ts'))
  assert.ok(!shouldScan('src/server/__tests__/x.ts'))
  assert.ok(!shouldScan('docs/development.md'))
  assert.ok(!shouldScan('test/sandbox/verify.demo.platform.json'))
  assert.ok(!shouldScan('src/pure/types.d.ts'))
})

// ========== 2. 纯函数单测 ==========
test('注释剥离：行注释、块注释、字符串里的 // 都不影响真实代码的识别', () => {
  const src = [
    '// 这里提到 taskkill / process.platform，不该被当成平台路径',
    '/* 跨行块注释',
    '   netstat -ano',
    '*/',
    "const url = 'http://127.0.0.1:3080/'",
    "if (process.platform === 'win32') { run() }",
  ].join('\n')
  const stripped = gate.stripFileComments(src).split('\n')
  assert.ok(!stripped[0].includes('taskkill'), '行注释应被剥离')
  assert.ok(!stripped[2].includes('netstat'), '块注释中间行应被剥离')
  assert.ok(stripped[4].includes('http://127.0.0.1:3080/'), '字符串里的 // 不该被当注释（否则同一行后面的代码会被吞掉）')
  assert.ok(stripped[5].includes('process.platform'), '字符串后的真实代码必须保留')
})

test('注释剥离：shell 脚本的 # 注释也剥（引号里的 # 不算注释）', () => {
  const src = [
    '#!/usr/bin/env bash',
    "# 收尾：Windows 上要 taskkill /T /F，mac 上单发 SIGTERM",
    'echo "keep # inside string"',
    "kill -TERM \"$pid\"",
  ].join('\n')
  const stripped = gate.stripCommentsInFile('scripts/x.sh', src).split('\n')
  assert.ok(!stripped[1].includes('taskkill'), '# 注释应被剥掉')
  assert.ok(stripped[2].includes('keep'), '引号内的 # 不是注释起点')
  assert.ok(stripped[3].includes('kill -TERM'), '真实代码必须保留')
  const hits = gate.scanPlatformHits(
    new Map([['scripts/x.sh', [{ no: 4, text: 'kill -TERM "$pid"', code: stripped[3] }]]]),
    rules,
  )
  assert.ok(hits.some((h) => h.rule === 'signal'), 'shell 里的 kill -TERM 是真实命中')
})

test('扫描：diff 新增行的解析与注释剥离后的命中', () => {
  const diff = [
    'diff --git a/src/server/a.ts b/src/server/a.ts',
    '--- a/src/server/a.ts',
    '+++ b/src/server/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const keep = 1',
    "+// 注释里的 taskkill 不算",
    "+if (process.platform === 'win32') { spawn('cmd.exe', [], { windowsHide: true }) }",
  ].join('\n')
  const source = [
    'const keep = 1',
    '// 注释里的 taskkill 不算',
    "if (process.platform === 'win32') { spawn('cmd.exe', [], { windowsHide: true }) }",
  ].join('\n')
  const added = gate.parseAddedLines(diff)
  assert.deepEqual(
    added.get('src/server/a.ts')?.map((l) => l.no),
    [2, 3],
  )
  const scanned = gate.stripAddedLines(added, gate.makeScope(rules.scan), (f) => (f === 'src/server/a.ts' ? source : ''))
  const hits = gate.scanPlatformHits(scanned, rules)
  const ids = hits.map((h) => h.rule)
  assert.ok(ids.includes('platform-branch'), 'process.platform 必须命中')
  assert.ok(ids.includes('platform-command'), 'cmd.exe 必须命中')
  assert.ok(ids.includes('child-stdio'), 'windowsHide 必须命中')
  assert.ok(!ids.includes('signal'), '注释里的 taskkill 不该命中山寨信号规则')
  assert.equal(hits.every((h) => h.no === 3), true, '只有第 3 行是代码，命中都该落在它上面')
})

test('矩阵判据：存在性探测 + 条件分叉 → state-probe；纯内存查找不打扰', () => {
  const mk = (lines: string[]) =>
    gate.stripAddedLines(
      gate.parseAddedLines(
        ['+++ b/src/server/a.ts', '@@ -1,0 +1,20 @@', ...lines.map((l) => `+${l}`)].join('\n'),
      ),
      gate.makeScope(rules.scan),
      () => lines.join('\n'),
    )
  const statey = mk([
    "import * as fs from 'node:fs'",
    'function pick(dir: string) {',
    "  if (fs.existsSync(path.join(dir, 'dsh.cmd'))) {",
    '    return true',
    '  } else {',
    '    return false',
    '  }',
    '}',
  ])
  assert.ok(
    gate.detectMatrixTriggers(statey, [], new Set(), rules).some((t) => t.id === 'state-probe'),
    '存在性探测 + if/else 应触发 state-probe',
  )
  const inMemory = mk(['const ui = uiWorkspace()', 'if (ui !== undefined) { render(ui) }'])
  assert.deepEqual(gate.detectMatrixTriggers(inMemory, [], new Set(), rules), [], '纯内存查找不该要求矩阵')
})

test('矩阵判据：探测结果分叉（rc.4 形状）触发，平台命中触发', () => {
  const lines = [
    'const recovered = await this.tokenFromLog()',
    'if (recovered !== undefined) {',
    '  await this.writeOwned(recovered)',
    '}',
  ]
  const scanned = gate.stripAddedLines(
    gate.parseAddedLines(
      ['+++ b/src/server/manager.ts', '@@ -1,0 +1,4 @@', ...lines.map((l) => `+${l}`)].join('\n'),
    ),
    gate.makeScope(rules.scan),
    () => lines.join('\n'),
  )
  const triggers = gate.detectMatrixTriggers(scanned, [], new Set(), rules)
  assert.ok(
    triggers.some((t) => t.id === 'probe-result-branch'),
    '「探测有没有结果」分叉必须触发矩阵（rc.4 事故的形状）',
  )

  const platLines = ["if (process.platform === 'win32') { spawnSync('taskkill', ['/T', '/F']) }"]
  const platScanned = gate.stripAddedLines(
    gate.parseAddedLines(
      ['+++ b/src/server/a.ts', '@@ -1,0 +1,1 @@', ...platLines.map((l) => `+${l}`)].join('\n'),
    ),
    gate.makeScope(rules.scan),
    () => platLines.join('\n'),
  )
  const hits = gate.scanPlatformHits(platScanned, rules)
  assert.ok(
    gate.detectMatrixTriggers(platScanned, hits, new Set(), rules).some((t) => t.id === 'platform'),
    '平台命中必须触发矩阵',
  )
  const exemptAll = new Set<string>(gate.hitKeys(hits))
  const exempt = gate.detectMatrixTriggers(platScanned, hits, exemptAll, rules)
  assert.deepEqual(exempt, [], '全部命中都声明为「确非平台路径」后不再要求平台矩阵')
})

test('声明校验：缺条目/词表外 verifiedBy/缺 evidence/缺矩阵行/占位词都拒绝', () => {
  const hits: Hit[] = [{ file: 'src/server/a.ts', rule: 'platform-branch', no: 3, text: 'x' }]
  const triggers: Trigger[] = [{ id: 'platform', file: null, reason: 'r' }]
  const ctx = { branch: 'agent/demo', hits, matrixReasons: triggers, rules }
  const base = { branch: 'agent/demo' }

  const missing = gate.validateDeclaration(base, ctx)
  assert.ok(missing.problems.some((p) => p.includes('platformCoverage 缺条目')))

  const wrongBranch = gate.validateDeclaration({ branch: 'agent/other' }, ctx)
  assert.ok(wrongBranch.problems.some((p) => p.includes('必须是本次待合分支')))

  const badVocab = gate.validateDeclaration(
    {
      ...base,
      platformCoverage: [{ file: 'src/server/a.ts', rule: 'platform-branch', path: 'p', verifiedBy: '想当然', evidence: 'e' }],
      branchMatrix: { rows: [{ condition: 'c', expected: 'e', verification: 'v' }] },
    },
    ctx,
  )
  assert.ok(badVocab.problems.some((p) => p.includes('verifiedBy')))

  const noMatrix = gate.validateDeclaration(
    {
      ...base,
      platformCoverage: [
        { file: 'src/server/a.ts', rule: 'platform-branch', path: 'p', verifiedBy: 'unit-test', evidence: 'e' },
      ],
    },
    ctx,
  )
  assert.ok(noMatrix.problems.some((p) => p.includes('branchMatrix.rows')))

  const placeholder = gate.validateDeclaration(
    {
      ...base,
      platformCoverage: [
        { file: 'src/server/a.ts', rule: 'platform-branch', path: 'p', verifiedBy: 'unit-test', evidence: 'e' },
      ],
      branchMatrix: { rows: [{ condition: 'c', expected: 'e', verification: '未验证' }] },
    },
    ctx,
  )
  assert.ok(placeholder.problems.some((p) => p.includes('占位词')))

  const exemptNoReason = gate.validateDeclaration(
    {
      ...base,
      platformCoverage: [
        { file: 'src/server/a.ts', rule: 'platform-branch', path: 'p', verifiedBy: 'not-a-platform-path', evidence: 'e' },
      ],
      branchMatrix: { rows: [{ condition: 'c', expected: 'e', verification: 'v' }] },
    },
    ctx,
  )
  assert.ok(exemptNoReason.problems.some((p) => p.includes('reason')))

  const ok = gate.validateDeclaration(
    {
      ...base,
      platformCoverage: [
        {
          file: 'src/server/a.ts',
          rule: 'platform-branch',
          path: 'win32 上走 .cmd shim',
          verifiedBy: 'unit-test',
          evidence: 'test/a.test.ts「win32 shim」',
        },
      ],
      branchMatrix: { trigger: 'platform', rows: [{ condition: 'win32', expected: '走 shim', verification: '单测' }] },
    },
    ctx,
  )
  assert.deepEqual(ok.problems, [])
})

test('模板：命中项的 file/rule 预填好，矩阵行数与触发数一致', () => {
  const hits: Hit[] = [
    { file: 'src/server/a.ts', rule: 'platform-branch', no: 1, text: 'x' },
    { file: 'src/server/a.ts', rule: 'signal', no: 2, text: 'y' },
  ]
  const template = gate.renderTemplate({
    branch: 'agent/demo',
    slug: 'demo',
    missingKeys: gate.hitKeys(hits),
    matrixReasons: [{ id: 'platform', file: null, reason: 'r' }],
    hits,
    rules,
  })
  const parsed = JSON.parse(template) as { platformCoverage: { file: string; rule: string; path: string }[]; branchMatrix: { rows: unknown[] } }
  assert.equal(parsed.platformCoverage.length, 2)
  assert.equal(parsed.platformCoverage[0].file, 'src/server/a.ts')
  assert.equal(parsed.platformCoverage[0].path.includes('按 process.platform 分叉'), true)
  assert.equal(parsed.branchMatrix.rows.length, 1)
})

// ========== 3. 端到端负向对照（临时 git 仓库 + 真门禁脚本） ==========
type GateRepo = {
  dir: string
  git: (...args: string[]) => string
  run: (branch: string) => { status: number; out: string }
  write: (rel: string, content: string) => Promise<void>
  cleanup: () => Promise<void>
}

async function makeGateRepo(): Promise<GateRepo> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dshone-platgate-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
  }
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env })
  git('init', '-q', '-b', 'main')
  await fsp.mkdir(path.join(dir, 'scripts'), { recursive: true })
  // 门禁脚本 + 扫描模块 + 规则数据：临时仓库里放同一份，才跑的是真脚本
  for (const name of ['check-platform-compat.sh', 'platformCompatScan.mjs', 'platform-compat-rules.json']) {
    await fsp.copyFile(path.join(ROOT, 'scripts', name), path.join(dir, 'scripts', name))
  }
  await fsp.mkdir(path.join(dir, 'src'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'src', 'app.ts'), 'export const keep = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  return {
    dir,
    git,
    run: (branch) => {
      const r = spawnSync('bash', ['scripts/check-platform-compat.sh', branch], { cwd: dir, encoding: 'utf8' })
      return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    },
    write: async (rel, content) => {
      const abs = path.join(dir, rel)
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, content)
    },
    cleanup: () => fsp.rm(dir, { recursive: true, force: true }),
  }
}

/** 在临时仓库里开一条 agent/<slug> 分支并提交若干文件（from 缺省 main）。 */
async function commitBranch(
  repo: GateRepo,
  slug: string,
  files: Record<string, string>,
  from = 'main',
): Promise<void> {
  repo.git('checkout', '-q', '-b', `agent/${slug}`, from)
  for (const [rel, content] of Object.entries(files)) await repo.write(rel, content)
  repo.git('add', '.')
  repo.git('commit', '-q', '-m', `feat: ${slug}`)
}

const PLATFORM_CODE = [
  "import { spawnSync } from 'node:child_process'",
  '',
  'export function stopChild(pid: number): void {',
  "  if (process.platform === 'win32') {",
  "    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'])",
  '    return',
  '  }',
  "  process.kill(pid, 'SIGTERM')",
  '}',
].join('\n')

test('端到端：命中平台代码但没有声明 → 拒绝合入，并说清补什么', async () => {
  const repo = await makeGateRepo()
  try {
    await commitBranch(repo, 'plat-missing', { 'src/app.ts': `${PLATFORM_CODE}\n` })
    const r = repo.run('agent/plat-missing')
    assert.equal(r.status, 1, `应当拒绝合入：\n${r.out}`)
    assert.match(r.out, /test\/sandbox\/verify\.plat-missing\.platform\.json/, '要点名声明文件路径')
    assert.match(r.out, /rule=platform-branch/, '要点出命中的规则')
    assert.match(r.out, /platformCoverage/, '要给可复制的模板')
    assert.match(r.out, /"file": "src\/app\.ts"/, '模板里要预填命中文件的条目')
    assert.match(r.out, /not-a-platform-path/, '模板要列出 verifiedBy 词表')
  } finally {
    await repo.cleanup()
  }
})

test('端到端：补上声明 → 放行（平台声明逐条打印）', async () => {
  const repo = await makeGateRepo()
  try {
    await commitBranch(repo, 'plat-declared', { 'src/app.ts': `${PLATFORM_CODE}\n` })
    await repo.write(
      'test/sandbox/verify.plat-declared.platform.json',
      JSON.stringify(
        {
          branch: 'agent/plat-declared',
          platformCoverage: [
            {
              file: 'src/app.ts',
              rule: 'platform-branch',
              path: 'win32 走 taskkill，POSIX 走 SIGTERM',
              verifiedBy: 'unit-test',
              evidence: 'test/app.test.ts「stopChild」按平台注入桩覆盖两分支',
            },
            {
              file: 'src/app.ts',
              rule: 'platform-command',
              path: 'taskkill 收 Windows 进程树',
              verifiedBy: 'real-machine',
              evidence: 'Windows 11 真机：起 dsh 后停止，任务管理器无残留',
            },
            {
              file: 'src/app.ts',
              rule: 'signal',
              path: 'POSIX 单发 SIGTERM（Windows 无信号语义，走 taskkill）',
              verifiedBy: 'unit-test',
              evidence: 'test/app.test.ts「stopChild」断言两分支各自调用的命令',
            },
          ],
          branchMatrix: {
            trigger: 'platform',
            rows: [
              { condition: 'process.platform === win32', expected: 'taskkill /T /F 收整棵进程树', verification: 'Windows 真机实测' },
              { condition: '其它平台', expected: '单发 SIGTERM 优雅退出', verification: '单测 + macOS 真机' },
            ],
          },
        },
        null,
        2,
      ),
    )
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'test: 平台覆盖声明')
    const r = repo.run('agent/plat-declared')
    assert.equal(r.status, 0, `应当放行：\n${r.out}`)
    assert.match(r.out, /\[platform\] OK/)
    assert.match(r.out, /平台路径声明（3 条）/)
    assert.match(r.out, /状态分支矩阵（2 行/)
  } finally {
    await repo.cleanup()
  }
})

test('端到端：不命中平台代码的改动不受影响（不误报）', async () => {
  const repo = await makeGateRepo()
  try {
    await commitBranch(repo, 'plain-tweak', {
      'src/app.ts': "export const keep = 1\nexport const label = 'hello'\n",
      'src/ui.ts': 'export function render(name: string): string {\n  return `hi ${name}`\n}\n',
    })
    const r = repo.run('agent/plain-tweak')
    assert.equal(r.status, 0, `不该拦：\n${r.out}`)
    assert.match(r.out, /没有平台分支代码、也没有状态分支/)
  } finally {
    await repo.cleanup()
  }
})

test('端到端：命中状态分叉但缺矩阵 → 拒绝；补上矩阵 → 放行', async () => {
  const repo = await makeGateRepo()
  try {
    const stateCode = [
      "import * as fs from 'node:fs'",
      '',
      'export function loadRecord(file: string): string | null {',
      '  const record = readRecord(file)',
      '  if (record !== null) return record',
      '  return null',
      '}',
      '',
      'export function readRecord(file: string): string | null {',
      '  if (!fs.existsSync(file)) return null',
      '  return fs.readFileSync(file, "utf8")',
      '}',
    ].join('\n')
    await commitBranch(repo, 'state-matrix', { 'src/record.ts': `${stateCode}\n` })
    const blocked = repo.run('agent/state-matrix')
    assert.equal(blocked.status, 1, `缺矩阵应当拒绝：\n${blocked.out}`)
    assert.match(blocked.out, /branchMatrix\.rows/)
    assert.match(blocked.out, /probe-result-branch|state-probe/, '要点明是哪一类状态分叉触发')

    await repo.write(
      'test/sandbox/verify.state-matrix.platform.json',
      JSON.stringify(
        {
          branch: 'agent/state-matrix',
          platformCoverage: [],
          branchMatrix: {
            trigger: 'state-probe + probe-result-branch',
            rows: [
              { condition: '记录文件存在且有内容', expected: '返回记录里的 token', verification: '单测 loadRecord「有记录」' },
              { condition: '记录文件缺失', expected: '返回 null，走恢复路径', verification: '单测 loadRecord「无记录」' },
            ],
          },
        },
        null,
        2,
      ),
    )
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'test: 分支矩阵')
    const passed = repo.run('agent/state-matrix')
    assert.equal(passed.status, 0, `补上矩阵应当放行：\n${passed.out}`)
    assert.match(passed.out, /状态分支矩阵（2 行/)
  } finally {
    await repo.cleanup()
  }
})

test('端到端：声明不是合法 JSON → 拒绝并指出去修', async () => {
  const repo = await makeGateRepo()
  try {
    await commitBranch(repo, 'bad-json', { 'src/app.ts': `${PLATFORM_CODE}\n` })
    await repo.write('test/sandbox/verify.bad-json.platform.json', '{ this is not json }')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'test: 坏 JSON')
    const r = repo.run('agent/bad-json')
    assert.equal(r.status, 1)
    assert.match(r.out, /不是合法 JSON/)
  } finally {
    await repo.cleanup()
  }
})

test('门禁脚本经符号链接路径调用也照常出声（macOS 上 /tmp 是 /private/tmp 的链接）', async () => {
  const repo = await makeGateRepo()
  const linkParent = await fsp.mkdtemp(path.join(os.tmpdir(), 'dshone-platgate-link-'))
  const link = path.join(linkParent, 'repo-link')
  try {
    await fsp.symlink(repo.dir, link)
    await commitBranch(repo, 'linked', { 'src/app.ts': `${PLATFORM_CODE}\n` })
    const r = spawnSync('bash', ['scripts/check-platform-compat.sh', 'agent/linked'], { cwd: link, encoding: 'utf8' })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.equal(r.status, 1, `应当照常拒绝（不能静默通过）：\n${out}`)
    assert.match(out, /拒绝合入/)
  } finally {
    await repo.cleanup()
    await fsp.rm(linkParent, { recursive: true, force: true })
  }
})

test('端到端：基点跟着 COMPAT_BASE 走（合入 develop 线时不扫与 main 的差异）', async () => {
  const repo = await makeGateRepo()
  try {
    // 从 main 的 fork 点拉出 develop 线，在它上面落一段平台代码（不在 main 上）
    repo.git('checkout', '-q', '-b', 'develop/line', 'main')
    await repo.write('src/legacy.ts', `${PLATFORM_CODE}\n`)
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'feat: legacy platform code on develop line')
    // main 继续往前走（与任务分支无关的提交）
    repo.git('checkout', '-q', 'main')
    await repo.write('src/main-only.ts', 'export const onlyOnMain = 1\n')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'feat: unrelated main commit')
    // 任务分支从 develop 线拉出：它带着 develop 线相对 main 的全部历史改动
    await commitBranch(repo, 'line-tweak', { 'src/ui.ts': 'export const x = 1\n' }, 'develop/line')
    const viaMain = repo.run('agent/line-tweak')
    assert.equal(viaMain.status, 1, '基点默认 main 时会把 develop 线的历史改动当新增（这正是要避免的误报）')
    assert.match(viaMain.out, /src\/legacy\.ts/, '被误当新增的正是 develop 线上的那份')
    const r = spawnSync('bash', ['scripts/check-platform-compat.sh', 'agent/line-tweak'], {
      cwd: repo.dir,
      encoding: 'utf8',
      env: { ...process.env, COMPAT_BASE: 'develop/line' },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    assert.equal(r.status, 0, `基点换成 develop/line 后不该拦：\n${out}`)
    assert.match(out, /相对 develop\/line 的新增行没有平台分支代码/)
  } finally {
    await repo.cleanup()
  }
})

test('门禁脚本可单跑：不存在分支时报用法错（exit 2）', () => {
  const r = spawnSync('bash', [GATE_SCRIPT, 'agent/不存在的分支'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(`${r.stdout ?? ''}${r.stderr ?? ''}`, /不存在/)
})

test('规则数据文件存在且是合法 JSON（脚本按 import.meta.dirname 找它）', () => {
  const parsed = JSON.parse(fs.readFileSync(path.join(path.dirname(MODULE_PATH), 'platform-compat-rules.json'), 'utf8')) as Rules
  assert.ok(Array.isArray(parsed.platformRules))
  assert.ok(path.isAbsolute(RULES_PATH))
})
