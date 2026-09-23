/**
 * Windows 上的端口占用者查询（#235）。
 *
 * 为什么单开一个文件：`portHolder`（`labServer.ts`）在 POSIX 上用 `lsof` + `ps`，
 * 这两个命令 Windows 上没有——windows-latest 上这条诊断一直只报「查不到是谁」。
 * Windows 那一支的命令与解析全在这里，`labServer.ts` 只留一句按平台分派。
 *
 * 取法：`netstat -ano -p tcp` 里 `TCP … LISTENING <pid>` 的行；命令行优先
 * `Get-CimInstance Win32_Process`（`wmic` 在新版 Windows 上已被移除，不能依赖），
 * 拿不到就退回 `tasklist` 的进程名——有名字有 pid 就够人找到并结束它了。
 */
import { execFileSync } from 'node:child_process'

/** Windows 下的端口占用者（`pid 4688（…）` 形状，与 POSIX 支同一形状）；取不到 undefined。 */
export function windowsPortHolder(port: number): string | undefined {
  const listing = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
  const pids = parseWindowsListeners(listing, port)
  if (pids.length === 0) return undefined
  return pids
    .map((pid) => {
      const command = windowsCommandOf(pid)
      return command === '' ? `pid ${pid}` : `pid ${pid}（${command}）`
    })
    .join('、')
}

/**
 * `netstat -ano` 输出里监听这个端口的 PID（纯函数，样本单测覆盖）。
 *
 * 只认 `TCP` 行、状态 `LISTENING`，端口比的是**本地地址最后一个 `:` 之后**那一段：
 * 直接拿整行找端口号会把 5014 与 50145 认混，也会把 `0.0.0.0:0` 那种通配对端算进来。
 */
export function parseWindowsListeners(listing: string, port: number): string[] {
  const pids = new Set<string>()
  for (const line of listing.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 5 || fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue
    if (fields[1].slice(fields[1].lastIndexOf(':') + 1) !== String(port)) continue
    pids.add(fields[4])
  }
  return [...pids]
}

/** 一个 Windows 进程的命令行（尽力而为）；取不到给空串，调用方只报 pid。 */
function windowsCommandOf(pid: string): string {
  try {
    const line = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: 'utf8', windowsHide: true },
    )
      .trim()
      .replace(/\s+/g, ' ')
    if (line !== '') return line
  } catch {
    /* 落到 tasklist */
  }
  try {
    const csv = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return /^"([^"]+)"/.exec(csv.trim())?.[1] ?? ''
  } catch {
    return ''
  }
}
