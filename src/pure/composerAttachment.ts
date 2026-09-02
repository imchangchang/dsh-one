/**
 * Pure helpers for the composer's staged-attachment list: whether a staged
 * item renders as an image thumbnail, the data: URL for its inline preview,
 * and the round-trip of staged file lines in the outgoing prompt text.
 * No vscode/DOM — unit-testable with node --test.
 */
import type { StagedFile } from './chatContract.ts'

/** Whether a staged attachment should render as an image thumbnail. */
export function isImageMediaType(mediaType: string): boolean {
  return mediaType.trim().toLowerCase().startsWith('image/')
}

/**
 * data: URL for inline rendering of a staged image's base64 bytes. An empty
 * declared type falls back to image/png (clipboard file-promises may carry
 * none; the host has already sniffed the bytes as an image by then).
 */
export function attachmentDataUrl(mediaType: string, base64: string): string {
  const type = mediaType.trim().toLowerCase()
  return `data:${type === '' ? 'image/png' : type};base64,${base64}`
}

/**
 * 拆分发送消息文本里 composer 拼入的 `<attachment>…</attachment>` 文件行
 * （发送失败还原用）：完整行按 / 与 \\ 两种分隔符取 basename 还原成文件
 * chips，行内容是自己打的就不动。webview 打包进浏览器环境，不引 node:path。
 */
export function splitAttachmentLines(text: string): { text: string; files: StagedFile[] } {
  const files: StagedFile[] = []
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const m = /^<attachment>(.+)<\/attachment>$/.exec(line.trim())
    if (m) files.push({ name: baseName(m[1]), path: m[1] })
    else lines.push(line)
  }
  return { text: lines.join('\n'), files }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}
