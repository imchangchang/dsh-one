/**
 * Minimal semver implementation supporting prerelease tags.
 * No dependencies, no `vscode` import — pure logic, unit-testable with `node --test`.
 *
 * Supports versions like `1.2.3`, `v1.2.3`, `0.1.0-rc.7`, `0.1.1-rc.2`.
 */

export interface SemVer {
  major: number
  minor: number
  patch: number
  /** Prerelease identifiers, e.g. ['rc', 7]. Empty array = stable release. */
  prerelease: (string | number)[]
}

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-((?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/

/** Parse a semver string. Returns null when the input is not valid semver. */
export function parse(version: string): SemVer | null {
  const m = SEMVER_RE.exec(version.trim())
  if (!m) return null
  const prerelease: (string | number)[] = m[4]
    ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : []
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
  }
}

/**
 * Compare two versions per semver 2.0 precedence rules.
 * Returns a negative number, 0, or a positive number.
 * Throws when either input is not valid semver.
 */
export function compare(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa) throw new Error(`invalid semver: ${a}`)
  if (!pb) throw new Error(`invalid semver: ${b}`)

  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch

  // A release outranks any of its prereleases.
  const aPre = pa.prerelease
  const bPre = pb.prerelease
  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return 1
  if (bPre.length === 0) return -1

  const len = Math.min(aPre.length, bPre.length)
  for (let i = 0; i < len; i++) {
    const x = aPre[i]
    const y = bPre[i]
    if (x === y) continue
    const xNum = typeof x === 'number'
    const yNum = typeof y === 'number'
    // Numeric identifiers have lower precedence than alphanumeric ones.
    if (xNum && !yNum) return -1
    if (!xNum && yNum) return 1
    if (xNum && yNum) return (x as number) - (y as number)
    return String(x) < String(y) ? -1 : 1
  }
  return aPre.length - bPre.length
}

/** a >= b (semver precedence). */
export function gte(a: string, b: string): boolean {
  return compare(a, b) >= 0
}

/** a > b (semver precedence). */
export function gt(a: string, b: string): boolean {
  return compare(a, b) > 0
}

/** Highest version in the list, or null for an empty list. Invalid entries are ignored. */
export function maxSatisfying(versions: string[]): string | null {
  let best: string | null = null
  for (const v of versions) {
    if (!parse(v)) continue
    if (best === null || gt(v, best)) best = v
  }
  return best
}
