import * as vscode from 'vscode'
import { spawnSync } from 'node:child_process'
import { parse } from '../pure/semver.ts'
import type { Logger } from '../log.ts'

export interface LocatedDsh {
  command: string
  version: string
}

/** Thrown when no dsh executable could be located; the UI offers an install link. */
export class DshNotFoundError extends Error {}

/** Extract the first semver-shaped token from `dsh --version` output. */
function extractVersion(text: string): string {
  for (const token of text.split(/\s+/)) {
    const cleaned = token.replace(/^v/, '')
    if (parse(cleaned)) return cleaned
  }
  return 'unknown'
}

/**
 * Resolve the dsh executable: the dshOne.dshPath setting wins, otherwise the
 * `dsh` on PATH. The candidate is verified by running `dsh --version`; its
 * version (or 'unknown') is reported so callers can gate feature flags.
 */
export async function locateDsh(logger: Logger): Promise<LocatedDsh> {
  const configured = vscode.workspace.getConfiguration('dshOne').get<string>('dshPath', '').trim()
  const command = configured !== '' ? configured : 'dsh'

  // The extension host injects NODE_OPTIONS / ELECTRON_RUN_AS_NODE, both of
  // which break a plain node child process.
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE

  const result = spawnSync(command, ['--version'], {
    shell: process.platform === 'win32',
    env,
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) {
    throw new DshNotFoundError(
      vscode.l10n.t('dsh not found. Install it with: npm install -g @deepseek-ai/dsh@next; or point the dshOne.dshPath setting at the dsh executable.'),
    )
  }

  const version = extractVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  logger.info(`located dsh: ${command} (version=${version})`)
  return { command, version }
}
