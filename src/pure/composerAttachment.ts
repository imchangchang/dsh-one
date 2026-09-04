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

/** 文件扩展名 → dsh 支持的图片 MIME（`.jpg`→`image/jpeg`；未知返回 undefined）。 */
export function imageMediaTypeByExtension(filename: string): string | undefined {
  switch (filename.toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg': return 'image/jpeg'
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
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
    if (m) {
      const path = m[1]
      files.push({ name: attachmentBaseName(path), path })
      if (isImagePath(path)) files[files.length - 1].image = true
    } else lines.push(line)
  }
  return { text: lines.join('\n'), files }
}

/** 按 / 与 \\ 两种分隔符取 basename（Windows 盘符路径同样适用）；无分隔符时原样返回。 */
export function attachmentBaseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

/**
 * 常见图片扩展名判定（dsh ImageMediaType 对应的四种 + 大小写容忍）。
 * 先取 basename 再判扩展名：Windows 的 `C:\v1.2\shot` 这类路径不会因目录里
 * 的点把「扩展名」切错（无真实扩展名时保持非图片）。
 */
export function isImagePath(p: string): boolean {
  const base = attachmentBaseName(p)
  const ext = base.slice(base.lastIndexOf('.')).toLowerCase()
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.gif'
}

/** 按 MIME 类型取落盘扩展名（unknown 回退 png）。 */
function snapshotExtension(mediaType: string): string {
  switch (mediaType.trim().toLowerCase()) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

/**
 * 图片序号文件名：`imgN.ext`（`img1.png`、`img2.jpg`…，N 从 1 起）。序号由
 * 宿主按会话目录里已存在的 imgN 文件递增分配；纯函数只拼名，测试可注入。
 */
export function imgFileName(mediaType: string, n: number): string {
  return `img${n}.${snapshotExtension(mediaType)}`
}

/** 长文本粘贴的文件名：`pasted-N.txt`（N 从 1 起，按会话目录递增）。 */
export function pastedFileName(n: number): string {
  return `pasted-${n}.txt`
}

/**
 * 长文本粘贴是否折叠为文件附件：超过 10 行或 800 字符（固定阈值，可后议）。
 * 短文本维持默认直接插入。
 */
export function shouldFoldPastText(text: string): boolean {
  if (text.length === 0) return false
  return text.split('\n').length > 10 || text.length > 800
}
