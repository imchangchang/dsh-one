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
 * out; official system presets (trust 'system' + known id) get the localized
 * label/description, everything else (user presets, unknown system ids) falls
 * back to the roster's own name/description, then to the bare id.
 */
export function resolveAgentPresets(
  roster: readonly AgentPresetLike[],
  t: (s: string) => string = (s) => s,
): AgentPresetOption[] {
  const options: AgentPresetOption[] = []
  for (const p of roster) {
    if (p.broken === true || typeof p.id !== 'string' || p.id === '') continue
    const known = p.trust === 'system' ? SYSTEM_PRESET_LABELS[p.id] : undefined
    const label = known ? t(known.label) : typeof p.name === 'string' && p.name !== '' ? p.name : p.id
    const description =
      known?.description !== undefined
        ? t(known.description)
        : typeof p.description === 'string' && p.description !== ''
          ? p.description
          : undefined
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
