/**
 * Pick a dsh version from an npm registry packument.
 * Pure logic — no `vscode` import, no network access (the packument is passed in).
 */

import { maxSatisfying } from './semver.ts'

export type Channel = 'stable' | 'rc'

export interface Packument {
  'dist-tags'?: Record<string, string>
  versions?: Record<string, unknown>
}

export interface PickOptions {
  channel: Channel
  /** Non-empty pins the exact version; channel is ignored. */
  pinnedVersion?: string
}

/**
 * Decide which dsh version to install.
 * - pinnedVersion (non-empty): must exist in the packument, otherwise throws.
 * - channel 'stable': uses dist-tags.latest.
 * - channel 'rc': the highest version in `versions`, including prereleases
 *   (dsh currently ships rc-only releases).
 */
export function pickVersion(packument: Packument, opts: PickOptions): string {
  const pinned = opts.pinnedVersion?.trim()
  if (pinned) {
    if (!packument.versions || !(pinned in packument.versions)) {
      throw new Error(`pinned dsh version ${pinned} not found in npm registry`)
    }
    return pinned
  }

  if (opts.channel === 'stable') {
    const latest = packument['dist-tags']?.latest
    if (!latest) throw new Error('npm registry packument has no dist-tags.latest')
    return latest
  }

  const best = maxSatisfying(Object.keys(packument.versions ?? {}))
  if (!best) throw new Error('npm registry packument has no versions')
  return best
}
