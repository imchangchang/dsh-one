import * as vscode from 'vscode'
import { spawnSync } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { extractDshVersion } from '../pure/dshCommandLine.ts'
import type { Logger } from '../log.ts'

export interface LocatedDsh {
  command: string
  version: string
}

/** Thrown when no dsh executable could be located; the UI offers an install link. */
export class DshNotFoundError extends Error {}

/** Extract the first semver-shaped token from `dsh --version` output (see pure/dshCommandLine). */
const extractVersion = extractDshVersion

/**
 * The one-click installers (install/dsh-install.ps1 / .sh) install a portable
 * Node and the dsh CLI into `~/.dsh/node-*`. Fall back to those absolute
 * paths when `dsh` is not on PATH: VS Code processes snapshot PATH at launch,
 * so a window opened before the installer ran never sees the new directory,
 * and a restart is not always practical.
 */
function installerCandidates(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return [
      path.join(home, '.dsh', 'node-x64', 'dsh.cmd'),
      path.join(home, '.dsh', 'node-arm64', 'dsh.cmd'),
    ]
  }
  const osName = process.platform === 'darwin' ? 'darwin' : 'linux'
  return [
    path.join(home, '.dsh', `node-${osName}-x64`, 'bin', 'dsh'),
    path.join(home, '.dsh', `node-${osName}-arm64`, 'bin', 'dsh'),
  ]
}

/**
 * Resolve the dsh executable: the dshOne.dshPath setting wins, otherwise the
 * `dsh` on PATH, otherwise the installer's default location under ~/.dsh.
 * The candidate is verified by running `dsh --version`; its version (or
 * 'unknown') is reported so callers can gate feature flags.
 */
export async function locateDsh(logger: Logger): Promise<LocatedDsh> {
  const configured = vscode.workspace.getConfiguration('dshOne').get<string>('dshPath', '').trim()
  const candidates = configured !== '' ? [configured] : ['dsh', ...installerCandidates()]

  // The extension host injects NODE_OPTIONS / ELECTRON_RUN_AS_NODE, both of
  // which break a plain node child process.
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE

  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], {
      shell: process.platform === 'win32',
      env,
      encoding: 'utf8',
    })
    if (result.error || result.status !== 0) continue
    const version = extractVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    logger.info(`located dsh: ${command} (version=${version})`)
    return { command, version }
  }

  throw new DshNotFoundError(
    vscode.l10n.t('dsh not found. Install it with: npm install -g @deepseek-ai/dsh@next; or point the dshOne.dshPath setting at the dsh executable.'),
  )
}
