/**
 * Agent preset 选择器的纯逻辑：roster 行到选项的映射与本地化。无 vscode
 * 依赖，node --test 可测。只有空会话（没有任何 turn/start）可选择 preset
 * ——"是否已启动"的判定在 src/server/chatSession.ts，这里只管展示文案。
 */

/** Loose mirror of one agentPreset.list roster entry. */
export interface AgentPresetLike {
  id: string
  trust?: string
  isDefault?: boolean
  name?: string
  description?: string
  /** Broken rows never enter the picker. */
  broken?: boolean
}

/** One picker option (chip label + dropdown row). */
export interface AgentPresetOption {
  id: string
  label: string
  description?: string
}

/** 官方四个 system preset 的中文文案（对齐 dsh web 的本地化）。 */
const SYSTEM_PRESET_LABELS: Record<string, { label: string; description: string }> = {
  standard: {
    label: '标准模式',
    description: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  },
  code: {
    label: 'PTC 模式',
    description: '具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  },
  minimal: {
    label: '极简模式',
    description: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  },
  cordis: {
    label: '创造模式',
    description: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
  },
}

/**
 * Roster → picker options. Broken rows and entries without a usable id drop
 * out; official system presets (trust 'system' + known id) get the localized
 * label/description, everything else (user presets, unknown system ids) falls
 * back to the roster's own name/description, then to the bare id.
 */
export function resolveAgentPresets(roster: readonly AgentPresetLike[]): AgentPresetOption[] {
  const options: AgentPresetOption[] = []
  for (const p of roster) {
    if (p.broken === true || typeof p.id !== 'string' || p.id === '') continue
    const known = p.trust === 'system' ? SYSTEM_PRESET_LABELS[p.id] : undefined
    const label = known?.label ?? (typeof p.name === 'string' && p.name !== '' ? p.name : p.id)
    const description =
      known?.description ?? (typeof p.description === 'string' && p.description !== '' ? p.description : undefined)
    options.push({ id: p.id, label, ...(description ? { description } : {}) })
  }
  return options
}

/** Roster 的默认行 id（broken 行不算）；没有 isDefault 时回退到第一个可选项。 */
export function defaultAgentPresetId(roster: readonly AgentPresetLike[]): string | undefined {
  const usable = roster.filter((p) => p.broken !== true && typeof p.id === 'string' && p.id !== '')
  return (usable.find((p) => p.isDefault === true) ?? usable[0])?.id
}

/**
 * Preset id → 头部只读标签的显示名（兜底映射）：已知 system preset id 用中文名，
 * 其余（user preset、未知 id）原样显示 id。首选映射是 roster 的 name
 * （ChatSessionController.agentPresetLabelFor，对齐官方 AgentPresetLabel 的
 * roster 查找），本函数只在 roster 未就绪或 id 不在 roster 时兜底——session.list
 * 的 agentPreset 是裸 id，没有 trust，user preset 撞官方 id 的边角情况按官方名显示。
 */
export function agentPresetLabel(id: string): string {
  return SYSTEM_PRESET_LABELS[id]?.label ?? id
}
