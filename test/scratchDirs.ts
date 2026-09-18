/**
 * 单测 scratch 目录（#200）：一处建、进程退出时删。
 *
 * 为什么要有这么一层，而不是各处自己 `mkdtemp` + `try/finally`：`node --test` 每个
 * 测试文件跑在自己的子进程里，各家自己收就意味着几十个用例各写一遍收尾；漏掉一处，
 * `$TMPDIR` 就重新开始堆（#200 量到三万多）。统一挂到**进程退出**上，收尾只有这一份
 * 实现，新增用例天然带着。用例自己已经写的 `try/finally` 清理留着也没错（早清理），
 * 这一层是保证「无论如何都不留」的兜底。
 *
 * 收不掉的（进程被 SIGKILL、目录被别的进程占着）只吞掉、绝不让测试变红——那是物理
 * 残留，正是 #200 明说允许的那一档；反过来，成功路径必须删掉，
 * `test/scratchDirs.test.ts` 的「跑完自检」用例盯着这件事。
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * 本仓在 `$TMPDIR` 下用的 scratch 前缀全表（单测 + 验收脚本）：
 * `test/scratchDirs.test.ts` 按它统计残留，静态扫描也按它核对「没有没登记的前缀」。
 */
export const SCRATCH_PREFIXES: readonly string[] = [
  // test/*.test.ts
  'dsh-cap-',
  'dsh-lab-doctor-e2e-',
  'dsh-lab-doctor-judge-',
  'dsh-lab-doctor-other-',
  'dsh-official-ids-',
  'dsh-one-bundle-',
  'dsh-one-events-',
  'dsh-one-log-',
  'dsh-one-state-',
  'dsh-owned-test-',
  'dsh-probe-',
  'dsh-scratch-guard-',
  'dsh-state-test-',
  'dsh-tag-bridge-',
  'dsh-tag-e2e-',
  'dshone-disc-',
  'dshone-git-',
  'dshone-gitremote-',
  'dshone-hostcall-',
  'dshone-link-out-',
  'dshone-link-root-',
  'dshone-nogit-',
  'dshone-outside-',
  'dshone-platgate-',
  'dshone-platgate-link-',
  'dshone-qdir-gateway-',
  'dshone-qdir-out-',
  'dshone-qdir-vscode-',
  'dshone-remote-',
  'dshone-ws-',
  // test/assembly-lab（`npm run verify:lab`）
  'dsh-lab-fresh-home-',
  'dsh-lab-home-',
  'dsh-one-lab-plugins-',
  // scripts/（验收脚本，不在 `npm test` 里，但同族）
  'dsh-clean-profile-',
  'dsh-expand-official-',
  'dsh-host-half-verify-',
  'dsh-lab-version-',
  'dsh-plugins-verify-',
  'dsh-watch-',
]

const live = new Set<string>()
let hooked = false

/** 退出时删掉本进程建过的 scratch 目录；删不掉的只吞掉（物理残留，#200）。 */
function hookExitCleanup(): void {
  if (hooked) return
  hooked = true
  process.on('exit', () => {
    for (const dir of live) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* 物理残留：清理失败不许让测试变红 */
      }
    }
  })
}

function track(dir: string): string {
  live.add(dir)
  hookExitCleanup()
  return dir
}

/** 建一个 scratch 目录，进程退出时自动删。 */
export async function scratchDir(prefix: string): Promise<string> {
  return track(await mkdtemp(path.join(os.tmpdir(), prefix)))
}

/** 同步版（用例里已用同步 `node:fs` 时省一次 await）。 */
export function scratchDirSync(prefix: string): string {
  return track(mkdtempSync(path.join(os.tmpdir(), prefix)))
}

/** 某个临时根下命中本仓 scratch 前缀的条目名（升序）；给残留判据用。 */
export function scratchEntriesIn(root: string, prefixes: readonly string[] = SCRATCH_PREFIXES): string[] {
  return readdirSync(root)
    .filter((name) => prefixes.some((p) => name.startsWith(p)))
    .sort()
}
