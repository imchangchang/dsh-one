/**
 * Permission preset 显示名的纯逻辑：官方 product label 的本地化与未知名的
 * Title Case 兜底。与 dsh-client-ui-permission-presets 的 displayPermissionPreset
 * 同源——0.1.2 服务端 `permissions` 投影的 `name` 一律是机器名（workspace-write），
 * 官方 web 的中文「工作区内修改」是客户端按 locale 映射的，不做 locale 协商。
 * 无 vscode 依赖，node --test 可测。
 */

/** kebab-case 机器名 → Title Case（同官方 displayPresetName）；非 kebab 原样透传。 */
export function permissionDisplayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** 官方三个内置权限 preset 的 product label（英文默认串；宿主过 vscode.l10n）。 */
const PERMISSION_PRODUCT_LABELS: Record<string, string> = {
  'read-only': 'Read Only',
  'workspace-write': 'Workspace Write',
  'danger-full-access': 'Full access',
}

/**
 * Option label：value 命中官方内置 preset 且 name 是机器名或英文 product label
 * 时过 t()（中文界面「工作区内修改」，判定同官方 displayPermissionPreset）；
 * 否则 Title Case 原样透传——未知 preset 走机器名转换，服务端未来若直接发
 * 本地化 name（非 kebab）也不会被改写。
 */
export function permissionOptionLabel(value: string, name: string, t: (s: string) => string): string {
  const product = PERMISSION_PRODUCT_LABELS[value]
  if (product !== undefined && (name === value || name === product)) return t(product)
  return permissionDisplayName(name)
}
