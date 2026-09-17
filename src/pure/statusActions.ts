/**
 * 状态栏动作清单（纯函数，无 vscode 依赖，可直接 `node --test`）。
 *
 * 一份动作表、两个渲染面：
 * - 状态栏悬停气泡（`src/pure/statusTooltip.ts`）把每行渲染成可点的 command 链接；
 * - 点击状态栏打开的动作面板（`src/extension.ts` 里的 QuickPick）把每行渲染成一个列表项。
 * 两个面的动作集合与顺序因此天然一致——加动作只改这里。
 */
import type { Translate, TooltipStatus } from './statusTooltip.ts'
import type { UpdateVerdict } from './dshUpdate.ts'

/** 动作面板 / 气泡里的一行：id 供单测与日志，icon 是 codicon 名，command 是点击执行的命令。 */
export interface StatusAction {
  id: string
  /** 已本地化的行文本。 */
  label: string
  /** codicon 名（`$(globe)` 里的 `globe`）。 */
  icon: string
  command: string
}

/**
 * 按当前状态给出动作清单，顺序即展示顺序。
 *
 * 与悬停气泡同源：运行中第一行固定是「打开浏览器」（高频），第二行是更新入口
 * （有新版本时直接是「升级到 vX」，否则是「检查更新」），其余按状态分支给管理动作。
 */
export function statusActions(
  status: TooltipStatus,
  t: Translate,
  update?: UpdateVerdict,
): StatusAction[] {
  const showLogs: StatusAction = {
    id: 'showLogs',
    label: t('Show Logs'),
    icon: 'output',
    command: 'dshOne.showLogs',
  }
  switch (status.state) {
    case 'running': {
      const actions: StatusAction[] = [
        { id: 'openExternal', label: t('Open in Browser'), icon: 'globe', command: 'dshOne.openExternal' },
      ]
      // 有新版就直接给升级入口；否则给检查入口（unknown/ahead/current 都走这条）。
      const upgradeTo = update?.state === 'update' ? update.latest : undefined
      actions.push(
        upgradeTo
          ? {
              id: 'upgrade',
              label: t('Upgrade to v{0}', upgradeTo),
              icon: 'arrow-up',
              command: 'dshOne.upgrade',
            }
          : {
              id: 'checkUpdate',
              label: t('Check for Updates'),
              icon: 'cloud-download',
              command: 'dshOne.checkUpdate',
            },
      )
      // 复制带 token 的访问链接：本机链接对任何实例都有（token 在记录/认证里）；
      // 局域网链接只在转发器真正在监听时给。
      actions.push(
        { id: 'copyLink', label: t('Copy local access link (with token)'), icon: 'link', command: 'dshOne.copyLink' },
      )
      if (status.external || status.adopted) {
        // 外部启动 / 另一窗口 spawn 的实例：动作走 external.* （确认弹窗在命令层）。
        actions.push(
          {
            id: 'external.restart',
            label: t('Restart External Instance'),
            icon: 'refresh',
            command: 'dshOne.external.restart',
          },
          {
            id: 'external.stop',
            label: t('Stop External Instance'),
            icon: 'debug-stop',
            command: 'dshOne.external.stop',
          },
        )
      } else {
        // 局域网开关只对自管实例有意义：关 → 重启成局域网可达；开 → 复制局域网
        // 链接 + 可重启回仅本机（能力来自 spawn 时的 --trusted-host，见 status.lanIp）。
        actions.push(
          status.lanIp
            ? {
                id: 'copyLanLink',
                label: t('Copy LAN access link (with token)'),
                icon: 'broadcast',
                command: 'dshOne.copyLanLink',
              }
            : {
                id: 'restartLan',
                label: t('Restart for LAN access'),
                icon: 'broadcast',
                command: 'dshOne.restartLan',
              },
        )
        actions.push(
          { id: 'restart', label: t('Restart Service'), icon: 'refresh', command: 'dshOne.restart' },
          { id: 'stop', label: t('Stop Service'), icon: 'debug-stop', command: 'dshOne.stop' },
        )
        if (status.lanIp) {
          actions.push(
            {
              id: 'restartLocal',
              label: t('Restart for local-only access'),
              icon: 'shield',
              command: 'dshOne.restartLocal',
            },
          )
        }
      }
      actions.push(showLogs)
      return actions
    }
    case 'starting':
      // 启动中原本没有可做的事；给「打开浏览器」（会等到就绪）与日志两个入口。
      return [
        { id: 'openExternal', label: t('Open in Browser'), icon: 'globe', command: 'dshOne.openExternal' },
        showLogs,
      ]
    case 'error':
      if (status.reason === 'dshNotFound') {
        return [
          {
            id: 'install',
            label: t('Install dsh'),
            icon: 'cloud-download',
            command: 'dshOne.openSessions',
          },
          showLogs,
        ]
      }
      if (status.reason === 'authDshNoToken') {
        // 认证 dsh 无 token 的防护态：给 B 档（粘贴 token）与 A 档（停/重启）入口。
        return [
          {
            id: 'external.pasteToken',
            label: t('Paste Launch Token'),
            icon: 'key',
            command: 'dshOne.external.pasteToken',
          },
          {
            id: 'external.copyTokenTemplate',
            label: t('Copy URL Template'),
            icon: 'copy',
            command: 'dshOne.external.copyTokenTemplate',
          },
          {
            id: 'external.stop',
            label: t('Stop External Instance'),
            icon: 'debug-stop',
            command: 'dshOne.external.stop',
          },
          {
            id: 'external.restart',
            label: t('Restart Service'),
            icon: 'refresh',
            command: 'dshOne.external.restart',
          },
          showLogs,
        ]
      }
      return [
        { id: 'start', label: t('Retry Starting'), icon: 'refresh', command: 'dshOne.start' },
        showLogs,
      ]
    default:
      return [
        { id: 'start', label: t('Start Service'), icon: 'play', command: 'dshOne.start' },
        showLogs,
      ]
  }
}

/**
 * 动作面板顶部的一行状态摘要（` · ` 分隔）：状态 + 地址 + 版本，有新版时补一句。
 * 气泡里不需要它（气泡自己按行写了同样的信息），面板需要——QuickPick 没有 tooltip 的标题区。
 */
export function statusSummary(
  status: TooltipStatus,
  t: Translate,
  update?: UpdateVerdict,
): string {
  const parts: string[] = []
  switch (status.state) {
    case 'running':
      parts.push(status.url ? `${t('Running')} — ${status.url}` : t('Running'))
      if (status.version && status.version !== 'unknown') parts.push(`dsh v${status.version}`)
      if (status.adopted) parts.push(t('Reused from another window'))
      if (status.external) parts.push(t('External instance'))
      if (status.lanIp) parts.push(t('LAN access is on: {0}', status.lanIp))
      else if (!status.adopted && !status.external) parts.push(t('LAN access is off'))
      break
    case 'starting':
      parts.push(t('Service is starting…'))
      break
    case 'error':
      if (status.reason === 'dshNotFound') parts.push(t('dsh is not installed'))
      else if (status.reason === 'authDshNoToken') {
        parts.push(t('Port {0} is taken by another dsh', status.port ?? '?'))
      } else parts.push(t('Service Error'))
      break
    default:
      parts.push(t('Service Stopped'))
  }
  if (update?.state === 'update' && update.latest) {
    parts.push(t('A newer dsh is available: v{0}', update.latest))
  }
  return parts.join(' · ')
}
