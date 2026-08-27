import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseSemver } from '../pure/semver.ts'
import type { Logger } from '../log.ts'

const execFileP = promisify(execFile)

const MIN_NODE_MAJOR = 22
const DIST_INDEX_URL = 'https://nodejs.org/dist/index.json'

export interface NodeRuntime {
  /** Absolute path of the node executable. */
  nodePath: string
  /** e.g. "22.14.0". */
  version: string
  /** Where the runtime came from. */
  source: 'system' | 'downloaded'
}

/** Try `node --version` on PATH; return the runtime when it is >= 22. */
export async function findSystemNode(logger: Logger): Promise<NodeRuntime | null> {
  const candidates = process.platform === 'win32' ? ['node.exe', 'node'] : ['node']
  for (const cmd of candidates) {
    try {
      const { stdout } = await execFileP(cmd, ['--version'], { timeout: 10_000 })
      const version = stdout.trim().replace(/^v/, '')
      const sv = parseSemver(version)
      if (sv && sv.major >= MIN_NODE_MAJOR) {
        logger.info(`found system node ${version} (${cmd})`)
        return { nodePath: cmd, version, source: 'system' }
      }
      logger.warn(`system node ${version || 'unparseable'} is below v${MIN_NODE_MAJOR}, ignoring`)
    } catch {
      // not on PATH, try next candidate
    }
  }
  return null
}

interface DistEntry {
  version: string
  lts: string | false
}

/** Query nodejs.org for the newest LTS release. */
export async function latestLtsVersion(): Promise<string> {
  const res = await fetch(DIST_INDEX_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`nodejs.org dist index returned HTTP ${res.status}`)
  const entries = (await res.json()) as DistEntry[]
  for (const e of entries) {
    if (e.lts) return e.version.replace(/^v/, '')
  }
  throw new Error('no LTS release found in nodejs.org dist index')
}

/** Asset file name for the current platform/arch. */
function nodeAssetName(version: string): string {
  const v = `v${version}`
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') throw new Error(`unsupported Windows arch: ${process.arch}`)
    return `node-${v}-win-x64.zip`
  }
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return `node-${v}-darwin-${arch}.tar.gz`
  }
  if (process.platform === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return `node-${v}-linux-${arch}.tar.gz`
  }
  throw new Error(`unsupported platform: ${process.platform}`)
}

/** Path of the node executable inside an extracted distribution. */
function nodeBinPath(installDir: string): string {
  return process.platform === 'win32'
    ? path.join(installDir, 'node.exe')
    : path.join(installDir, 'bin', 'node')
}

async function downloadToFile(
  url: string,
  dest: string,
  logger: Logger,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  logger.info(`downloading ${url}`)
  const res = await fetch(url, {
    signal: AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(signal ? [signal] : [])]),
  })
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    received += value.length
    if (total > 0) onProgress?.(received / total)
  }
  await fs.writeFile(dest, Buffer.concat(chunks))
}

async function verifySha256(file: string, shasums: string, assetName: string): Promise<void> {
  const line = shasums
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.endsWith(` ${assetName}`))
  if (!line) throw new Error(`SHASUMS256.txt has no entry for ${assetName}`)
  const expected = line.split(/\s+/)[0].toLowerCase()
  const actual = crypto
    .createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex')
  if (actual !== expected) {
    throw new Error(`sha256 mismatch for ${assetName}: expected ${expected}, got ${actual}`)
  }
}

/** Extract an archive into `destDir` using the system tar (bsdtar on Windows handles zip). */
async function extract(archive: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  try {
    await execFileP('tar', ['-xf', archive, '-C', destDir], { timeout: 5 * 60_000 })
  } catch (err) {
    if (process.platform === 'win32') {
      // Fallback for exotic Windows installs without bsdtar.
      await execFileP(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}'`],
        { timeout: 5 * 60_000 },
      )
    } else {
      throw err
    }
  }
}

/**
 * Ensure a Node >= 22 runtime is available.
 * Prefers the system Node; otherwise downloads the latest official LTS build
 * into globalStorage (with SHA256 verification and an atomic directory switch).
 */
export async function ensureNode(context: vscode.ExtensionContext, logger: Logger): Promise<NodeRuntime> {
  const system = await findSystemNode(logger)
  if (system) return system

  const runtimesDir = path.join(context.globalStorageUri.fsPath, 'runtimes', 'node')
  await fs.mkdir(runtimesDir, { recursive: true })

  // Reuse a previously downloaded runtime if one is present.
  try {
    for (const entry of await fs.readdir(runtimesDir)) {
      if (entry.startsWith('.')) continue
      const bin = nodeBinPath(path.join(runtimesDir, entry))
      try {
        const { stdout } = await execFileP(bin, ['--version'], { timeout: 10_000 })
        const version = stdout.trim().replace(/^v/, '')
        const sv = parseSemver(version)
        if (sv && sv.major >= MIN_NODE_MAJOR) {
          logger.info(`reusing downloaded node ${version}`)
          return { nodePath: bin, version, source: 'downloaded' }
        }
      } catch {
        // broken/partial install, keep looking
      }
    }
  } catch {
    // runtimes dir unreadable — fall through to a fresh download
  }

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'DSH One: 下载 Node.js 运行时', cancellable: true },
    async (progress, token) => {
      const cancel = new AbortController()
      token.onCancellationRequested(() => cancel.abort())
      progress.report({ message: '查询最新 LTS 版本…' })
      const version = await latestLtsVersion()
      const asset = nodeAssetName(version)
      const installDir = path.join(runtimesDir, version)
      const bin = nodeBinPath(installDir)

      const tmp = path.join(runtimesDir, `.tmp-${crypto.randomUUID()}`)
      try {
        await fs.mkdir(tmp, { recursive: true })
        const archivePath = path.join(tmp, asset)
        progress.report({ message: `下载 ${asset}…` })
        let reportedPct = 0
        await downloadToFile(
          `https://nodejs.org/dist/v${version}/${asset}`,
          archivePath,
          logger,
          (fraction) => {
            const pct = Math.floor(fraction * 100)
            progress.report({ message: `下载 ${asset}… ${pct}%`, increment: pct - reportedPct })
            reportedPct = pct
          },
          cancel.signal,
        )

        progress.report({ message: '校验 SHA256…' })
        const shasumsPath = path.join(tmp, 'SHASUMS256.txt')
        await downloadToFile(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`, shasumsPath, logger)
        await verifySha256(archivePath, await fs.readFile(shasumsPath, 'utf8'), asset)

        progress.report({ message: '解压…' })
        const extractDir = path.join(tmp, 'x')
        await extract(archivePath, extractDir)
        const inner = path.join(extractDir, asset.replace(/\.(zip|tar\.gz)$/, ''))

        // Atomic switch: rename within the same volume, then drop the old dir.
        await fs.rm(installDir, { recursive: true, force: true })
        await fs.rename(inner, installDir)

        const { stdout } = await execFileP(bin, ['--version'], { timeout: 10_000 })
        logger.info(`installed node ${stdout.trim()} at ${installDir}`)
        return { nodePath: bin, version, source: 'downloaded' }
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      }
    },
  )
}
