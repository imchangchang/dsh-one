import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pickVersion, type Channel, type Packument } from '../pure/registry.ts'
import { gt } from '../pure/semver.ts'
import type { Logger } from '../log.ts'
import type { NodeRuntime } from './node.ts'

const execFileP = promisify(execFile)

const REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai/dsh'
const BIN_JS_REL = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const LAST_UPDATE_CHECK_KEY = 'dshOne.lastUpdateCheck'
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000

export type DshRuntime =
  | { kind: 'system'; command: string; version: string }
  | { kind: 'managed'; nodePath: string; binJs: string; version: string }

interface DshConfig {
  channel: Channel
  pinnedVersion: string
  autoUpdate: boolean
  useSystemDsh: boolean
}

function readConfig(): DshConfig {
  const cfg = vscode.workspace.getConfiguration('dshOne')
  return {
    channel: cfg.get<Channel>('channel', 'rc'),
    pinnedVersion: cfg.get<string>('pinnedVersion', '').trim(),
    autoUpdate: cfg.get<boolean>('autoUpdate', true),
    useSystemDsh: cfg.get<boolean>('useSystemDsh', false),
  }
}

function dshRoot(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'runtimes', 'dsh')
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Extract a semver-looking token from `--version` output. */
function parseVersionOutput(out: string): string | null {
  const m = /(\d+\.\d+\.\d+(?:-[0-9a-zA-Z.-]+)?)/.exec(out)
  return m ? m[1] : null
}

async function verifyInstall(nodePath: string, binJs: string, logger: Logger): Promise<string> {
  const { stdout } = await execFileP(nodePath, [binJs, '--version'], { timeout: 30_000 })
  const version = parseVersionOutput(stdout)
  if (!version) throw new Error(`cannot parse dsh --version output: ${stdout.trim()}`)
  logger.info(`verified dsh ${version} at ${binJs}`)
  return version
}

/**
 * Resolve the npm command for a given node runtime.
 * Prefers the npm bundled next to that node; falls back to PATH.
 */
function resolveNpm(node: NodeRuntime): { cmd: string; argsPrefix: string[] } {
  if (node.source === 'downloaded') {
    const root = path.dirname(path.dirname(node.nodePath)) // <ver>/bin/node → <ver>
    const candidates =
      process.platform === 'win32'
        ? [path.join(path.dirname(node.nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
        : [path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    for (const cli of candidates) {
      return { cmd: node.nodePath, argsPrefix: [cli] }
    }
  }
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', argsPrefix: [] }
}

async function fetchPackument(logger: Logger): Promise<Packument> {
  logger.info(`fetching ${REGISTRY_URL}`)
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`npm registry returned HTTP ${res.status}`)
  return (await res.json()) as Packument
}

async function findSystemDsh(logger: Logger): Promise<DshRuntime> {
  const cmd = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const { stdout } = await execFileP(cmd, ['--version'], { timeout: 15_000 })
  const version = parseVersionOutput(stdout) ?? 'unknown'
  logger.info(`using system dsh ${version}`)
  return { kind: 'system', command: cmd, version }
}

/**
 * Serialize npm installs. The service-start path (ensureDsh) and the update
 * check (checkForUpdates) can otherwise race two npm processes into the same
 * prefix, corrupting each other's node_modules (observed as ENOTEMPTY /
 * TAR_ENTRY_ERROR from parallel npm installs).
 */
let installChain: Promise<unknown> = Promise.resolve()

function withInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = installChain.then(fn)
  installChain = run.catch(() => undefined)
  return run
}

async function installDsh(
  context: vscode.ExtensionContext,
  logger: Logger,
  node: NodeRuntime,
  version: string,
  report?: (message: string) => void,
  token?: vscode.CancellationToken,
): Promise<string> {
  const prefix = path.join(dshRoot(context), version)
  const binJs = path.join(prefix, BIN_JS_REL)
  await fs.mkdir(prefix, { recursive: true })

  const npm = resolveNpm(node)
  const args = [
    ...npm.argsPrefix,
    'install',
    '--prefix',
    prefix,
    `@deepseek-ai/dsh@${version}`,
    '--no-audit',
    '--no-fund',
  ]
  report?.(`npm install @deepseek-ai/dsh@${version}…`)
  logger.info(`running: ${npm.cmd} ${args.join(' ')}`)

  // npm gives no usable progress output, so poll the node_modules package
  // count instead — a moving number tells the user the install is alive.
  const nmDir = path.join(prefix, 'node_modules')
  const startedAt = Date.now()
  const ticker = setInterval(() => {
    void (async () => {
      let count = 0
      try {
        count = (await fs.readdir(nmDir)).filter((e) => !e.startsWith('.')).length
      } catch {
        // node_modules not created yet
      }
      const secs = Math.round((Date.now() - startedAt) / 1000)
      report?.(`npm install @deepseek-ai/dsh@${version}…（已安装 ${count} 个包，${secs}s）`)
    })()
  }, 2_000)

  const install = execFileP(npm.cmd, args, { timeout: 10 * 60_000 })
  const cancelSub = token?.onCancellationRequested(() => {
    logger.warn(`npm install for dsh@${version} cancelled by user, killing npm (pid=${install.child.pid})`)
    install.child.kill('SIGTERM')
  })
  try {
    await install
  } catch (err) {
    await fs.rm(prefix, { recursive: true, force: true }).catch(() => undefined)
    if (token?.isCancellationRequested) {
      throw new Error(`已取消 dsh@${version} 的下载`)
    }
    throw new Error(`npm install failed for dsh@${version}: ${err}`)
  } finally {
    cancelSub?.dispose()
    clearInterval(ticker)
  }

  report?.('校验安装…')
  try {
    await verifyInstall(node.nodePath, binJs, logger)
  } catch (err) {
    await fs.rm(prefix, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
  return binJs
}

interface Pointer {
  version: string
}

/**
 * Ensure a dsh runtime is available, downloading it on first use.
 * Managed installs live under globalStorage/runtimes/dsh/<version>; a
 * current.json pointer records the active version and last-good.json the
 * previous one (no symlinks — Windows friendly).
 */
export async function ensureDsh(
  context: vscode.ExtensionContext,
  logger: Logger,
  node: NodeRuntime,
): Promise<DshRuntime> {
  const cfg = readConfig()
  if (cfg.useSystemDsh) return findSystemDsh(logger)

  const root = dshRoot(context)
  await fs.mkdir(root, { recursive: true })
  const currentFile = path.join(root, 'current.json')
  const lastGoodFile = path.join(root, 'last-good.json')

  const packument = await fetchPackument(logger)
  const version = pickVersion(packument, { channel: cfg.channel, pinnedVersion: cfg.pinnedVersion })
  const binJs = path.join(root, version, BIN_JS_REL)

  const useExisting = await fs
    .access(binJs)
    .then(() => true)
    .catch(() => false)

  if (useExisting) {
    try {
      await verifyInstall(node.nodePath, binJs, logger)
      await updatePointer(currentFile, lastGoodFile, version, logger)
      return { kind: 'managed', nodePath: node.nodePath, binJs, version }
    } catch (err) {
      logger.warn(`cached dsh ${version} failed verification: ${err}; reinstalling`)
    }
  }

  try {
    const installed = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DSH One: 下载 dsh 运行时', cancellable: true },
      async (progress, token) =>
        withInstallLock(() =>
          installDsh(context, logger, node, version, (m) => progress.report({ message: m }), token),
        ),
    )
    await updatePointer(currentFile, lastGoodFile, version, logger)
    return { kind: 'managed', nodePath: node.nodePath, binJs: installed, version }
  } catch (err) {
    // Roll back to the last known-good install when possible.
    const lastGood = await readJson<Pointer>(lastGoodFile)
    if (lastGood && lastGood.version !== version) {
      const fallbackBin = path.join(root, lastGood.version, BIN_JS_REL)
      try {
        await verifyInstall(node.nodePath, fallbackBin, logger)
        logger.warn(`falling back to last-good dsh ${lastGood.version}`)
        await updatePointer(currentFile, lastGoodFile, lastGood.version, logger)
        return { kind: 'managed', nodePath: node.nodePath, binJs: fallbackBin, version: lastGood.version }
      } catch {
        // fall through to the original error
      }
    }
    throw err
  }
}

/** Move the current pointer to `version`, remembering the old one as last-good. */
async function updatePointer(currentFile: string, lastGoodFile: string, version: string, logger: Logger): Promise<void> {
  const prev = await readJson<Pointer>(currentFile)
  if (prev && prev.version !== version) {
    await fs.writeFile(lastGoodFile, JSON.stringify(prev, null, 2))
  }
  await fs.writeFile(currentFile, JSON.stringify({ version } satisfies Pointer, null, 2))
  logger.info(`dsh current version -> ${version}`)
}

export interface UpdateCheckResult {
  /** Newly installed version, when an update was installed in the background. */
  installed?: string
  /** Version currently pointed to. */
  current?: string
  /** Human-readable status for the manual check command. */
  message: string
}

/**
 * Check the registry for a newer dsh and install it in the background.
 * Throttled to once per 12h (timestamp in globalState) unless forced.
 * Skipped entirely when a version is pinned, autoUpdate is off (unless forced),
 * or the system dsh is in use.
 */
export async function checkForUpdates(
  context: vscode.ExtensionContext,
  logger: Logger,
  node: NodeRuntime,
  opts: { force?: boolean } = {},
): Promise<UpdateCheckResult> {
  const cfg = readConfig()
  if (cfg.useSystemDsh) return { message: '正在使用系统 dsh，跳过更新检查' }
  if (cfg.pinnedVersion) return { message: `已固定使用版本 ${cfg.pinnedVersion}，跳过更新检查` }
  if (!cfg.autoUpdate && !opts.force) return { message: '自动更新已关闭' }

  if (!opts.force) {
    const last = context.globalState.get<number>(LAST_UPDATE_CHECK_KEY, 0)
    if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) {
      logger.info('update check skipped (checked within the last 12h)')
      return { message: '距上次检查不足 12 小时，已跳过' }
    }
  }
  await context.globalState.update(LAST_UPDATE_CHECK_KEY, Date.now())

  const root = dshRoot(context)
  const current = await readJson<Pointer>(path.join(root, 'current.json'))
  const packument = await fetchPackument(logger)
  const target = pickVersion(packument, { channel: cfg.channel, pinnedVersion: cfg.pinnedVersion })

  if (current && !gt(target, current.version)) {
    logger.info(`dsh is up to date (${current.version})`)
    return { current: current.version, message: `已是最新版本 ${current.version}` }
  }

  logger.info(`installing dsh update ${current?.version ?? '(none)'} -> ${target}`)
  const binJs = await withInstallLock(() => installDsh(context, logger, node, target))
  await updatePointer(path.join(root, 'current.json'), path.join(root, 'last-good.json'), target, logger)
  return {
    installed: target,
    current: current?.version,
    message: `DSH 已更新到 ${target}（下次启动服务时生效）`,
  }
}
