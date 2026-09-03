import type { SupportedAttachmentImageMimeType } from './content';
import { isSupportedAttachmentImageMimeType } from './content';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + magic.length) return false;
  for (let i = 0, len = magic.length; i < len; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

/** The image type the leading bytes actually are, for the four types adapters accept. */
export function sniffImageMimeType(head: Uint8Array): SupportedAttachmentImageMimeType | undefined {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, PNG_MAGIC)) return 'image/png';
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp';
  return undefined;
}

/** A declared sniffable `image/*` type must match its bytes — model APIs refuse the mismatch
 * later and less legibly. Other declarations (svg, heic, pdf, …) have no reliable sniff here
 * and are trusted. */
export function declaredMimeTypeMatches(declared: string, head: Uint8Array): boolean {
  if (!declared.startsWith('image/')) return true;
  const sniffed = sniffImageMimeType(head);
  if (sniffed !== undefined) return sniffed === declared;
  return !isSupportedAttachmentImageMimeType(declared);
}
