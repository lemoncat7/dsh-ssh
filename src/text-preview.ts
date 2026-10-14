import { markdownHash } from './markdown-file.js'
import type { SftpFilePreview } from './sftp.js'

export const MAX_TEXT_PREVIEW_BYTES = 1_048_576
export const MAX_MEDIA_PREVIEW_BYTES = 16 * 1_048_576

/** Decide before reading; unknown suffixes are sniffed within the text budget. */
export function previewWithoutReading(base: SftpFilePreview, limit = MAX_TEXT_PREVIEW_BYTES): SftpFilePreview | undefined {
  const media = base.kind === 'image' || base.kind === 'pdf'
  if (base.size > (media ? MAX_MEDIA_PREVIEW_BYTES : limit)) return { ...base, kind: 'binary', previewUnavailable: 'too-large' }
  if (media || (base.kind === 'binary' && base.mimeType !== 'application/octet-stream')) return base
  return undefined
}

export function textPreview(base: SftpFilePreview, bytes: Buffer, limit = MAX_TEXT_PREVIEW_BYTES): SftpFilePreview {
  if (bytes.length > limit || base.size > limit) return { ...base, kind: 'binary', previewUnavailable: 'too-large' }
  if (bytes.length !== base.size) return { ...base, kind: 'binary', previewUnavailable: 'unreadable' }
  // Strict decoding avoids presenting binary files as replacement characters.
  // BOM-marked UTF-16 is readable but not editable as UTF-8 Markdown.
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : undefined
  try {
    const text = new TextDecoder(utf16 ?? 'utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/u.test(text)) throw new Error('binary content')
    return { ...base, kind: 'text', mimeType: base.kind === 'text' ? base.mimeType : 'text/plain', text, truncated: false,
      ...(utf16 ? {} : { contentHash: markdownHash(bytes) }) }
  } catch { return { ...base, kind: 'binary', previewUnavailable: 'unreadable' } }
}
