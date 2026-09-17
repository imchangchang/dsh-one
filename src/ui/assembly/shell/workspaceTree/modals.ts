/**
 * 对话框（分组新建/重命名/删除、工作区与会话重命名、删除工作区、标签组新建/删除）。
 *
 * #127：七个弹窗整套取**紧凑档**，与侧栏同一密度（档位表与每处的取值出处写在
 * `styles.ts` 的 `.dshOneTree_modal` 那一节）。为此官方 `Modal` 走它的 `headless`
 * prop——官方件在这一版**没有尺寸变体**（举证见 styles.ts 那一段），`headless` 是它
 * 给的官方口子：mask / Esc / portal / `role="dialog"` 仍由官方代码提供，标题行、
 * 说明行与底部按钮行由本件按紧凑档拼（`modalHead` / `modalDesc` / `modalActions`）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconCloseFill14,
  IconEditOutline16,
  IconTrashOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionBlock } from '../../../../pure/workspaceTreeView.ts'
import type { WorkspaceGroupDef } from '../../../../pure/treeGroups.ts'
import { TAG_COLORS, type TagColor } from '../../../../pure/sessionTags.ts'
import { displayTitle } from './format.ts'
import { TAG_COLOR_CSS, TAG_COLOR_LABEL } from './tagGroups.ts'
import type { Translate } from './types.ts'

/** 弹窗容器的自有类名（挂在官方 Modal 的 dialog 元素上，几何见 styles.ts 那一节）。 */
const MODAL_CLASS = 'dshOneTree_modal'

/** 头行：标题 + 关闭钮。官方 Modal 在 `headless` 下不再渲染这两件，由这里按紧凑档拼。 */
function modalHead(title: string, closeLabel: string, onClose: () => void): unknown {
  return h(
    'div',
    { className: 'dshOneTree_modalHead' },
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
 */
export function ManageGroupsModal({
  open,
  groups,
  counts,
  tr,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  open: boolean
  groups: readonly WorkspaceGroupDef[]
  /** 每个分组的成员工作区数（组 id → 计数）。 */
  counts: ReadonlyMap<string, number>
  tr: Translate
  /** 建新组：成功回 null，失败回词典键（'group.name.empty' / 'group.name.duplicate'）。 */
  onCreate: (name: string) => 'empty' | 'duplicate' | null
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string, name: string) => void
  onClose: () => void
}): unknown {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lastOpen = useRef(false)
  useEffect(() => {
    if (open && !lastOpen.current) {
      setDraft('')
      setError(null)
    }
    lastOpen.current = open
  }, [open])
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
                h('span', { className: 'dshOneTree_manageName' }, group.name),
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
