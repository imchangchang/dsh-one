/**
 * Chat tab webview 消息处理（按域拆的 handler 集合）。ChatTabHost 收到本 tab
 * 的消息后按 type 分发给这里注册的 handler；每个 handler 内聚一个消息域
 * （全局动作 / 会话动作 / 后续移植 main 的 workspace、goal、文件域），新消息
 * 类型加到对应域即可，不再往 ChatViewProvider 的大 switch 里塞。
 */
import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  executeCommand,
  exportSessionLog,
  listFileReferences,
  renameSession,
  selectModel,
  sessionAttachment,
  sessionLogZipFilename,
  sessionModels,
} from '../server/dshRpc.ts'
import type { SessionModelSelection } from '../server/dshRpc.ts'
import type { FileRefCandidate } from '../pure/fileReference.ts'
import type { ChatState, FromWebviewMessage, OutgoingImage, ToWebviewMessage } from '../pure/chatContract.ts'
import { looksLikeSlashCommand } from '../pure/slashCommand.ts'
import { splitAttachmentLines } from '../pure/composerAttachment.ts'
import type { ChatSessionController } from '../server/chatSession.ts'
import type { ChatTabHost } from './chatTab.ts'

export interface ChatTabMessageHandler {
  /** 本 handler 消费的消息类型（FromWebviewMessage 的 type 字面量）。 */
  readonly types: readonly string[]
  handle(host: ChatTabHost, m: FromWebviewMessage): Promise<void>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 全局动作域：不依赖会话 controller 的消息（安装引导/外链/打开另一个会话）。
 * webview 重载的 ready 报到由 ChatTabHost 自己处理（需要推自己的 state）。
 */
const globalHandlers: ChatTabMessageHandler[] = [
  {
    types: ['openInstallPage'],
    async handle(_host, _m) {
      await vscode.commands.executeCommand('dshOne.openInstallPage')
    },
  },
  {
    types: ['openExternal'],
    async handle(host, m) {
      if (m.type !== 'openExternal' || typeof m.url !== 'string') return
      if (!/^(https?|mailto):/i.test(m.url)) return
      try {
        await vscode.env.openExternal(vscode.Uri.parse(m.url))
      } catch (err) {
        host.actions.logger.warn(`chat: openExternal(${m.url}) failed — ${errorText(err)}`)
      }
    },
  },
  {
    types: ['openInBuiltinBrowser'],
    async handle(_host, m) {
      if (m.type !== 'openInBuiltinBrowser' || typeof m.url !== 'string') return
      if (!/^(https?|mailto):/i.test(m.url)) return
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', m.url)
      } catch {
        await vscode.env.openExternal(vscode.Uri.parse(m.url))
      }
    },
  },
  {
    types: ['sessionOpen'],
    async handle(host, m) {
      if (m.type !== 'sessionOpen' || typeof m.sessionId !== 'string') return
      // 子代理下拉名称 / 会话 @ 引用 chip 点击：打开（或聚焦）该会话的 tab。
      host.actions.openSession(m.sessionId)
    },
  },
]

/**
 * 会话级动作域（chat 头部 ⋯ 菜单）：与侧栏 session 右键同款动作 —— 命令
 * （rename/archive/fork/copyReference）或 store 本地操作（pin/unread）。
 * 复用侧栏相同入口，不重复实现。
 */
const sessionHandlers: ChatTabMessageHandler[] = [
  {
    types: ['sessionRename'],
    async handle(_host, m) {
      if (m.type !== 'sessionRename' || typeof m.sessionId !== 'string') return
      await vscode.commands.executeCommand('dshOne.session.rename', m.sessionId, m.title)
    },
  },
  {
    types: ['sessionArchive'],
    async handle(_host, m) {
      if (m.type !== 'sessionArchive' || typeof m.sessionId !== 'string') return
      await vscode.commands.executeCommand('dshOne.session.archive', m.sessionId, m.title)
    },
  },
  {
    types: ['sessionFork'],
    async handle(_host, m) {
      if (m.type !== 'sessionFork' || typeof m.sessionId !== 'string') return
      await vscode.commands.executeCommand('dshOne.session.fork', m.sessionId)
    },
  },
  {
    types: ['sessionCopyReference'],
    async handle(_host, m) {
      if (m.type !== 'sessionCopyReference' || typeof m.sessionId !== 'string') return
      await vscode.commands.executeCommand('dshOne.session.copyReference', m.sessionId, m.title)
    },
  },
  {
    types: ['sessionPin'],
    async handle(host, m) {
      if (m.type !== 'sessionPin' || typeof m.sessionId !== 'string') return
      host.actions.store.setPinned(m.sessionId, m.pin === true)
    },
  },
  {
    types: ['sessionUnread'],
    async handle(host, m) {
      if (m.type !== 'sessionUnread' || typeof m.sessionId !== 'string') return
      host.actions.store.setUnread(m.sessionId, m.unread === true)
    },
  },
]

/** 会话动作域：都落在本 tab 的 controller 上。 */
const chatHandlers: ChatTabMessageHandler[] = [
  {
    types: ['send'],
    async handle(host, m) {
      if (m.type !== 'send') return
      const controller = host.controller
      if (!controller) return
      const text = typeof m.text === 'string' ? m.text.trim() : ''
      const images = Array.isArray(m.images) ? m.images : []
      if (!text && images.length === 0) return
      // 懒切换落地：把消息发到 pending 目标 workspace 的会话（resolve 会换
      // controller，后续逻辑一律用重取的 target，不用入参 controller）。
      if (!(await host.actions.resolvePendingWorkspace(host))) return
      const target = host.controller
      if (!target) return
      // 懒切换落地：pending 的 preset 与权限模式在此真正生效（同 workspace：
      // 只记显示、发送时执行，避免预先 RPC 打断 hero/消息流布局）。
      await host.actions.resolvePendingPreset(host)
      await host.actions.resolvePendingPermission(host)
      // Slash commands route to runCommand; pasted absolute paths like
      // /Users/… are prompts for the model, not commands.
      if (looksLikeSlashCommand(text)) {
        await runCommand(host, text, images)
        return
      }
      try {
        await target.send(text, images, m.steer === true)
      } catch (err) {
        // 发送失败（模型不支持图片、服务重启等）：把消息原样还回 composer，
        // 不让输入被吞。文件行还原成 chips（与发送前状态一致），错误通知继续
        // 走 chatTab 的「聊天操作失败」通用路径。
        const { text: body, files } = splitAttachmentLines(text)
        host.postMessage({
          type: 'restoreDraft',
          text: body,
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        })
        throw err
      }
    },
  },
  {
    types: ['stop'],
    async handle(host, m) {
      if (m.type !== 'stop') return
      const controller = host.controller
      if (!controller) return
      const restored = await controller.stop()
      if (restored.length > 0) {
        host.postMessage({ type: 'restoreDraft', text: restored.join('\n') })
      }
    },
  },
  {
    types: ['approval'],
    async handle(host, m) {
      if (m.type !== 'approval') return
      await host.controller?.respondApproval(m.rpcId, m.outcome)
    },
  },
  {
    types: ['answer'],
    async handle(host, m) {
      if (m.type !== 'answer') return
      await host.controller?.answerQuestion(m.rpcId, m.answers)
    },
  },
  {
    types: ['pickFiles'],
    async handle(host, _m) {
      await host.pickFiles()
    },
  },
  {
    types: ['filesPasted'],
    async handle(host, m) {
      if (m.type !== 'filesPasted') return
      await host.stagePastedFiles(Array.isArray(m.files) ? m.files : [])
    },
  },
  {
    types: ['requestModels'],
    async handle(host, _m) {
      await sendModelCatalog(host)
    },
  },
  {
    types: ['setModel'],
    async handle(host, m) {
      if (m.type !== 'setModel') return
      await applyModelSelection(host, {
        provider: m.provider,
        model: m.model,
        reasoningEffort: m.reasoningEffort,
      })
    },
  },
  {
    types: ['setPermission'],
    async handle(host, m) {
      if (m.type !== 'setPermission') return
      await setPermission(host, m.value)
    },
  },
  {
    types: ['setAgentPreset'],
    async handle(host, m) {
      if (m.type !== 'setAgentPreset') return
      // 懒切换：只记录 pending 并推 state（chip 显示选中项），零 RPC——真正
      // setAgentPreset 在发送时随 resolvePendingPreset 落地（与 workspace 同
      // 模式，避免选中即 RPC 打断 hero 布局/动画）。
      host.actions.setPendingPreset(host, m.id)
    },
  },
  {
    types: ['renameSession'],
    async handle(host, m) {
      if (m.type !== 'renameSession') return
      await renameCurrentSession(host, m.title)
    },
  },
  {
    types: ['fileRefList'],
    async handle(host, m) {
      if (m.type !== 'fileRefList') return
      const controller = host.controller
      if (!controller) return
      // @ 补全候选：失败静默降级为空列表（对齐 web——这个领域失败只是
      // 少出候选，不弹错误打断输入）。
      let items: FileRefCandidate[] = []
      try {
        items = await listFileReferences(controller.url, controller.sessionId, m.query)
      } catch (err) {
        host.actions.logger.warn(
          `chat: fileRefList(${JSON.stringify(m.query)}) failed — ${errorText(err)}`,
        )
      }
      host.postMessage({ type: 'fileRefList', requestId: m.requestId, items })
    },
  },
  {
    types: ['queueEdit', 'queueSteer', 'queueRemove'],
    async handle(host, m) {
      const controller = host.controller
      if (!controller) return
      switch (m.type) {
        case 'queueEdit':
          await controller.editQueued(m.itemId, m.text)
          return
        case 'queueSteer':
          await controller.steerQueued(m.itemId)
          return
        case 'queueRemove':
          await controller.removeQueued(m.itemId)
          return
      }
    },
  },
  {
    types: ['unsteer'],
    async handle(host, m) {
      if (m.type !== 'unsteer') return
      const controller = host.controller
      if (!controller) return
      // 撤销等待插话：移除该 steering 项并把它（含附件）回填 composer。
      // 项已不存在（刚落地）时 unsteer 返回 null，无可回填内容，静默即可。
      const restored = await controller.unsteer(m.itemId)
      if (!restored) return
      host.postMessage({
        type: 'restoreDraft',
        text: restored.text,
        ...(restored.images.length > 0 ? { images: restored.images } : {}),
        ...(restored.files.length > 0 ? { files: restored.files } : {}),
      })
    },
  },
  {
    types: ['requestAttachment'],
    async handle(host, m) {
      if (m.type !== 'requestAttachment') return
      await sendAttachment(host, m.attachmentId)
    },
  },
  {
    types: ['feedback'],
    async handle(host, m) {
      if (m.type !== 'feedback') return
      await host.controller?.rateMessage(m.messageId, m.rating)
    },
  },
  {
    types: ['fork'],
    async handle(host, m) {
      if (m.type !== 'fork') return
      const controller = host.controller
      if (!controller) return
      await forkAt(host, controller, m.atSeq)
    },
  },
  {
    types: ['loadEarlier'],
    async handle(host, _m) {
      await host.controller?.loadEarlier()
    },
  },
]

/** 空会话 hero 的 workspace 选择器域（main 功能移植，按 tab 路由）。 */
const workspaceHandlers: ChatTabMessageHandler[] = [
  {
    types: ['workspacePick'],
    async handle(host, m) {
      if (m.type !== 'workspacePick') return
      // 懒切换到目标 workspace（只记录、更新 chip 显示，零 RPC——真正切换
      // 推迟到 send/setAgentPreset 的 resolvePendingWorkspace）。目标等于当前
      // 会话所属 workspace 时解释为取消。
      host.actions.setPendingWorkspace(host, m.workspaceId)
    },
  },
  {
    types: ['workspacePickAdd'],
    async handle(host, _m) {
      await host.actions.addWorkspaceAndOpen(host)
    },
  },
  {
    types: ['workspacePickCreate'],
    async handle(host, _m) {
      await host.actions.createWorkspaceAndOpen(host)
    },
  },
]

/** goal 条幅域：对齐官方 GoalBar 的操作（控制器即会话，goal/* RPC）。 */
const goalHandlers: ChatTabMessageHandler[] = [
  {
    types: ['goalPause'],
    async handle(host, _m) {
      await host.controller?.goalPause()
    },
  },
  {
    types: ['goalResume'],
    async handle(host, _m) {
      await host.controller?.goalResume()
    },
  },
  {
    types: ['goalEdit'],
    async handle(host, m) {
      if (m.type !== 'goalEdit') return
      await host.controller?.goalEdit(m.objective)
    },
  },
  {
    types: ['goalClear'],
    async handle(host, _m) {
      await host.controller?.goalClear()
    },
  },
]

/** 产物/附件文件域：文件 chip 点击在 VS Code 编辑器打开（任意绝对路径）。 */
const fileHandlers: ChatTabMessageHandler[] = [
  {
    types: ['producedOpenFile'],
    async handle(_host, m) {
      if (m.type !== 'producedOpenFile' || typeof m.path !== 'string' || !m.path) return
      await openFileInEditor(m.path, vscode.l10n.t('produced file'))
    },
  },
  {
    types: ['openAttachmentFile'],
    async handle(_host, m) {
      if (m.type !== 'openAttachmentFile' || typeof m.path !== 'string' || !m.path) return
      await openFileInEditor(m.path, vscode.l10n.t('attachment file'))
    },
  },
  {
    types: ['openPath'],
    async handle(host, m) {
      if (m.type !== 'openPath' || typeof m.path !== 'string' || !m.path) return
      const label = vscode.l10n.t('linked file')
      const target = await resolveLinkPath(host, m.path)
      if (!target) {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Failed to resolve the path in the link: {0}', m.path),
        )
        return
      }
      const stat = await fs.stat(target).catch(() => null)
      if (!stat) {
        await openFileInEditor(target, label)
        return
      }
      // 链接指向目录：编辑器不进目录（showTextDocument 会失败），改用系统
      // 资源管理器定位；命令不可用时退回错误提示。
      if (stat.isDirectory()) {
        try {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target))
        } catch (err) {
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to open {0}: {1}', label, errorText(err)))
        }
        return
      }
      await openFileInEditor(target, label)
    },
  },
]

/** 全部 handler：ChatTabHost 按消息 type 分发。 */
export const chatMessageHandlers: ChatTabMessageHandler[] = [
  ...globalHandlers,
  ...sessionHandlers,
  ...chatHandlers,
  ...workspaceHandlers,
  ...goalHandlers,
  ...fileHandlers,
]

/** Open an absolute path in the VS Code editor; failure toast names the chip kind. */
async function openFileInEditor(path: string, label: string): Promise<void> {
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(path))
    return
  } catch (err) {
    // 产物/附件路径都是某个时刻的路径快照：文件可能后来被移动/删除（如
    // backlog git mv），报错时先区分「已不存在」并说明原因，避免只有干巴巴
    // 的「无法打开」而不知道发生了什么。
    const missing = await fs.access(path).then(
      () => false,
      () => true,
    )
    if (missing) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('{0} no longer exists (it may have been moved or deleted): {1}', label, path),
      )
      return
    }
    // 文件在但编辑器打不开（二进制/无文本编辑器，如 .xlsx/.pdf）：退化到系统
    // 默认应用打开（openExternal 对 file: URI 即「用系统默认程序打开」）。
    try {
      await vscode.env.openExternal(vscode.Uri.file(path))
    } catch (fallbackErr) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to open {0}: {1}', label, errorText(fallbackErr)),
      )
    }
  }
}

/**
 * 把对话链接里的 href 归一化成绝对路径：file: URI / 绝对路径 / ~ 原样处理；
 * 相对路径先按附着会话 cwd 解析（链接通常相对模型干活时的目录），再兜底当前
 * 工作区根目录；多个候选里取第一个真实存在的。全都不存在时返回第一个候选
 * （让 openFileInEditor 的「已不存在」报错带上正确路径）；无法解析（相对路径
 * 且没有基准）返回 null。
 */
async function resolveLinkPath(host: ChatTabHost, raw: string): Promise<string | null> {
  let href = raw
  try {
    href = decodeURIComponent(raw)
  } catch {
    // 保留原样：非法 % 序列（例如文件名本身带 %）不是编码错误，就是字面量
  }
  if (/^file:/i.test(href)) {
    try {
      return vscode.Uri.parse(href).fsPath
    } catch (err) {
      host.actions.logger.warn(`chat: openPath file: URI 解析失败 — ${errorText(err)}`)
      return null
    }
  }
  if (href === '~' || href.startsWith('~/') || href.startsWith('~\\')) {
    return path.join(os.homedir(), href.slice(1).replace(/^[\\/]/, ''))
  }
  if (path.isAbsolute(href) || /^[a-z]:[\\/]/i.test(href)) return href
  const bases: string[] = []
  const self = host.sessionId
    ? host.actions.store.rawList().find((s) => s.sessionId === host.sessionId)
    : undefined
  if (self?.cwd) bases.push(self.cwd)
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (root) bases.push(root)
  for (const base of bases) {
    const candidate = path.resolve(base, href)
    if (await fs.access(candidate).then(() => true, () => false)) return candidate
  }
  return bases.length > 0 ? path.resolve(bases[0], href) : null
}

// ---- 会话动作的辅助实现（原 ChatViewProvider 的私有方法，按 tab 参数化） ----

/** Fetch the session's model catalog and push it to the tab's model menu. */
async function sendModelCatalog(host: ChatTabHost): Promise<void> {
  const controller = host.controller
  if (!controller) return
  try {
    const models = await sessionModels(controller.url, controller.sessionId)
    const message: ToWebviewMessage = {
      type: 'modelCatalog',
      catalog: {
        current: models.current,
        groups: models.groups.map((g) => ({
          id: g.id,
          name: g.name,
          models: g.models.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            efforts: m.reasoning?.efforts ?? [],
            defaultEffort: m.reasoning?.defaultEffort,
          })),
        })),
      },
    }
    host.postMessage(message)
  } catch (err) {
    const detail = errorText(err)
    host.actions.logger.warn(`chat: session.models failed — ${detail}`)
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to fetch model list: {0}', detail))
  }
}

/** Fetch one attachment's bytes and push them to the tab for inline rendering. */
async function sendAttachment(host: ChatTabHost, attachmentId: string): Promise<void> {
  const controller = host.controller
  if (typeof attachmentId !== 'string' || !attachmentId || !controller) return
  try {
    const { mediaType, data } = await sessionAttachment(controller.url, controller.sessionId, attachmentId)
    host.postMessage({ type: 'attachmentData', attachmentId, mediaType, data })
  } catch (err) {
    // Thumbnail stays a placeholder; not worth an error popup.
    host.actions.logger.warn(`chat: attachment ${attachmentId} fetch failed — ${errorText(err)}`)
  }
}

async function applyModelSelection(host: ChatTabHost, selection: SessionModelSelection): Promise<void> {
  const controller = host.controller
  if (!controller) return
  try {
    await selectModel(controller.url, controller.sessionId, selection)
    // 切模型后立即重算 contextBar 的窗口：用新模型窗口覆写 contextPressure，
    // 不等下一条消息（否则会停留在旧模型窗口直到发消息）。
    controller.applyModelSwitch(selection)
    await controller.refreshModels()
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to switch model: {0}', detail))
  }
}

/**
 * Permission preset switch — 懒更新：只记录 pending 并推 state（pill 显示
 * 选中项），零 RPC——真正 /permission 命令在发送时随 resolvePendingPermission
 * 落地，避免命令节点进消息流把空态 hero 变成消息流 tab。`danger-full-access`
 * 保留显式风险确认（确认后仍只记录 pending，执行推迟到发送）。
 */
async function setPermission(host: ChatTabHost, value: string): Promise<void> {
  if (value === 'danger-full-access') {
    const confirm = await vscode.window.showWarningMessage(
      vscode.l10n.t('Enable Full access? Full access reduces confirmation steps and lets the agent perform more operations directly, including sensitive operations, file modifications, or external commands. Only use it when you trust the current task.'),
      { modal: true },
      vscode.l10n.t('Enable Full access'),
    )
    if (!confirm) return
  }
  host.actions.setPendingPermission(host, value)
}

/**
 * Execute one slash-command line. Matched commands need no local echo: the
 * host logs command/run before the handler and command/done after it, and
 * those events render as flow nodes in the message stream (same as the
 * official web client). Only an unmatched line — which logs nothing
 * host-side — gets a composer notice here.
 */
async function runCommand(host: ChatTabHost, line: string, images?: OutgoingImage[]): Promise<void> {
  const controller = host.controller
  if (!controller) return
  const outcome = await executeCommand(controller.url, controller.sessionId, line, images)
  if (!outcome.matched) {
    host.postMessage({ type: 'commandResult', text: vscode.l10n.t('Unknown or malformed command: {0}', line) })
    return
  }
  // `/export` only marks the request host-side ("Session log download
  // requested."); the bytes come from /api/session.export, which the
  // browser client hands to its download manager. Here we save via dialog.
  const name = line.trim().slice(1).split(/\s/, 1)[0]
  if (name === 'export' && outcome.kind === 'success') {
    await saveSessionLog(host, controller.url, controller.sessionId)
  }
}

/** Fetch the session-log ZIP and let the user pick where to save it. */
async function saveSessionLog(host: ChatTabHost, url: string, sessionId: string): Promise<void> {
  try {
    const zip = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Exporting session log…') },
      () => exportSessionLog(url, sessionId),
    )
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', sessionLogZipFilename(sessionId))),
      filters: { ZIP: ['zip'] },
      saveLabel: vscode.l10n.t('Save session log'),
    })
    if (!target) return
    await fs.writeFile(target.fsPath, zip)
    void vscode.window.showInformationMessage(vscode.l10n.t('Session log saved to {0}', target.fsPath))
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to export session log: {0}', detail))
  }
}

/** Fork the session at a completed turn, then open the child session in a new tab. */
async function forkAt(host: ChatTabHost, controller: ChatSessionController, atSeq: number): Promise<void> {
  try {
    const childId = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Creating forked session…') },
      () => controller.fork(atSeq),
    )
    // The tree learns about the child via this hook; the chat opens a new
    // tab for it (用户决策：fork 后新开 tab，原会话 tab 保留便于对照).
    host.actions.onSessionsChanged()
    host.actions.openSessionInNewTab(childId)
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to fork session: {0}', detail))
  }
}

/** Rename the attached session; the title projection push refreshes the header. */
async function renameCurrentSession(host: ChatTabHost, title: string): Promise<void> {
  const controller = host.controller
  const trimmed = title.trim()
  if (!controller || !trimmed) return
  try {
    await renameSession(controller.url, controller.sessionId, trimmed)
    host.actions.onSessionsChanged()
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to rename session: {0}', detail))
  }
}
