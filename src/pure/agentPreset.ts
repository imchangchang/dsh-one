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

/** 官方四个 system preset 的文案 key（英文默认串；宿主过 vscode.l10n）。 */
const SYSTEM_PRESET_LABELS: Record<string, { label: string; description: string }> = {
  standard: {
    label: 'Standard mode',
    description:
      'A full-featured coding agent: file editing, shell, file and web search, skills, plan, goals, subagents, and workflows.',
  },
  code: {
    label: 'PTC mode',
    description:
      'All standard capabilities, with tools exposed through the Code Mode SDK so the model composes multi-step operations in one TypeScript program.',
  },
  minimal: {
    label: 'Minimal mode',
    description: 'A two-tool coding agent: persistent bash and str_replace_editor only.',
  },
  cordis: {
    label: 'Cordis mode',
    description:
      'For authoring custom agent presets: all standard capabilities plus runtime checks, plugin experiments, and preset authoring guidance.',
  },
}

/**
 * Roster → picker options. Broken rows and entries without a usable id drop
 * out; the roster's own name/description takes precedence — official presets
 * ship localized copy from the server (preset.yml: 标准模式, PTC 模式, ...),
 * so overwriting it with the built-in English map here is what made the
 * Chinese UI show English. The map is only a fallback for older servers that
 * omit the copy (fallback text goes through t()); unknown ids fall back to
 * the bare id.
 */
export function resolveAgentPresets(
  roster: readonly AgentPresetLike[],
  t: (s: string) => string = (s) => s,
): AgentPresetOption[] {
  const options: AgentPresetOption[] = []
  for (const p of roster) {
    if (p.broken === true || typeof p.id !== 'string' || p.id === '') continue
    const known = p.trust === 'system' ? SYSTEM_PRESET_LABELS[p.id] : undefined
    const rosterName = typeof p.name === 'string' && p.name !== '' ? p.name : undefined
    const rosterDesc = typeof p.description === 'string' && p.description !== '' ? p.description : undefined
    // Roster 提供任一文案即视为本地化原文：全部用它（缺失字段留空），
    // 避免「标准模式 + 英文描述」混搭；两项全缺才回退内置映射（过 t()）。
    const useBuiltIn = rosterName === undefined && rosterDesc === undefined
    const label = useBuiltIn ? (known ? t(known.label) : p.id) : rosterName ?? p.id
    const description = useBuiltIn ? (known ? t(known.description) : undefined) : rosterDesc
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
export function agentPresetLabel(id: string, t: (s: string) => string = (s) => s): string {
  return SYSTEM_PRESET_LABELS[id] ? t(SYSTEM_PRESET_LABELS[id].label) : id
}

/**
 * Preset id → 头部标签悬停 tooltip 的描述文案（与 agentPresetLabel 同模式
 * 的兜底映射）：已知 system preset id 用中文描述，其余返回 undefined——
 * user preset 的描述只能查 roster（ChatSessionController.agentPresetDescriptionFor），
 * roster 未就绪时没有可兜底的文案。
 */
export function agentPresetDescription(
  id: string,
  t: (s: string) => string = (s) => s,
): string | undefined {
  return SYSTEM_PRESET_LABELS[id] ? t(SYSTEM_PRESET_LABELS[id].description) : undefined
}
