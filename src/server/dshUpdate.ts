import * as vscode from 'vscode'
import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { Logger } from '../log.ts'
import type { LocatedDsh } from './locateDsh.ts'
import {
  commandLine,
  latestFromRegistryJson,
  npmCommandCandidates,
  npmMajorFromVersion,
  registryLatestUrls,
  upgradeArgs,
} from '../pure/dshUpdate.ts'

/** 单次 registry 查询的超时；检查更新是交互动作，卡太久不如早点报失败。 */
const REGISTRY_TIMEOUT_MS = 8_000

/**
 * dsh 更新检查 + 升级动作（#86）。
 *
 * 这里只持有「npm latest 是哪个版本」和「上次检查为什么失败」两件事：当前装的版本
 * 由调用方在渲染时现算（`decideUpdate(installed, latest)`），所以 dsh 服务换了版本
 * 之后，状态栏不用再等一次网络往返就能对上。
 *
 * 升级动作按用户拍板走集成终端（命令可见、可中断、失败输出留在终端里），扩展只负责
 * 拼一行正确、可直接执行的命令。
 */
export class DshUpdate implements vscode.Disposable {
  private latestVersion?: string
  private failure?: string
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChange: vscode.Event<void> = this.emitter.event

  constructor(private readonly logger: Logger) {}

  /** npm `latest` 指向的版本；从未成功查到时 undefined。 */
  latest(): string | undefined {
    return this.latestVersion
  }

  /** 上次检查失败的原因（成功后清空）；四个判定态里的 unknown 会用到。 */
  lastError(): string | undefined {
    return this.failure
  }

  /**
   * 查 npm registry 的 latest。官方源失败就退到 npmmirror；两个都失败时
   * 记下原因、保留上一次已知的版本，并照常通知订阅者——调用方据此报
   * 「检查失败」，绝不能把失败说成「已是最新」。
   */
  async check(): Promise<void> {
    for (const url of registryLatestUrls()) {
      try {
        const res = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const version = latestFromRegistryJson(await res.json())
        if (!version) throw new Error('no latest version in the registry response')
        this.latestVersion = version
        this.failure = undefined
        this.logger.info(`dsh update check: npm latest = ${version} (${url})`)
        this.emitter.fire()
        return
      } catch (err) {
        this.failure = err instanceof Error ? err.message : String(err)
        this.logger.warn(`dsh update check failed via ${url}: ${this.failure}`)
      }
    }
    this.emitter.fire()
  }

  /**
   * 在集成终端里跑全局安装命令。latest 已知时装那个确切版本（与「升级到 vX」的
   * 提示一致），未知时退回 `@latest` 标签。
   */
  runUpgradeInTerminal(dsh: LocatedDsh, latest?: string): void {
    const npm = resolveNpm(dsh.command, this.logger)
    const line = commandLine(npm, upgradeArgs(latest, npmMajor(npm)))
    const terminal = vscode.window.createTerminal({ name: 'dsh upgrade' })
    terminal.show(false)
    // Windows 默认终端是 PowerShell：带引号的路径要靠调用运算符 `&` 才会执行。
    terminal.sendText(process.platform === 'win32' ? `& ${line}` : line)
    this.logger.info(`dsh upgrade: ${line}`)
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

/** 取 dsh 可执行文件同目录的 npm（便携 Node / nvm / 系统安装都是这个布局），找不到就用 PATH 上的。 */
function resolveNpm(dshCommand: string, logger: Logger): string {
  for (const candidate of npmCommandCandidates(dshCommand)) {
    if (candidate === 'npm') return candidate
    if (fs.existsSync(candidate)) return candidate
  }
  logger.info(`no npm next to ${dshCommand}; falling back to npm on PATH`)
  return 'npm'
}

/**
 * 问 npm 的主版本号（决定要不要带 `--allow-scripts`）。问不到就返回 undefined，
 * 命令里不带该参数——老版本 npm 见到它直接失败，宁可少带也不能让升级命令起不来。
 */
function npmMajor(npm: string): number | undefined {
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(npm, ['--version'], {
    shell: process.platform === 'win32',
    env,
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) return undefined
  return npmMajorFromVersion(`${result.stdout ?? ''}${result.stderr ?? ''}`)
}
