/**
 * dsh 安装引导（非官方脚本）的共享纯数据：平台探测 + 各平台一键命令。
 * host 端（Node 进程）与两个 webview（浏览器环境）共用，不 import 任何
 * VS Code/浏览器 API。命令指向 dsh-one 仓库 install/ 目录下的脚本——
 * 这些脚本由 dsh-one 维护，不属于 DeepSeek Harness 官方发布物。
 */

/** 安装脚本支持的平台（宿主 process.platform 映射后与 UI 标签共用）。 */
export type HostOs = 'windows' | 'macos' | 'linux'

/** 非官方安装脚本的托管根（GitHub raw，随 dsh-one 仓库走）。 */
export const DSH_INSTALL_SCRIPT_BASE =
  'https://raw.githubusercontent.com/imchangchang/dsh-one/main/install'

/** 官方安装文档入口（dsh 产品页；安装引导 tab 里的一条入口，不再直接跳过去）。 */
export const DSH_OFFICIAL_INSTALL_URL = 'https://www.deepseek.com/harness/'

/** 各平台的一键安装命令（kimi 同款 irm/curl 管道风格）。 */
export function installCommandFor(os: HostOs): string {
  switch (os) {
    case 'windows':
      return `irm ${DSH_INSTALL_SCRIPT_BASE}/dsh-install.ps1 | iex`
    case 'macos':
    case 'linux':
      return `curl -fsSL ${DSH_INSTALL_SCRIPT_BASE}/dsh-install.sh | bash`
  }
}

/** 安装脚本覆盖的平台顺序（UI 标签顺序；未知平台时默认第一项）。 */
export const INSTALL_SCRIPT_OS_ORDER: HostOs[] = ['windows', 'macos', 'linux']

/** 平台选择器的默认选中项：宿主平台认不出来（未知系统）就回退第一项。 */
export function installOsOrDefault(hostOs: HostOs | undefined): HostOs {
  return hostOs !== undefined && INSTALL_SCRIPT_OS_ORDER.includes(hostOs)
    ? hostOs
    : INSTALL_SCRIPT_OS_ORDER[0]
}

/** 平台名（不走 locale：Windows/macOS/Linux 三种写法全球通用，与 kimi 一致）。 */
export const INSTALL_SCRIPT_OS_LABEL: Record<HostOs, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
}

/** host 端：Node process.platform → HostOs；未知平台 undefined。 */
export function hostOsFromPlatform(platform: string): HostOs | undefined {
  switch (platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    default:
      return undefined
  }
}
