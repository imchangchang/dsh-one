/**
 * dsh「检查更新 / 升级」的纯逻辑：registry 响应解析、更新判定、升级命令行拼装。
 * 不 import vscode、不碰网络（网络与终端在 src/server/dshUpdate.ts），
 * 可直接 `node --test` 覆盖。
 *
 * 比对口径（用户拍板，见 #86）：固定比 npm 的 `latest` dist-tag。所以装了
 * alpha/next 的用户看到的会是「已是最新」或「比 latest 新」，不会被提示去装
 * 一个比手上更旧的正式版。
 */
import { compare, parse } from './semver.ts'

/** 官方 dsh 的 npm 包名。 */
export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh'

/**
 * npm 11 起默认不跑依赖的安装脚本；这几个包的脚本不跑，原生二进制就不会下载，
 * dsh 会在运行时失败。清单与 install/dsh-install.sh、install/dsh-install.ps1 保持一致
 * （那边的注释记录了同一条理由）。
 */
export const ALLOW_SCRIPTS_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-subprocess-local',
  'koffi',
  'node-pty',
  '@google/genai',
  'protobufjs',
]

/** 只有 npm 主版本 >= 这个数才需要（也只接受）`--allow-scripts`。 */
export const ALLOW_SCRIPTS_MIN_NPM_MAJOR = 11

/**
 * registry 查询地址：官方 npm 源在前、npmmirror 兜底（与安装脚本的镜像策略一致）。
 * 用 `/latest` 端点：它返回的就是 latest dist-tag 指向的那份 manifest（约 7KB），
 * 比整份 packument（约 100KB）省得多。
 */
export function registryLatestUrls(packageName: string = DSH_PACKAGE_NAME): string[] {
  return [
    `https://registry.npmjs.org/${packageName}/latest`,
    `https://registry.npmmirror.com/${packageName}/latest`,
  ]
}

/**
 * 从 registry 响应里取 latest 版本号。兼容两种形状：
 * - 单版本 manifest（`/latest` 端点）：顶层 `version`；
 * - 整份 packument（完整文档）：`dist-tags.latest`。
 * 取不到合法 semver 时返回 undefined——调用方据此报「检查失败」。
 */
export function latestFromRegistryJson(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined
  const record = json as Record<string, unknown>
  const tags = record['dist-tags']
  const fromTags =
    typeof tags === 'object' && tags !== null ? (tags as Record<string, unknown>).latest : undefined
  for (const candidate of [fromTags, record.version]) {
    if (typeof candidate === 'string' && parse(candidate.trim())) return candidate.trim()
  }
  return undefined
}

/** 更新判定四态。 */
export type UpdateState = 'update' | 'current' | 'ahead' | 'unknown'

export interface UpdateVerdict {
  state: UpdateState
  /** 当前安装的 dsh 版本（`dsh --version` 的结果）。 */
  installed?: string
  /** npm latest 指向的版本。 */
  latest?: string
}

/**
 * 判定「当前装的版本」与「npm latest」的关系：
 * - `update`：latest 更新，该提示升级；
 * - `current`：两边持平；
 * - `ahead`：当前版本比 latest 新（装了 alpha/next 这类预发布）；
 * - `unknown`：任一侧缺版本或解析不出——调用方必须报「检查失败」，
 *   绝不能当成「已是最新」（网络失败报「最新」是最容易误导人的错法）。
 */
export function decideUpdate(installed?: string, latest?: string): UpdateVerdict {
  if (!installed || !latest || !parse(installed) || !parse(latest)) {
    return { state: 'unknown', installed, latest }
  }
  const order = compare(installed, latest)
  if (order < 0) return { state: 'update', installed, latest }
  if (order === 0) return { state: 'current', installed, latest }
  return { state: 'ahead', installed, latest }
}

/** npm `--version` 输出 → 主版本号；解析不出返回 undefined。 */
export function npmMajorFromVersion(text: string): number | undefined {
  const match = /(\d+)(?:\.\d+)*/.exec(text.trim())
  return match ? Number(match[1]) : undefined
}

/**
 * 推导升级该用哪个 npm（纯路径运算；「文件在不在」由 server 侧用 fs 判定）：
 * - `dsh` 命中 PATH（裸命令）：用 PATH 上的 npm；
 * - dsh 是可执行 shim（含目录）：优先它同目录的 npm——便携 Node
 *   （`~/.dsh/node-<平台>-<架构>/bin/dsh` 与 Windows 的 `%USERPROFILE%\.dsh\node-x64\dsh.cmd`）
 *   与系统/nvm 安装都是「npm 和 dsh 同一个目录」这个布局；
 * - dsh 是包内脚本（`node .../lib/bin.js`）：同目录没有 npm，退回 PATH。
 */
export function npmCommandCandidates(
  dshCommand: string,
  platform: string = process.platform,
): string[] {
  const npmName = platform === 'win32' ? 'npm.cmd' : 'npm'
  const normalized = dshCommand.replace(/\\/g, '/')
  if (/\.(js|cjs|mjs)$/i.test(normalized)) return ['npm']
  const slash = normalized.lastIndexOf('/')
  if (slash < 0) return ['npm']
  return [`${normalized.slice(0, slash)}/${npmName}`, 'npm']
}

/**
 * 升级用的 npm 参数：固定装 latest（与检查口径一致）；已知具体版本时装那个版本，
 * 免得用户看到「升级到 vX」实际装了别的版本。npm 11+ 需要带 `--allow-scripts`，
 * 否则原生二进制缺失（清单见上）。
 */
export function upgradeArgs(latest?: string, npmMajor?: number): string[] {
  const target = latest ? `${DSH_PACKAGE_NAME}@${latest}` : `${DSH_PACKAGE_NAME}@latest`
  const args = ['install', '-g', target]
  if (npmMajor !== undefined && npmMajor >= ALLOW_SCRIPTS_MIN_NPM_MAJOR) {
    args.push(`--allow-scripts=${ALLOW_SCRIPTS_PACKAGES.join(',')}`)
  }
  return args
}

/**
 * 单个 token 的 shell 引用：只有安全字符原样输出，其余用双引号包起来
 * （现实里只有带空格的路径会走到这里；路径里再嵌引号属于病态输入，不为此
 * 引入平台分支——Windows 侧由调用方在整行前加 `&`）。
 */
function quoteForShell(token: string): string {
  if (/^[A-Za-z0-9@/._:=+,-]+$/.test(token)) return token
  return `"${token.replace(/(["\\$`])/g, '\\$1')}"`
}

/** 把可执行文件与参数拼成终端里可直接执行的一行。 */
export function commandLine(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteForShell).join(' ')
}
