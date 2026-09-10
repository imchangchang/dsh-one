/**
 * 图片入站闸（粘贴 / 拖拽 / 选择三条入口共用），对齐官方 dsh web
 * `InputBar.intakeImages`（dsh-client-ui-conversation/lib/client.js）的判定顺序：
 * MIME 白名单 → 张数上限 → 单张字节上限 → 本条消息总字节上限。
 *
 * 与官方的两处必要差异：
 * - 官方把「含非白名单类型」当整批放行（非图片走文件路径，不受图片闸管）；
 *   这里只对**本批里的图片**计数与计量——非图片文件在我们的管线里落成 path
 *   chip（不进模型图像部分），不该被图片闸挡下。
 * - 上限值来自宿主 `imageLimits` 投影（dsh 侧 5MB/20 张/100MB），不是官方的
 *   dsh-attachment-local 默认值（20MB/20 张/200MB）；闸只认投影，投影缺失
 *   （legacy 会话）时不过闸，保持修复前行为。
 *
 * 纯函数无 vscode/DOM 依赖，node --test 可测。
 */
import { imageMediaTypeByExtension } from './composerAttachment.ts'

/** 闸用到的上限子集（ChatState.imageLimits 的结构化形状）。 */
export interface ImageIntakeLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  /** 允许的图片 MIME；不在表内的声明类型按扩展名兜底判定。 */
  mediaTypes: readonly string[]
}

/** 一个待入站文件在闸眼里需要的最小信息（`File` 的元数据投影）。 */
export interface ImageIntakeEntry {
  name: string
  /** 声明的 MIME（clipboard file-promise 可能为空串）。 */
  mediaType: string
  /** 字节数（`File.size`；尺寸未知给 undefined 时按 0 计，不漏判只是少判）。 */
  bytes: number
}

/** 拒绝原因：`null` = 放行。 */
export type ImageIntakeRejection =
  | { reason: 'tooMany'; max: number }
  | { reason: 'fileTooLarge'; name: string; maxBytes: number }
  | { reason: 'totalTooLarge'; maxBytes: number }

/**
 * 该文件是不是「图片闸管的图片」：声明类型在白名单内，或声明类型缺失/未知时
 * 扩展名命中图片表（macOS 剪贴板 file-promise 常给空 type，靠名字兜底）。
 * 明确声明成非图片类型（application/pdf）的文件不算图片，走文件 chip。
 */
export function isGatedImage(entry: ImageIntakeEntry, mediaTypes: readonly string[]): boolean {
  const declared = entry.mediaType.trim().toLowerCase()
  if (declared !== '') {
    if (mediaTypes.includes(declared)) return true
    // 声明了别的图片类型（image/bmp 一类）：也算图片，交给下面的字节闸；
    // 声明成非 image/* 的一律按文件走。
    return declared.startsWith('image/')
  }
  const dot = entry.name.lastIndexOf('.')
  return dot < 0 ? false : imageMediaTypeByExtension(entry.name.slice(dot)) !== undefined
}

/** base64 载荷的字节数（4 字符 = 3 字节，扣掉末尾 padding）。 */
export function base64Bytes(data: string): number {
  if (data.length === 0) return 0
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((data.length * 3) / 4) - padding
}

/**
 * 一站式判定：本批 `incoming` 追加到已 staged 的图片之后，是否超限。
 *
 * @param incoming - 本次入站的全部文件（顺序即用户拖入/粘贴顺序）。
 * @param stagedImages - composer 里已 staged 的图片张数。
 * @param stagedBytes - composer 里已 staged 的图片总字节数（base64 解码后）。
 * @param limits - 宿主投影；undefined = 不过闸。
 * @returns 拒绝原因，或 null（放行）。
 */
export function imageIntakeRejection(
  incoming: readonly ImageIntakeEntry[],
  stagedImages: number,
  stagedBytes: number,
  limits: ImageIntakeLimits | undefined,
): ImageIntakeRejection | null {
  if (!limits) return null
  const images = incoming.filter((entry) => isGatedImage(entry, limits.mediaTypes))
  if (images.length === 0) return null
  if (stagedImages + images.length > limits.maxImagesPerMessage) {
    return { reason: 'tooMany', max: limits.maxImagesPerMessage }
  }
  const oversized = images.find((entry) => entry.bytes > limits.maxImageBytes)
  if (oversized) return { reason: 'fileTooLarge', name: oversized.name, maxBytes: limits.maxImageBytes }
  const total = stagedBytes + images.reduce((sum, entry) => sum + Math.max(0, entry.bytes), 0)
  if (total > limits.maxMessageImageBytes) return { reason: 'totalTooLarge', maxBytes: limits.maxMessageImageBytes }
  return null
}

/** 字节数 → 人类可读（`5 MB` / `512 KB` / `800 B`；整数 MB 不显示小数）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
