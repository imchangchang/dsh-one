/**
 * Markdown 内嵌本地图片（工具输出里 `![img](/abs/path.png)` 一类）的宿主读取策略。
 *
 * webview 与宿主两侧共用一张「扩展名白名单」闸：
 * - webview 侧用它过滤哪些 img src 值得走 requestInlineImage（非图片扩展名不发请求，
 *   保持现状 broken 态，避免对非图片路径每 5 秒重试的打点风暴）；
 * - 宿主侧在 resolveLinkPath + stat 后用它确定性拒绝非图片扩展名（纵深防御），
 *   与大小上限（MAX_INLINE_IMAGE_BYTES）一起构成「类型 + 大小」双闸。
 *
 * 与 composerAttachment 的 imageMediaTypeByExtension 不同：这里输入是 markdown src
 * 原文（可能带 file: 前缀 / URL 编码 / Windows 盘符），先归一成文件名再判扩展名。
 * 纯函数无 vscode/DOM 依赖，可 node --test。
 */
import { attachmentBaseName, imageMediaTypeByExtension } from './composerAttachment.ts'

/**
 * 单张内嵌图片的大小上限（10MB）：超出直接走失败态占位（点击外部打开），
 * 不读内容。这是「在聊天里内嵌渲染」的成本/资源闸，不是 dsh ImageLimits 的镜像
 * ——消息附件 chip 的 fileThumb 通道保持原行为（无大小限制），不受此常量影响。
 */
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024

/** 大小闸：负数/NaN（stat 异常值）与超限一律拒绝。 */
export function inlineImageTooLarge(sizeBytes: number): boolean {
  return !Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_INLINE_IMAGE_BYTES
}

/**
 * markdown 内嵌图片 src → 图片 MIME（非图片扩展名返回 undefined）。
 *
 * 归一顺序：URL 解码（%20 一类，坏 % 序列保留原样）→ 剥 file: 前缀
 * （file:///a%20b.png）→ 取 basename（按 / 与 \，Windows 盘符路径同适用）→
 * 扩展名查白名单（.png/.jpg/.jpeg/.webp/.gif，大小写容忍）。
 */
export function inlineImageMediaType(rawSrc: string): string | undefined {
  let href = rawSrc
  try {
    href = decodeURIComponent(rawSrc)
  } catch {
    // 保留原样：非法 % 序列是文件名的一部分，不是编码错误
  }
  const base = attachmentBaseName(href.replace(/^file:/i, ''))
  const i = base.lastIndexOf('.')
  if (i < 0) return undefined
  return imageMediaTypeByExtension(base.slice(i))
}
