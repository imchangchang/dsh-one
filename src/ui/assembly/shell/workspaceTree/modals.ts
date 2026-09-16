/** 对话框（分组新建/重命名/删除、工作区与会话重命名、删除工作区）。 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceGroupDef } from '../../../../pure/treeGroups.ts'
import type { Translate } from './types.ts'

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
      closeLabel: tr('close'),
      title: tr('group.delete'),
      ...(dialog === null || dialog.kind === 'create' ? {} : { description: tr('group.delete.desc', { name: dialog.name }) }),
      footer: h(
        'div',
        { style: { display: 'flex', gap: '8px' } },
        h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
        h(
          Button,
          {
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
      children: error === null ? null : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error),
    })
  }
  return h(Modal, {
    open,
    onClose,
    closeLabel: tr('close'),
    title: kind === 'create' ? tr('group.new') : tr('group.rename'),
    footer: h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
      h(
        Button,
        { variant: 'primary', disabled: busy || nameError !== null, onClick: submit },
        kind === 'create' ? tr('group.new') : tr('rename'),
      ),
    ),
    children: [
      h('input', {
        className: 'dshOneTree_renameInput',
        value: draft,
        'aria-label': kind === 'create' ? tr('group.new') : tr('group.rename'),
        autoFocus: true,
        disabled: busy,
        onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
        onKeyDown: (event: { key: string; preventDefault(): void }) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (nameError === null) submit()
        },
      }),
      nameError === null && error === null
        ? null
        : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, nameError ?? error),
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
    closeLabel: tr('close'),
    title: tr(titleKey),
    footer: h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
      h(Button, { variant: 'primary', disabled: busy || draft.trim() === '', onClick: commit }, tr('rename')),
    ),
    children: [
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
      error === null ? null : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error),
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
    closeLabel: tr('close'),
    title: tr('delete.workspace'),
    ...(target === null ? {} : { description: tr('delete.desc', { name: target.title }) }),
    footer: h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, tr('cancel')),
      h(Button, { variant: 'outline', disabled: busy, onClick: commit, className: 'dshOneTree_deleteAction' }, tr('delete.workspace')),
    ),
    children: [
      busy ? h('div', { className: 'dshOneTree_deleteStatus', role: 'status' }, tr('delete.pending')) : null,
      error === null ? null : h('div', { className: 'dshOneTree_renameError', role: 'alert' }, error),
    ],
  })
}
