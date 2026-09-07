#!/usr/bin/env node
/**
 * 上游 dsh release 监控编排（GitHub Action 每日 04:00 UTC+8 跑，也可手动/本地跑）。
 *
 * 流程：
 *   1. 拉 deepseek-ai/deepseek-harness 最新 release（GitHub API，含 prerelease）
 *   2. 查 npm @deepseek-ai/dsh 是否已发布该版本
 *   3. 去重：本仓库已有标题含该 tag 的 issue 则跳过（--force 强制重建）
 *   4. npm 已发布 → 装到临时目录，跑 probe.mjs 兼容性探针
 *   5. 更新 README 徽章数据（.github/dsh-compat/*.json），--commit 时提交回主线
 *   6. 建 issue：release notes 摘要 + 探针结果表 + 人工测试清单入口
 *
 * 用法：
 *   GH_TOKEN=$(gh auth token) node scripts/dsh-upstream-watch/watch.mjs \
 *     [--tag dsh-v0.1.3-alpha.1] [--repo owner/name] [--force] [--no-probe] [--commit] [--dry-run]
 *
 * --dry-run：只做检测和探针，不建 issue、不改徽章、不提交（本地验证用）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const UPSTREAM = 'deepseek-ai/deepseek-harness'
const NPM_PKG = '@deepseek-ai/dsh'
const BADGE_DIR = path.join(REPO_ROOT, '.github', 'dsh-compat')
const ISSUE_LABEL = 'upstream-watch'

function parseArgs(argv) {
  const opts = { tag: null, repo: process.env.GITHUB_REPOSITORY ?? null, force: false, probe: true, commit: false, dryRun: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--tag') opts.tag = argv[++i]
    else if (a === '--repo') opts.repo = argv[++i]
    else if (a === '--force') opts.force = true
    else if (a === '--no-probe') opts.probe = false
    else if (a === '--commit') opts.commit = true
    else if (a === '--dry-run') opts.dryRun = true
    else throw new Error(`unknown arg: ${a}`)
  }
  if (!opts.repo) throw new Error('--repo or GITHUB_REPOSITORY is required')
  return opts
}

async function ghApi(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: { 'user-agent': 'dsh-one-upstream-watch', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
  })
  if (!res.ok) throw new Error(`GitHub API ${pathname}: HTTP ${res.status}`)
  return res.json()
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr?.slice(0, 400)}`)
  return r.stdout.trim()
}

/** 最新 release（dsh 的版本都是 prerelease，不能过滤）。--tag 时取指定 tag。 */
async function latestRelease(tag) {
  if (tag) {
    const rel = await ghApi(`/repos/${UPSTREAM}/releases/tags/${tag}`)
    return rel
  }
  const rels = await ghApi(`/repos/${UPSTREAM}/releases?per_page=5`)
  const rel = rels.find((r) => !r.draft)
  if (!rel) throw new Error('no non-draft release found')
  return rel
}

async function npmMeta() {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(NPM_PKG)}`)
  if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`)
  return res.json()
}

/** 标题含 tag 的 issue 已存在（含 closed）则跳过。 */
function findExistingIssue(repo, tag) {
  const out = sh('gh', ['issue', 'list', '--repo', repo, '--search', `in:title ${tag}`, '--state', 'all', '--json', 'number,title,state'])
  const rows = JSON.parse(out || '[]')
  return rows.find((r) => r.title.includes(tag)) ?? null
}

function runProbe(version) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-watch-'))
  console.log(`[watch] installing ${NPM_PKG}@${version} into ${tmp}`)
  execFileSync('npm', ['install', '--prefix', tmp, `${NPM_PKG}@${version}`, '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit' })
  const bin = path.join(tmp, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
  const outJson = path.join(tmp, 'probe-results.json')
  const r = spawnSync(process.execPath, [path.join(HERE, 'probe.mjs'), '--command', bin, '--expect-version', version, '--json', outJson], { encoding: 'utf8', timeout: 300_000 })
  process.stdout.write(r.stdout ?? '')
  process.stderr.write(r.stderr ?? '')
  let results = null
  try { results = JSON.parse(fs.readFileSync(outJson, 'utf8')) } catch { /* probe 早退时无 JSON */ }
  return { exitCode: r.status ?? -1, results }
}

function badgeJson(label, message, color) {
  return `${JSON.stringify({ schemaVersion: 1, label, message, color }, null, 2)}\n`
}

/** 写徽章 JSON（有变化才写），返回变化文件列表。 */
function updateBadges({ tag, probe }) {
  const changed = []
  const write = (name, content) => {
    const p = path.join(BADGE_DIR, name)
    const prev = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
    if (prev !== content) { fs.writeFileSync(p, content); changed.push(name) }
  }
  write('upstream-latest.json', badgeJson('dsh 上游', tag.replace(/^dsh-/, ''), 'blue'))
  if (probe) {
    const version = tag.replace(/^dsh-v/, '')
    if (probe.exitCode === 0 && probe.results) {
      write('compat.json', badgeJson('dsh-one 兼容', `${version} 通过（${probe.results.passed} 项）`, 'brightgreen'))
    } else if (probe.results) {
      write('compat.json', badgeJson('dsh-one 兼容', `${version} ${probe.results.failed} 项失败`, 'red'))
    } else {
      write('compat.json', badgeJson('dsh-one 兼容', `${version} 探针未跑完`, 'red'))
    }
  }
  return changed
}

function commitBadges(changed, tag) {
  sh('git', ['add', ...changed.map((f) => path.join(BADGE_DIR, f))], { cwd: REPO_ROOT })
  sh('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', `chore(badges): dsh 上游 ${tag} 监控结果回写 [skip ci]`], { cwd: REPO_ROOT, env: { ...process.env, GIT_EDITOR: 'true' } })
  sh('git', ['push'], { cwd: REPO_ROOT })
  console.log('[watch] badges committed and pushed')
}

function probeResultsMarkdown(probe) {
  if (!probe) return '> ⚠️ 该版本尚未发布到 npm（GitHub-only release），自动化探针无法安装执行。本次只记录 release 变更；npm 发布后由下一轮监控自动补测。\n'
  if (!probe.results) return `> ❌ 探针进程异常退出（exit=${probe.exitCode}），未产出结果。\n`
  const rows = probe.results.results.map((r) => {
    const mark = { pass: '✅', fail: '❌', skip: '⏭️' }[r.status]
    return `| ${mark} | \`${r.id}\` | ${r.name} | ${String(r.detail).replaceAll('|', '\\|').slice(0, 200)} |`
  })
  return [
    `探针结果：**${probe.results.passed} pass / ${probe.results.failed} fail / ${probe.results.skipped} skip**（dsh ${probe.results.expectVersion}，CI ubuntu-latest + Node 24）`,
    '',
    '| 结果 | 检查项 | 说明 | 细节 |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function issueBody({ rel, version, npmVersion, probe }) {
  const notes = (rel.body ?? '').trim()
  const notesCut = notes.length > 6000 ? `${notes.slice(0, 6000)}\n\n> …（截断，完整见 release 页）` : notes
  return [
    `上游发布 [${rel.tag_name}](${rel.html_url})（${rel.published_at}），npm dist-tags 里 \`${NPM_PKG}\` 对应版本：${npmVersion ?? '未发布'}。`,
    '',
    '## 自动化兼容性探针',
    '',
    probeResultsMarkdown(probe),
    '## 人工完整测试',
    '',
    '探针只覆盖 wire 面（启动/认证/unary/WS 帧形状），**不含真模型行为**（流式渲染、工具执行、会话迁移等）。完整测试清单见 [docs/dsh-compat-checklist.md](../blob/main/docs/dsh-compat-checklist.md) 的「人工/补充项」一节。',
    '',
    '## Release notes',
    '',
    notesCut || '（无）',
    '',
    '---',
    `由 dsh-upstream-watch 自动创建${probe ? '' : '（探针未执行）'}。`,
  ].join('\n')
}

async function main() {
  const opts = parseArgs(process.argv)
  const rel = await latestRelease(opts.tag)
  const version = rel.tag_name.replace(/^dsh-v/, '')
  console.log(`[watch] latest release: ${rel.tag_name} (${rel.published_at})`)

  const meta = await npmMeta()
  const npmVersion = meta.versions?.[version] ? version : null
  console.log(`[watch] npm ${NPM_PKG}@${version}: ${npmVersion ? 'available' : 'NOT published'} (latest=${meta['dist-tags']?.latest})`)

  const existing = opts.force ? null : findExistingIssue(opts.repo, rel.tag_name)
  if (existing) {
    // GitHub-only 版本先建过 issue（未跑探针）；npm 发布后在这里补测：
    // 跑探针 → 结果以 comment 追加（标记幂等）→ 更新徽章。
    const viewed = JSON.parse(sh('gh', ['issue', 'view', String(existing.number), '--repo', opts.repo, '--json', 'body,comments']))
    const probePending = viewed.body.includes('（探针未执行）')
    const probeDone = (viewed.comments ?? []).some((c) => c.body.includes('<!-- probe-results -->'))
    if (!(opts.probe && npmVersion && probePending && !probeDone)) {
      console.log(`[watch] issue already tracked: #${existing.number} (${existing.state}) — nothing to do`)
      return
    }
    console.log(`[watch] #${existing.number} pending probe; npm now available, running probe`)
    const probe = runProbe(version)
    if (opts.dryRun) {
      console.log('[watch] dry-run: would comment probe results:\n')
      console.log(probeResultsMarkdown(probe))
      return
    }
    const changed = updateBadges({ tag: rel.tag_name, probe })
    if (opts.commit && changed.length > 0) commitBadges(changed, rel.tag_name)
    sh('gh', ['issue', 'comment', String(existing.number), '--repo', opts.repo, '--body', `<!-- probe-results -->\n## 自动化兼容性探针（npm 发布补测）\n\n${probeResultsMarkdown(probe)}`])
    sh('gh', ['issue', 'edit', String(existing.number), '--repo', opts.repo, '--body', viewed.body.replace('由 dsh-upstream-watch 自动创建（探针未执行）。', '由 dsh-upstream-watch 自动创建；探针结果见下方 comment。')])
    console.log(`[watch] probe results commented on #${existing.number}`)
    return
  }

  let probe = null
  if (opts.probe && npmVersion) probe = runProbe(version)
  else if (!npmVersion) console.log('[watch] probe skipped: version not on npm')

  if (opts.dryRun) {
    console.log('[watch] dry-run: would create issue and update badges; planned issue body:\n')
    console.log(issueBody({ rel, version, npmVersion, probe }))
    return
  }

  // 徽章
  const changed = updateBadges({ tag: rel.tag_name, probe })
  if (changed.length > 0) console.log(`[watch] badges changed: ${changed.join(', ')}`)
  if (opts.commit && changed.length > 0) commitBadges(changed, rel.tag_name)

  // issue
  sh('gh', ['label', 'create', ISSUE_LABEL, '--repo', opts.repo, '--force', '--description', '上游 dsh release 兼容性跟踪', '--color', '0e8a16'])
  const body = issueBody({ rel, version, npmVersion, probe })
  const out = sh('gh', ['issue', 'create', '--repo', opts.repo, '--label', ISSUE_LABEL, '--title', `dsh 上游 ${rel.tag_name} 兼容性测试`, '--body', body])
  console.log(`[watch] issue created: ${out}`)
}

main().catch((e) => { console.error(`[watch] ${e.message ?? e}`); process.exit(2) })
