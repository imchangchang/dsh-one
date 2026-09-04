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
  renameSession,
  selectModel,
  sessionAttachment,
  sessionLogZipFilename,
  sessionModels,
} from '../server/dshRpc.ts'
import type { SessionModelSelection } from '../server/dshRpc.ts'
import type { FileRefCandidate } from '../pure/fileReference.ts'
import type { ChatState, CommitInfoResult, FromWebviewMessage, OutgoingImage, StagedFile, ToWebviewMessage } from '../pure/chatContract.ts'
import { looksLikeSlashCommand } from '../pure/slashCommand.ts'
import { imageMediaTypeByExtension, pastedFileName, splitAttachmentLines } from '../pure/composerAttachment.ts'
import { attachmentDir, nextSequenceIndex } from './attachmentDir.ts'
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

// ---- commit hash 联动（点击打开 git 提交视图 / 悬浮显示提交信息） ----

/** vscode.git 扩展 API 的最小形状（只取用到的字段，避免强依赖内置插件类型）。 */
interface GitCommit {
  hash: string
  message: string
  authorName: string
  authorEmail?: string
  commitDate: Date
  /** 变更统计（files/insertions/deletions）；内置 git 不保证填充，缺失时省略。 */
  shortStat?: { files?: number; insertions?: number; deletions?: number }
}
interface GitRemote {
  name: string
  fetchUrl?: string
}
interface GitRepository {
  rootUri: vscode.Uri
  getCommit(ref: string): Promise<GitCommit>
  getRemotes(): Promise<GitRemote[]>
}
interface GitApi {
  repositories: GitRepository[]
  getRepository(uri: vscode.Uri): GitRepository | undefined
}

/** 取 vscode.git 扩展的 Git API v1；不可用（未装/未激活/无 git 仓库）返回 null。 */
async function getGitApi(): Promise<GitApi | null> {
  const ext = vscode.extensions.getExtension<{ getAPI?: (version: number) => GitApi }>('vscode.git')
  if (!ext) return null
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate()
    return exports?.getAPI?.(1) ?? null
  } catch {
    return null
  }
}

/** 多仓库时「激活仓库优先」：取附着会话 cwd 所在仓库，退化到活动编辑器所在仓库。 */
function preferredRepository(api: GitApi, host: ChatTabHost): GitRepository | undefined {
  const self = host.sessionId ? host.actions.store.rawList().find((s) => s.sessionId === host.sessionId) : undefined
  if (self?.cwd) {
    const repo = api.getRepository(vscode.Uri.file(self.cwd))
    if (repo) return repo
  }
  const active = vscode.window.activeTextEditor?.document.uri
  return active ? api.getRepository(active) : undefined
}

/** 把 git Commit 投影成 webview 用的信息（subject 首行 + 完整 message + 作者 + 日期
 *  + 变更统计）。shortStat 为 git API 可选字段，缺失时省略（悬浮卡不显示统计行）；
 *  githubUrl 由 queryCommitInfo 命中后单独 await 补齐（remote 查询是异步的）。 */
function commitInfoFrom(sha: string, commit: GitCommit): CommitInfoResult {
  const fullMessage = (commit.message ?? '').trim()
  return {
    sha,
    commitHash: commit.hash ?? sha,
    found: true,
    message: fullMessage.split('\n')[0]?.trim() ?? '',
    fullMessage,
    authorName: commit.authorName ?? '',
    authorEmail: commit.authorEmail,
    commitDate: formatCommitDate(commit.commitDate),
    files: commit.shortStat?.files,
    insertions: commit.shortStat?.insertions,
    deletions: commit.shortStat?.deletions,
  }
}

/** 从仓库 remote fetchUrl 推导 GitHub commit 链接；非 GitHub 仓库返回 undefined。
 *  支持 https://github.com/owner/repo.git 与 git@github.com:owner/repo.git 两种形状。 */
async function githubCommitUrl(repo: GitRepository, sha: string): Promise<string | undefined> {
  try {
    const remotes = await repo.getRemotes()
    const url = remotes.find((r) => (r.fetchUrl ?? '').length > 0)?.fetchUrl ?? ''
    const m = url.match(/(?:https?:\/\/|git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (!m) return undefined
    return `https://github.com/${m[1]}/${m[2]}/commit/${sha}`
  } catch {
    return undefined
  }
}

/** 提交日期格式化为 ISO 完整时间戳（YYYY-MM-DDTHH:mm），悬浮卡的相对时间计算与
 *  命令行短 hash 展示都用它。只留日期会导致 webview new Date() 解析丢时区偏移，
 *  显示「N hours ago」比真实时间差几个小时（同日提交会偏到半天）。 */
function formatCommitDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

/** 逐个仓库查 sha（激活仓库优先），命中即取该仓库的提交信息；全未命中 mark found:false。 */
async function queryCommitInfo(host: ChatTabHost, shas: string[]): Promise<CommitInfoResult[]> {
  const api = await getGitApi()
  const repos = api?.repositories ?? []
  if (repos.length === 0) return shas.map((sha) => ({ sha, found: false }))
  const preferred = api ? preferredRepository(api, host) : undefined
  const ordered = preferred ? [preferred, ...repos.filter((r) => r !== preferred)] : repos
  const results: CommitInfoResult[] = []
  for (const sha of shas) {
    let hit: CommitInfoResult | null = null
    let hitRepo: GitRepository | null = null
    for (const repo of ordered) {
      try {
        const commit = await repo.getCommit(sha)
        hit = commit ? commitInfoFrom(sha, commit) : null
        hitRepo = commit ? repo : null
      } catch {
        // 该仓库无此 commit（getCommit 对不存在的 ref 抛错），试下一个
      }
      if (hit) break
    }
    if (hit && hitRepo) hit.githubUrl = await githubCommitUrl(hitRepo, hit.commitHash ?? sha)
    results.push(hit ?? { sha, found: false })
  }
  return results
}

/** 点击 commit hash：激活仓库优先查库，命中打开该提交的 diff 视图（git.viewCommit）；
 *  全未命中返回 false。曾尝试 git.openRepository 跳转 SCM history 视图，但内置 git
 *  无公开的「定位到某 commit」接口（graph reveal 是 SCM 内部命令），用户拍板回退 diff。 */
async function openCommit(host: ChatTabHost, sha: string): Promise<boolean> {
  const api = await getGitApi()
  const repos = api?.repositories ?? []
  if (repos.length === 0) return false
  const preferred = api ? preferredRepository(api, host) : undefined
  const ordered = preferred ? [preferred, ...repos.filter((r) => r !== preferred)] : repos
  for (const repo of ordered) {
    try {
      const commit = await repo.getCommit(sha)
      if (!commit) continue
      await vscode.commands.executeCommand('git.viewCommit', repo, commit.hash)
      return true
    } catch {
      // 该仓库无此 commit，试下一个
    }
  }
  return false
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

/** commit hash 联动域：正文 hash 点击打开 git 提交视图，悬浮信息查询（宿主查库，先查后亮）。 */
const commitHandlers: ChatTabMessageHandler[] = [
  {
    types: ['commitInfo'],
    async handle(host, m) {
      if (m.type !== 'commitInfo' || !Array.isArray(m.shas)) return
      const shas = m.shas.filter((s): s is string => typeof s === 'string' && /^[0-9a-fA-F]{7,40}$/.test(s))
      if (shas.length === 0) return
      const results = await queryCommitInfo(host, shas)
      host.postMessage({ type: 'commitInfo', results })
    },
  },
  {
    types: ['commitOpen'],
    async handle(host, m) {
      if (m.type !== 'commitOpen' || typeof m.sha !== 'string' || !/^[0-9a-fA-F]{7,40}$/.test(m.sha)) return
      const opened = await openCommit(host, m.sha)
      if (!opened) vscode.window.showInformationMessage(vscode.l10n.t('Commit not found'))
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
      // webview 附带的暂存附件（含图片的预览元数据）：发送失败时按原样还原 chips。
      const files = Array.isArray(m.files) ? m.files : []
      if (!text && images.length === 0) return
      // 懒切换落地（方案 C 收口）：applySendIntent 快照一次当前会话的待发送意图
      // 并依次落地（workspace → preset → permission）。workspace 失败会提示并
      // 取消发送（成功后换了 controller，后续逻辑一律用重取的 target，不用入参
      // controller）。
      if (!(await host.actions.applySendIntent(host))) return
      const target = host.controller
      if (!target) return
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
        // 走 chatTab 的「聊天操作失败」通用路径。webview 附带的 files 优先
        // （带图片预览元数据），缺失时从文本行解析兜底（预览从磁盘补读）。
        const { text: body, files: parsedFiles } = splitAttachmentLines(text)
        const restoreFiles = files.length > 0 ? files : parsedFiles
        host.postMessage({
          type: 'restoreDraft',
          text: body,
          ...(images.length > 0 ? { images } : {}),
          ...(restoreFiles.length > 0 ? { files: await withFilePreviews(restoreFiles) } : {}),
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
    // 长文本粘贴折叠：落盘到会话附件目录（pasted-N.txt），回投 filesPicked
    // 让 webview 显示 chip 并自动插 @ token；无附着会话不回投（webview 侧已
    // 在 canSend=false 时不触发折叠，不会丢文本）。
    types: ['pasteText'],
    async handle(host, m) {
      if (m.type !== 'pasteText' || typeof m.data !== 'string' || m.data.length === 0) return
      const controller = host.controller
      if (!controller) return
      try {
        const dir = attachmentDir(controller.sessionId)
        await fs.mkdir(dir, { recursive: true })
        // 原子写：wx 独占创建，冲突则序号 +1 重试（并发粘贴不互相覆盖）。
        for (let i = 0; ; i += 1) {
          const seq = await nextSequenceIndex(dir, /^pasted-(\d+)(?:-\d+)?\.txt$/i)
          const name = pastedFileName(seq + i)
          const target = path.join(dir, name)
          try {
            await fs.writeFile(target, m.data, { encoding: 'utf8', flag: 'wx' })
            host.postMessage({ type: 'filesPicked', files: [{ name, path: target }] })
            return
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
          }
        }
      } catch (err) {
        host.actions.logger.warn(`chat: pasteText failed — ${errorText(err)}`)
      }
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
      // 懒切换：只记录当前会话的 pending 并推 state（chip 显示选中项），零
      // RPC——真正 setAgentPreset 在发送时随 applySendIntent 落地（与 workspace
      // 同模式，避免选中即 RPC 打断 hero 布局/动画）。
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
      // @ 范围收窄：候选只有「当前附件（webview 本地合成）+ 会话工作区文件」，
      // 不再走 DSH 的 fileReferences/list（它扫 cwd 全树、量太大）。工作区候选
      // 这里列：cwd 下浅层文件（排除构建物），绝对路径形式（模型 @path 允许
      // 任意路径，无需 DSH 改动）；列表为空静默（弹窗只剩本地附件行）。
      const cwd = host.actions.store.rawList().find((s) => s.sessionId === controller.sessionId)?.cwd
      const items = await workspaceFileCandidates(cwd, m.query)
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
      // 懒切换目标 workspace（只记录当前会话 pending、更新 chip 显示，零 RPC
      // ——真正切换推迟到 send 的 applySendIntent 落地）。目标等于当前会话所属
      // workspace 时解释为取消。
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
    // 消息里图片文件 chip 的缩略图懒加载：读盘转 base64 回传（失败静默，
    // webview 回退成图标 chip——历史消息的文件可能已被移动/删除）。
    types: ['requestFileThumb'],
    async handle(host, m) {
      if (m.type !== 'requestFileThumb' || typeof m.path !== 'string' || !m.path) return
      const mediaType = imageMediaTypeByExtension(path.extname(m.path))
      if (!mediaType) return
      try {
        const data = await fs.readFile(m.path)
        host.postMessage({ type: 'fileThumb', path: m.path, mediaType, data: Buffer.from(data).toString('base64') })
      } catch (err) {
        host.actions.logger.warn(`chat: fileThumb ${m.path} failed — ${errorText(err)}`)
      }
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
  ...commitHandlers,
  ...sessionHandlers,
  ...chatHandlers,
  ...workspaceHandlers,
  ...goalHandlers,
  ...fileHandlers,
]

/** @ 补全的工作区候选：会话 cwd 下浅层文件（顶层 + 一层子目录）的绝对路径，
 *  排除构建物/隐藏目录，上限 200；按路径排序。cwd 缺失或不可读返回空。 */
const WORKSPACE_EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.idea', '.vscode', 'test-results',
])

async function workspaceFileCandidates(cwd: string | undefined, query: string): Promise<FileRefCandidate[]> {
  if (!cwd) return []
  const q = query.trim().toLowerCase()
  const out: FileRefCandidate[] = []
  const subdirs: string[] = []
  const addDir = async (dir: string, collectSubdirs: boolean): Promise<void> => {
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const full = path.join(dir, name)
      let stat: import('node:fs').Stats
      try {
        stat = await fs.stat(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        if (collectSubdirs && !WORKSPACE_EXCLUDED_DIRS.has(name)) subdirs.push(full)
        continue
      }
      if (stat.isFile() && (q === '' || name.toLowerCase().includes(q))) {
        out.push({ path: full, kind: 'file' })
        if (out.length >= 200) return
      }
    }
  }
  await addDir(cwd, true)
  for (const dir of subdirs) {
    await addDir(dir, false)
    if (out.length >= 200) break
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** 发送失败还原时给图片文件补缩略图预览（从磁盘读 base64）；读不到就留空回退图标 chip。 */
async function withFilePreviews(files: StagedFile[]): Promise<StagedFile[]> {
  const out: StagedFile[] = []
  for (const f of files) {
    if (!f.image || f.previewData) {
      out.push(f)
      continue
    }
    try {
      const data = await fs.readFile(f.path)
      out.push({ ...f, previewData: Buffer.from(data).toString('base64') })
    } catch {
      out.push(f)
    }
  }
  return out
}

/** Open an absolute path in the VS Code editor; failure toast names the chip kind. */
async function openFileInEditor(path: string, label: string): Promise<void> {  try {
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
 * Permission preset switch — 懒更新：只记录当前会话的 pending 并推 state
 * （pill 显示选中项），零 RPC——真正 /permission 命令在发送时随 applySendIntent
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
