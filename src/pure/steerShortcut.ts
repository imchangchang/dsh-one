/**
 * 插话（steer）快捷键的修饰键展示名：composer 占位符按宿主平台出文案——
 * macOS 显示 ⌘Enter，Windows/Linux 显示 Ctrl+Enter。按键处理侧 webview 是
 * metaKey || ctrlKey 两平台都收，这里只管展示。hostOs 未知时回退 ⌘
 * （保持修复前的既有文案）。
 */
import type { HostOs } from './installScript.ts'

export function steerModifierLabel(os: HostOs | undefined): '⌘' | 'Ctrl' {
  return os === 'windows' || os === 'linux' ? 'Ctrl' : '⌘'
}
