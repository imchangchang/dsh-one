/**
 * 对话框（分组新建/重命名/删除、工作区与会话重命名、删除工作区、标签组新建/删除）。
 *
 * #127：七个弹窗整套取**紧凑档**，与侧栏同一密度（档位表与每处的取值出处写在
 * `styles.ts` 的 `.dshOneTree_modal` 那一节）。为此官方 `Modal` 走它的 `headless`
 * prop——官方件在这一版**没有尺寸变体**（举证见 styles.ts 那一段），`headless` 是它
 * 给的官方口子：mask / Esc / portal / `role="dialog"` 仍由官方代码提供，标题行、
 * 说明行与底部按钮行由本件按紧凑档拼（`modalHead` / `modalDesc` / `modalActions`）。
 *
 * #139：「管理分组…」多了一层——点分组名进它的**成员清单**（全部工作区 + 勾选），
 * 详见 {@link ManageGroupsModal}。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconChevronLeftOutline14,
  IconCloseFill14,
  IconEditOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionBlock } from '../../../../pure/workspaceTreeView.ts'
import type { WorkspaceGroupDef } from '../../../../pure/treeGroups.ts'
import { TAG_COLORS, type TagColor } from '../../../../pure/sessionTags.ts'
import { displayTitle } from './format.ts'
import { SelectMark } from './selection.ts'
import { TAG_COLOR_CSS, TAG_COLOR_LABEL } from './tagGroups.ts'
import type { Translate } from './types.ts'

/** 弹窗容器的自有类名（挂在官方 Modal 的 dialog 元素上，几何见 styles.ts 那一节）。 */
const MODAL_CLASS = 'dshOneTree_modal'

/** 头行：标题 + 关闭钮。官方 Modal 在 `headless` 下不再渲染这两件，由这里按紧凑档拼。
 *  `leading` 是标题左边的可选件（成员清单的「返回分组列表」落在这一格）。 */
function modalHead(title: string, closeLabel: string, onClose: () => void, leading?: unknown): unknown {
  return h(
    'div',
    { className: 'dshOneTree_modalHead' },
    leading ?? null,
    h('h2', { className: 'dshOneTree_modalTitle' }, title),
    h(
      'button',
      { type: 'button', className: 'dshOneTree_modalClose', 'aria-label': closeLabel, onClick: onClose },
      h(IconCloseFill14, {}),
    ),
  )
}

/** 说明行（原来走官方 Modal 的 `description`）。 */
const modalDesc = (text: string): unknown => h('div', { className: 'dshOneTree_modalDesc' }, text)

/** 底部按钮行（原来走官方 Modal 的 `footer`）；按钮一律取官方 Button 的 `sm` 档。 */
const modalActions = (...children: unknown[]): unknown => h('div', { className: 'dshOneTree_modalActions' }, ...children)

/**
 * 分组对话框（新建 / 重命名 / 删除确认）——官方 Modal + Button + 圆形输入框，
 * 与工作区/会话重命名同款外形。名称的「空/重名」在纯模块里判定（`treeGroups`），
 * 这里只把判定结果翻成文案，不做第二套校验。
 */
export function GroupModal({
  dialog,
  groups,
  tr,
  error,
  onSubmit,
  onClose,
}: {
  dialog: { kind: 'create' } | { kind: 'rename'; id: string; name: string } | { kind: 'delete'; id: string; name: string } | null
  groups: readonly WorkspaceGroupDef[]
  tr: Translate
  error: string | null
  onSubmit: (value: string) => void
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const open = dialog !== null
  const kind = dialog?.kind ?? 'create'
  const initialName = dialog === null || dialog.kind === 'create' ? '' : dialog.name
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft(initialName)
      setBusy(false)
    }
    lastOpen.current = open
  }, [open, initialName])
  const submit = (): void => {
    if (busy) return
    setBusy(true)
    onSubmit(draft.trim())
  }
  // 名称冲突就地判定（与提交走同一份纯函数，不会出现「界面放过、落盘被拒」）。
  const nameError = ((): string | null => {
    if (kind === 'delete') return null
    const trimmed = draft.trim()
    if (trimmed === '') return tr('group.name.empty')
    if (groups.some((g) => g.id !== (dialog?.kind === 'rename' ? dialog.id : '') && g.name === trimmed)) return tr('group.name.duplicate')
    return null
  })()
  if (kind === 'delete') {
    return h(Modal, {
      open,
      onClose,
      title: tr('group.delete'),
      className: MODAL_CLASS,
      headless: true,
      children: [
        modalHead(tr('group.delete'), tr('close'), onClose),
        ...(dialog === null || dialog.kind === 'create' ? [] : [modalDesc(tr('group.delete.desc', { name: dialog.name }))]),
        ...(error === null ? [] : [h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error)]),
        modalActions(
          h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
          h(
            Button,
            {
              size: 'sm',
              variant: 'outline',
              disabled: busy,
              className: 'dshOneTree_deleteAction',
              onClick: () => {
                setBusy(true)
                onSubmit('')
              },
            },
            tr('group.delete'),
          ),
        ),
      ],
    })
  }
  const title = kind === 'create' ? tr('group.new') : tr('group.rename')
  return h(Modal, {
    open,
    onClose,
    title,
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(title, tr('close'), onClose),
      h('input', {
        className: 'dshOneTree_renameInput',
        value: draft,
        'aria-label': title,
        autoFocus: true,
        disabled: busy,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        onKeyDown: (event: { key: string; preventDefault(): void }) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (nameError === null) submit()
        },
      }),
      ...(nameError === null && error === null
        ? []
        : [h('div', { className: 'dshOneTree_renameError', role: 'alert' }, nameError ?? error)]),
      modalActions(
        h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
        h(
          Button,
          { size: 'sm', variant: 'primary', disabled: busy || nameError !== null, onClick: submit },
          kind === 'create' ? tr('group.new') : tr('rename'),
        ),
      ),
    ],
  })
}

/**
 * 归档确认弹窗（#103，**可复用**）：会话行菜单的「归档会话」、回收站行菜单的
 * 「永久归档」、回收站入口的「清空」、多选操作条的「批量归档」都开这一个。
 *
 * 为什么必须确认：**归档 = 删除**（#98 A1 的两层语义）——走官方 `archiveSession` 后
 * 会话从列表里消失，我们这边没有撤销入口（官方那条「取消归档」在设置页里，是给
 * 误归档兜底的，不该被当成常规还原路径）。所以弹窗里写明不可恢复，并按**工作区树形**
 * 列出到底会归档谁、有多少条会被跳过（资格不合格的那些，绝不静默放行）。
 */
export function ArchiveSessionsModal({
  target,
  tr,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  /** null = 关闭；非 null 时按它渲染明细（由树层按上下文组好）。 */
  target: ArchiveRequest | null
  tr: Translate
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}): unknown {
  const total = target === null ? 0 : target.blocks.reduce((sum, block) => sum + block.sessions.length, 0)
  const title =
    target === null
      ? ''
      : target.kind === 'emptyBin'
        ? tr('archive.title.empty', { n: total })
        : total === 1
          ? tr('archive.title.one')
          : tr('archive.title.many', { n: total })
  return h(Modal, {
    open: target !== null,
    onClose,
    title,
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(title, tr('close'), onClose),
      modalDesc(tr('archive.desc')),
      ...(target === null || target.skipped === 0
        ? []
        : [
            h(
              'div',
              { className: 'dshOneTree_deleteStatus', 'data-dshone-archive-skipped': target.skipped },
              tr('archive.skipped', { n: target.skipped }),
            ),
          ]),
      h(
        'div',
        { className: 'dshOneTree_modalBlocks', 'data-dshone-archive-blocks': total },
        target === null
          ? null
          : target.blocks.map((block) =>
              h(
                'div',
                { className: 'dshOneTree_modalBlock', key: block.key, 'data-dshone-archive-block': block.key },
                h(
                  'div',
                  { className: 'dshOneTree_modalBlockLabel' },
                  block.workspaceId === undefined ? tr('group.ungrouped') : block.label,
                ),
                block.sessions.map((node) =>
                  h(
                    'div',
                    { className: 'dshOneTree_modalRow', key: node.id, 'data-dshone-archive-row': node.id },
                    displayTitle(node, tr),
                  ),
                ),
              ),
            ),
      ),
      ...(error === null ? [] : [h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error)]),
      modalActions(
        h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
        h(
          Button,
          {
            size: 'sm',
            variant: 'outline',
            disabled: busy,
            className: 'dshOneTree_deleteAction',
            onClick: onConfirm,
            // 验证套件按这个标记认「确认归档」这一枚（官方按钮类名是哈希）。
            'data-dshone-tree-action': 'archive-confirm',
          },
          busy ? tr('archive.pending') : tr('archive.confirm'),
        ),
      ),
    ],
  })
}

/** 归档请求：弹窗要展示的全部信息（树层按上下文组好）。 */
export interface ArchiveRequest {
  /** 会被归档的会话，按工作区分块（`groupSessionNodes` / `deriveRecycleGroups` 的产物）。 */
  readonly blocks: readonly SessionBlock[]
  /** 资格不合格、会被跳过的会话数（>0 时弹窗里写明）。 */
  readonly skipped: number
  /** `emptyBin` = 从回收站入口「清空」进来的（标题按整仓口径）。 */
  readonly kind: 'archive' | 'emptyBin'
}

/**
 * 新建标签组（#107）：名字输入 + 6 色色板（默认给轮换色，点一下换）。
 *
 * 名字的空/重名就地判定，与落盘走同一份纯函数（`sessionTagGroups.tagGroupNameError`），
 * 不会出现「界面放过、落盘被拒」的第二套判断。
 */
export function TagGroupCreateModal({
  open,
  tr,
  defaultColor,
  validate,
  onSubmit,
  onClose,
}: {
  open: boolean
  tr: Translate
  /** 默认色（按已有组数轮换，见 `nextTagColor`）。 */
  defaultColor: TagColor
  /** 名字校验（调用方把它接到纯函数 `sessionTagGroups.tagGroupNameError` 上）。 */
  validate: (name: string) => 'empty' | 'duplicate' | null
  onSubmit: (name: string, color: TagColor) => void
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState('')
  const [color, setColor] = useState<TagColor>(defaultColor)
  const [idle, setIdle] = useState(true)
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft('')
      setColor(defaultColor)
      setIdle(true)
    }
    lastOpen.current = open
  }, [open, defaultColor])
  const nameError = idle ? null : validate(draft)
  const blocked = idle || nameError !== null
  const submit = (): void => {
    if (draft.trim() === '' || validate(draft) !== null) return
    onSubmit(draft.trim(), color)
  }
  return h(Modal, {
    open,
    onClose,
    title: tr('tag.new'),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr('tag.new'), tr('close'), onClose),
      h('input', {
        className: 'dshOneTree_renameInput',
        'data-dshone-tree': 'tag-name-input',
        value: draft,
        'aria-label': tr('tag.name.label'),
        placeholder: tr('tag.name.label'),
        autoFocus: true,
        onChange: (event: { target: { value: string } }) => {
          setDraft(event.target.value)
          setIdle(false)
        },
        onKeyDown: (event: { key: string; preventDefault(): void }) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          submit()
        },
      }),
      // 6 色色板：一枚枚色块当按钮（官方 Button 装不下「色块」这种内容，这里按旧侧栏
      // 同一形态自绘，几何与选中态在 styles.ts 的 `dshOneTree_tagColorPick*`）。
      h(
        'div',
        { className: 'dshOneTree_tagColorPick', 'data-dshone-tree': 'tag-color-pick' },
        TAG_COLORS.map((candidate) =>
          h(
            'button',
            {
              type: 'button',
              key: candidate,
              className: `dshOneTree_tagColorPickItem${candidate === color ? ' dshOneTree_tagColorPickOn' : ''}`,
              style: { background: TAG_COLOR_CSS[candidate] },
              title: tr(TAG_COLOR_LABEL[candidate]),
              'aria-label': tr(TAG_COLOR_LABEL[candidate]),
              'aria-pressed': candidate === color,
              'data-dshone-tag-color': candidate,
              onClick: () => setColor(candidate),
            },
            candidate === color ? h(IconCheckOutline16, { size: 12 }) : null,
          ),
        ),
      ),
      ...(idle || nameError === null
        ? []
        : [
            h(
              'div',
              { className: 'dshOneTree_renameError', role: 'alert' },
              nameError === 'empty' ? tr('tag.name.empty') : tr('tag.name.duplicate'),
            ),
          ]),
      modalActions(
        h(Button, { size: 'sm', variant: 'outline', onClick: onClose }, tr('cancel')),
        h(
          Button,
          {
            size: 'sm',
            variant: 'primary',
            disabled: blocked,
            onClick: submit,
            'data-dshone-tree-action': 'tag-create-confirm',
          },
          tr('tag.new'),
        ),
      ),
    ],
  })
}

/** 删除标签组确认（#107）：组定义与归属一起消失，会话本身一条不动。 */
export function TagGroupDeleteModal({
  target,
  tr,
  onSubmit,
  onClose,
}: {
  target: { id: string; name: string } | null
  tr: Translate
  onSubmit: (id: string) => void
  onClose: () => void
}): unknown {
  return h(Modal, {
    open: target !== null,
    onClose,
    title: tr('tag.delete'),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr('tag.delete'), tr('close'), onClose),
      ...(target === null ? [] : [modalDesc(tr('tag.delete.desc', { name: target.name }))]),
      modalActions(
        h(Button, { size: 'sm', variant: 'outline', onClick: onClose }, tr('cancel')),
        h(
          Button,
          {
            size: 'sm',
            variant: 'outline',
            className: 'dshOneTree_deleteAction',
            'data-dshone-tree-action': 'tag-delete-confirm',
            onClick: () => {
              if (target !== null) onSubmit(target.id)
            },
          },
          tr('tag.delete'),
        ),
      ),
    ],
  })
}

/** 重命名对话框（官方同款 Modal + Button + 圆形输入框）。 */
export function RenameModal({
  open,
  titleKey,
  fieldKey,
  initial,
  tr,
  onSubmit,
  onClose,
}: {
  open: boolean
  titleKey: string
  fieldKey: string
  initial: string
  tr: Translate
  onSubmit: (value: string) => Promise<void>
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft(initial)
      setError(null)
      setBusy(false)
    }
    lastOpen.current = open
  }, [open, initial])
  const commit = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    onSubmit(draft.trim())
      .then(() => {
        setBusy(false)
        onClose()
      })
      .catch((reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }
  return h(Modal, {
    open,
    onClose,
    title: tr(titleKey),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr(titleKey), tr('close'), onClose),
      h('input', {
        className: 'dshOneTree_renameInput',
        value: draft,
        'aria-label': tr(fieldKey),
        autoFocus: true,
        disabled: busy,
        onChange: (e: { target: { value: string } }) => {
          setDraft(e.target.value)
          setError(null)
        },
        onKeyDown: (e: { key: string; preventDefault(): void }) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        },
      }),
      ...(error === null ? [] : [h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error)]),
      modalActions(
        h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
        h(
          Button,
          { size: 'sm', variant: 'primary', disabled: busy || draft.trim() === '', onClick: commit },
          tr('rename'),
        ),
      ),
    ],
  })
}

/** 删除工作区确认对话框（官方同款，只是动作走官方 workspaces.delete）。 */
export function DeleteWorkspaceModal({
  target,
  tr,
  onSubmit,
  onClose,
}: {
  target: { workspaceId: string; title: string } | null
  tr: Translate
  onSubmit: (workspaceId: string) => Promise<void>
  onClose: () => void
}): unknown {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const commit = (): void => {
    if (busy || target === null) return
    setBusy(true)
    setError(null)
    onSubmit(target.workspaceId)
      .then(() => {
        setBusy(false)
        onClose()
      })
      .catch((reason: unknown) => {
        setBusy(false)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
  }
  return h(Modal, {
    open: target !== null,
    onClose,
    title: tr('delete.workspace'),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr('delete.workspace'), tr('close'), onClose),
      ...(target === null ? [] : [modalDesc(tr('delete.desc', { name: target.title }))]),
      ...(busy ? [h('div', { className: 'dshOneTree_deleteStatus', role: 'status' }, tr('delete.pending'))] : []),
      ...(error === null ? [] : [h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error)]),
      modalActions(
        h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
        h(
          Button,
          { size: 'sm', variant: 'outline', disabled: busy, onClick: commit, className: 'dshOneTree_deleteAction' },
          tr('delete.workspace'),
        ),
      ),
    ],
  })
}

/**
 * 「管理分组…」对话框（#99 B 段，单胶囊下拉里的一项）：列出全部分组（名字 + 成员
 * 工作区计数 + 改名 / 删除两枚行内图标），底部一行直接建新组。
 *
 * 为什么不就地做行内改名输入：改名与删除的校核（空名 / 重名）已经有一套就地判定的
 * 对话框（{@link GroupModal}，与落盘走同一份纯函数）。管理对话框只负责「列出来 +
 * 把动作转给那一套」，避免长出第二份校验——行内 ✎/🗑 因此是「关掉本框、开那个框」。
 * 建新组则直接内联（只多一个名字输入，校核仍是同一份 `createTreeGroup`）。
 *
 * ## #139：两级形态（点分组名 → 该组的成员清单）
 *
 * 用户点名要对齐 **Telegram 的聊天文件夹**：在文件夹管理界面里**直接就能把现有对话
 * 挑进这个文件夹**。所以我们这里也分两级——第一级是分组列表（上面那些），**点分组名**
 * 进第二级：该组的**成员清单**，列出**全部工作区**（顺序沿用树里的官方顺序，由树层
 * 组好传进来）、每行一枚勾选件（复用会话多选态的 {@link SelectMark}），点一下即时
 * 入组 / 出组；顶部一行是搜索框 + 「全选 / 清空」，头行最左是返回分组列表的入口。
 *
 * 三处刻意的取舍（与 issue #139 的「明确的取舍」一致）：
 * - **不做 Telegram 的「排除的聊天」那一段**：那一段是为「按类别自动纳入」服务的，
 *   而我们这里是手工逐一勾选、且归属多对多——勾选本身就覆盖了排除的语义。
 * - **不做拖拽**：拖拽那条路径已经有了（pill 拖拽换组序、会话行拖进组块），本层只加
 *   管理界面里的勾选路径。
 * - **「全选 / 清空」的作用域 = 当前过滤结果**（不是全部工作区）：搜索框在场时，用户
 *   眼前就是那几个工作区，批量动作只收拾看得见的那些才与「所见即所得」一致；要看全
 *   部就先清空搜索框（那时过滤结果 = 全部）。这条口径写在按钮的渲染位置这里，验证
 *   套件按同一口径断言。
 *
 * 写路径**只有一条**：勾选与批量都回到树层那一个纯函数（`toggleWorkspaceGroup`）
 * 与那一个落盘口（`writeGroups`），本件自己不碰分组状态、也不做第二份成员判定
 * （每行的勾选态由 `groupMembers` 给，它读的就是过滤 / 计数用的同一个判定）。
 */
export function ManageGroupsModal({
  open,
  groups,
  counts,
  workspaces,
  groupMembers,
  tr,
  onCreate,
  onRename,
  onDelete,
  onToggleMember,
  onSetMembers,
  onClose,
}: {
  open: boolean
  groups: readonly WorkspaceGroupDef[]
  /** 每个分组的成员工作区数（组 id → 计数）。 */
  counts: ReadonlyMap<string, number>
  /** 全部工作区（树里的官方顺序），成员清单按它逐行列。 */
  workspaces: readonly { id: string; label: string }[]
  /** 某组当前的成员工作区 id（与过滤 / 计数同一份判定）。 */
  groupMembers: (groupId: string) => readonly string[]
  tr: Translate
  /** 建新组：成功回 null，失败回词典键（'group.name.empty' / 'group.name.duplicate'）。 */
  onCreate: (name: string) => 'empty' | 'duplicate' | null
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string, name: string) => void
  /** 勾选 / 取消勾选一个工作区的归属（走树层同一个纯函数与同一个落盘口；**组在前**）。 */
  onToggleMember: (groupId: string, workspaceId: string) => void
  /** 批量勾选 / 取消（「全选 / 清空」，作用域 = 调用方给的这一批）。 */
  onSetMembers: (groupId: string, workspaceIds: readonly string[], member: boolean) => void
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** 正在看哪一组的成员清单（null = 分组列表）。 */
  const [memberGroupId, setMemberGroupId] = useState<string | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft('')
      setError(null)
      setMemberGroupId(null)
      setMemberQuery('')
    }
    lastOpen.current = open
  }, [open])
  // 正在看的那一组被删掉（或换了一份状态）时收回列表层：成员清单没有「没有这一组」的形态。
  const memberGroup = memberGroupId === null ? null : (groups.find((group) => group.id === memberGroupId) ?? null)
  useEffect(() => {
    if (memberGroupId !== null && memberGroup === null) setMemberGroupId(null)
  }, [memberGroupId, memberGroup])
  const submit = (): void => {
    const failure = onCreate(draft.trim())
    if (failure === null) {
      setDraft('')
      setError(null)
      return
    }
    setError(failure === 'empty' ? tr('group.name.empty') : tr('group.name.duplicate'))
  }
  const rowIcon = (groupId: string, name: string, action: 'rename' | 'delete'): unknown =>
    h(
      'button',
      {
        type: 'button',
        className: 'dshOneTree_rowIconButton',
        'aria-label': action === 'rename' ? tr('group.rename') : tr('group.delete'),
        'data-dshone-tree-action': `group-${action}`,
        'data-dshone-group-target': groupId,
        onClick: () => (action === 'rename' ? onRename(groupId, name) : onDelete(groupId, name)),
      },
      action === 'rename' ? h(IconEditOutline16, {}) : h(IconTrashOutline16, {}),
    )
  if (memberGroup !== null) {
    const memberIds = new Set(groupMembers(memberGroup.id))
    const query = memberQuery.trim().toLowerCase()
    // 「当前过滤结果」：搜索框空的时侯它就是全部工作区，所以「全选 / 清空」不必分两套。
    const rows = workspaces.filter((workspace) => query === '' || workspace.label.toLowerCase().includes(query))
    const selected = rows.filter((row) => memberIds.has(row.id))
    const setMembers = (member: boolean): void =>
      onSetMembers(
        memberGroup.id,
        rows.map((row) => row.id),
        member,
      )
    return h(Modal, {
      open,
      onClose,
      title: memberGroup.name,
      className: MODAL_CLASS,
      headless: true,
      children: [
        modalHead(
          memberGroup.name,
          tr('close'),
          onClose,
          h(
            'button',
            {
              type: 'button',
              className: 'dshOneTree_modalBack',
              'aria-label': tr('group.members.back'),
              title: tr('group.members.back'),
              'data-dshone-tree-action': 'group-members-back',
              onClick: () => {
                setMemberGroupId(null)
                setMemberQuery('')
              },
            },
            h(IconChevronLeftOutline14, { size: 14 }),
          ),
        ),
        h(
          'div',
          { className: 'dshOneTree_memberTools' },
          h('input', {
            className: 'dshOneTree_renameInput',
            'data-dshone-tree': 'group-member-search',
            value: memberQuery,
            placeholder: tr('group.members.search'),
            'aria-label': tr('group.members.search'),
            onChange: (event: { target: { value: string } }) => setMemberQuery(event.target.value),
          }),
          h(
            Button,
            {
              size: 'sm',
              variant: 'outline',
              disabled: rows.length === 0 || selected.length === rows.length,
              'data-dshone-tree-action': 'group-member-all',
              onClick: () => setMembers(true),
            },
            tr('group.members.selectAll'),
          ),
          h(
            Button,
            {
              size: 'sm',
              variant: 'outline',
              disabled: selected.length === 0,
              'data-dshone-tree-action': 'group-member-none',
              onClick: () => setMembers(false),
            },
            tr('group.members.clear'),
          ),
        ),
        h(
          'div',
          { className: 'dshOneTree_memberCount', role: 'status', 'data-dshone-tree': 'group-member-count' },
          tr('group.members.count', { n: selected.length, m: rows.length }),
        ),
        h(
          'div',
          {
            className: 'dshOneTree_memberList',
            'data-dshone-tree': 'group-members',
            'data-dshone-group-target': memberGroup.id,
          },
          rows.length === 0
            ? h(
                'div',
                { className: 'dshOneTree_memberEmpty', 'data-dshone-tree': 'group-member-empty' },
                workspaces.length === 0 ? tr('group.members.none') : tr('group.members.noMatch'),
              )
            : rows.map((row) => {
                const on = memberIds.has(row.id)
                return h(
                  'button',
                  {
                    type: 'button',
                    key: row.id,
                    className: 'dshOneTree_memberRow',
                    'data-dshone-member-row': row.id,
                    'data-dshone-member-state': on ? 'on' : 'off',
                    'aria-pressed': on,
                    onClick: () => onToggleMember(memberGroup.id, row.id),
                  },
                  h(SelectMark, { on }),
                  h('span', { className: 'dshOneTree_memberName' }, row.label),
                )
              }),
        ),
        // 第二层不放错误行：建组那一格的校核只发生在第一层（进第二层时那条错误已清掉）。
        modalActions(h(Button, { size: 'sm', variant: 'outline', onClick: onClose }, tr('close'))),
      ],
    })
  }
  return h(Modal, {
    open,
    onClose,
    title: tr('group.manage.title'),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr('group.manage.title'), tr('close'), onClose),
      h(
        'div',
        { className: 'dshOneTree_manageList', 'data-dshone-tree': 'group-manage-list' },
        groups.length === 0
          ? h('div', { className: 'dshOneTree_manageEmpty' }, tr('group.manage.none'))
          : groups.map((group) =>
              h(
                'div',
                { className: 'dshOneTree_manageRow', key: group.id, 'data-dshone-manage-group': group.id },
                // 名字本身就是进成员清单的入口（Telegram 的文件夹行也是点一下进去）；
                // 行尾 ✎/🗑 仍是「关掉本框、开那一套对话框」，各点各的。
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshOneTree_manageName',
                    'data-dshone-tree-action': 'group-members',
                    'data-dshone-group-target': group.id,
                    title: tr('group.members.open', { name: group.name }),
                    onClick: () => {
                      setMemberQuery('')
                      setError(null)
                      setMemberGroupId(group.id)
                    },
                  },
                  group.name,
                ),
                h('span', { className: 'dshOneTree_manageCount' }, String(counts.get(group.id) ?? 0)),
                rowIcon(group.id, group.name, 'rename'),
                rowIcon(group.id, group.name, 'delete'),
              ),
            ),
      ),
      h(
        'div',
        { className: 'dshOneTree_manageCreate' },
        h('input', {
          className: 'dshOneTree_renameInput',
          'data-dshone-tree': 'group-manage-input',
          value: draft,
          placeholder: tr('group.name.label'),
          'aria-label': tr('group.name.label'),
          onChange: (event: { target: { value: string } }) => {
            setDraft(event.target.value)
            setError(null)
          },
          onKeyDown: (event: { key: string; preventDefault(): void }) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            submit()
          },
        }),
        h(Button, { size: 'sm', variant: 'primary', disabled: draft.trim() === '', onClick: submit }, tr('group.new')),
      ),
      ...(error === null ? [] : [h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error)]),
      modalActions(h(Button, { size: 'sm', variant: 'outline', onClick: onClose }, tr('close'))),
    ],
  })
}
