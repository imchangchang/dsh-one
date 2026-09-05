import { parse } from './semver.ts'

/**
 * 从进程命令行解析 dsh 的真实入口（用于对「外部启动/收养的实例」查询版本）。
 * 纯函数，无环境依赖，直接 `node --test` 可测。
 */

/** 解析出的可执行入口：command + 前置 args；调用方自行追加 `--version`。 */
export interface DshEntry {
  command: string
  args: string[]
}

/** 从 `dsh --version` 输出提取第一个 semver 形状的 token；无则 'unknown'。 */
export function extractDshVersion(text: string): string {
  for (const token of text.split(/\s+/)) {
    const cleaned = token.replace(/^v/, '')
    if (parse(cleaned)) return cleaned
  }
  return 'unknown'
}

/**
 * 解析命令行里的 dsh 入口。
 *
 * 常见形态（实测与本仓库安装布局）：
 * - `node .../node_modules/@deepseek-ai/dsh/lib/bin.js web …` → `node [lib/bin.js]`
 * - `.../@deepseek-ai/dsh/dist/dsh.js …`（官方打包产物）→ `node [dist/dsh.js]`
 * - `node .../bin/dsh web …`（nvm 全局 shim 转发）→ `[bin/dsh]` 直接执行
 * - Windows `...\npm\dsh.cmd web …` → `[dsh.cmd]` 直接执行
 * - `.../@deepseek-ai/dsh web …`（命令行直接指向包目录）→ `node [lib/bin.js]`
 *
 * 解析失败（如命令行只有裸 `dsh`，无法确认来源安装）返回 null——调用方
 * 宁可缺省不显示版本，避免用扩展 PATH 的 dsh 造成误导。
 */
export function parseDshEntryFromCommandLine(cmdline: string): DshEntry | null {
  const tokens = cmdline.split(/\s+/).map((s) => s.replace(/^['"]|['"]$/g, ''))
  // 1) 包内脚本形态：路径含 @deepseek-ai/dsh 段，用包内 lib/bin.js。
  for (const tok of tokens) {
    const norm = tok.replace(/\\/g, '/')
    const m = /(.*@deepseek-ai\/dsh)(\/(?:lib\/bin\.js|dist\/dsh\.js))?$/.exec(norm)
    if (m) {
      const script = m[2] ? `${m[1]}${m[2]}` : `${m[1]}/lib/bin.js`
      return { command: 'node', args: [script] }
    }
  }
  // 2) 可执行 shim 形态：含目录分隔符（有路径才能确认来源），文件名是
  //    dsh / dsh.cmd / dsh.exe / dsh.js。入口原样保留（Windows 反斜杠路径
  //    直接给 spawn 用，不做归一化）。
  for (const tok of tokens) {
    const norm = tok.replace(/\\/g, '/')
    if (norm.includes('/') && /(^|\/)(dsh|dsh\.cmd|dsh\.exe|dsh\.js)$/i.test(norm)) {
      if (/\.js$/i.test(norm)) return { command: 'node', args: [norm] }
      return { command: tok, args: [] }
    }
  }
  return null
}
