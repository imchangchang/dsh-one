/**
 * Pure helpers for the composer's staged-attachment list: whether a staged
 * item renders as an image thumbnail, and the data: URL for its inline
 * preview. No vscode/DOM — unit-testable with node --test.
 */

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
