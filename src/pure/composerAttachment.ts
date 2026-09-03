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
      files.push({ name: baseName(path), path })
      if (isImagePath(path)) files[files.length - 1].image = true
    } else lines.push(line)
  }
  return { text: lines.join('\n'), files }
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

/** 常见图片扩展名（dsh ImageMediaType 对应的四种 + 大小写容忍）。 */
export function isImagePath(p: string): boolean {
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
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
 * 粘贴图片的落盘短名：`截图-MMDD-HHmmss.ext`（如 `截图-0903-153812.png`），
 * 同时间段多次粘贴由宿主用 clashIndex 递增（`截图-0903-153812-2.png`）。
 * 不依赖 node:path/时区库——本地时间戳即文件名含义，测试可注入 now。
 */
export function snapshotFileName(mediaType: string, now: Date, clashIndex = 0): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const clash = clashIndex > 0 ? `-${clashIndex + 1}` : ''
  return `截图-${stamp}${clash}.${snapshotExtension(mediaType)}`
}
