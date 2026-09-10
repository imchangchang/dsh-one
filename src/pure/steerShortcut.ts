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

/**
 * composer 的「清空输入 / 打断 turn」组合键判定（Esc 之外的那一键）。两个平台
 * 都是 Ctrl+C，**不是**平台修饰键：macOS 的 ⌘C 归系统复制语义，清空/打断沿用
 * 终端的 Ctrl+C 约定（与官方 dsh web 的 composer 一致）。webview 里 composer 的
 * 双击清空与 document 的「运行中打断」两处共用本函数——此前两处各写一份字面量，
 * 文案与行为容易漂移。
 */
export function isComposerClearChord(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return e.key === 'c' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}

/**
 * 「撤销清空」的显示文案（清空提示小框里告诉用户怎么找回）。
 * 撤销键走 Lexical history：macOS 惯例 ⌘Z，Windows/Linux Ctrl+Z（Lexical
 * 两边都收 Ctrl|Meta+Z，这里按平台惯例显示）。
 */
export function undoChordLabel(os: HostOs | undefined): string {
  return steerModifierLabel(os) === '⌘' ? '⌘Z' : 'Ctrl+Z'
}
