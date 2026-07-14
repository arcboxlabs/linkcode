import type { ContentBlock } from '@linkcode/schema';
import type { ChatAttachment } from '../chat/attachments';

/** The strictest common denominator across the three confirmed-supporting adapters' installed
 * SDKs (Claude's `Base64ImageSource.media_type` enum is the narrowest of the three). */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
const SUPPORTED_IMAGE_MIME_TYPE_SET: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME_TYPES);

/** Per-image raw byte cap, mirroring `MAX_ATTACHMENT_IMAGE_BASE64_LENGTH` in
 * `@linkcode/schema/content` (kept here rather than importing it: the client checks the
 * pre-encode `File.size`, not a base64 string length). */
export const MAX_ATTACHMENT_IMAGE_BYTES = 8 * 1024 * 1024;

/** Aggregate cap across every attachment staged in one message — a UI-only staging concern, not
 * a wire-level one. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;

export function isSupportedImageMimeType(mimeType: string | undefined): mimeType is string {
  return mimeType !== undefined && SUPPORTED_IMAGE_MIME_TYPE_SET.has(mimeType);
}

export function isSupportedImageFile(file: File): boolean {
  return isSupportedImageMimeType(file.type);
}

/** A staged composer attachment: the presentational `ChatAttachment` plus the wire payload once
 * decoding succeeds. `block` is absent while `status` is `pending`/`failed`. */
export type ComposerAttachment = ChatAttachment & { block?: ContentBlock };

/** Reads a `File` into a `data:` URL, used as both the wire payload's base64 `data` and the
 * `ChatAttachment` preview `url` — one read serves both, so there's no object-URL to revoke. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result as string));
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Failed to read file')),
    );
    reader.readAsDataURL(file);
  });
}

/** Decodes a dropped/pasted image `File` into a staged attachment ready to send. Throws with a
 * message suitable for a toast when the file is unsupported, oversized, or unreadable. */
export async function readImageFileAsComposerAttachment(
  file: File,
  errors: {
    unsupportedType: string;
    tooLarge: string;
    readFailed: string;
  },
): Promise<ComposerAttachment> {
  const id = `${file.name}-${file.size}-${file.lastModified}`;
  if (!isSupportedImageFile(file)) throw new Error(errors.unsupportedType);
  if (file.size > MAX_ATTACHMENT_IMAGE_BYTES) throw new Error(errors.tooLarge);

  let dataUrl: string;
  try {
    dataUrl = await readFileAsDataUrl(file);
  } catch {
    throw new Error(errors.readFailed);
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  return {
    id,
    kind: 'image',
    mimeType: file.type,
    name: file.name,
    sizeBytes: file.size,
    status: 'ready',
    url: dataUrl,
    block: { type: 'image', data: base64, mimeType: file.type },
  };
}

export function pendingComposerAttachment(file: File): ComposerAttachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    kind: 'image',
    mimeType: file.type,
    name: file.name,
    sizeBytes: file.size,
    status: 'pending',
  };
}

export function failedComposerAttachment(file: File, errorMessage: string): ComposerAttachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    errorMessage,
    kind: 'image',
    mimeType: file.type,
    name: file.name,
    sizeBytes: file.size,
    status: 'failed',
  };
}

/** The shape of a daemon `file.read` result relevant here — a structural subset of
 * `@linkcode/schema`'s `WorkspaceFile`, kept local so this stays a plain data shape rather than
 * pulling in the whole schema type for four fields. */
export interface ReadAttachmentFileResult {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  mimeType?: string;
  size: number;
}

const PATH_SEPARATOR_RE = /[/\\]/;

function fileNameFromPath(path: string): string {
  return path.split(PATH_SEPARATOR_RE).pop() ?? path;
}

/** Converts a natively-picked file's daemon-read bytes into a staged attachment ready to send —
 * the counterpart to `readImageFileAsComposerAttachment` for files acquired via the "Attach"
 * picker (a path) rather than drag-and-drop/paste (a `File`). Synchronous: the bytes are already
 * in hand, no `FileReader` round trip needed. */
export function attachmentFromReadFile(
  file: ReadAttachmentFileResult,
  errors: { unsupportedType: string; tooLarge: string },
): ComposerAttachment {
  const name = fileNameFromPath(file.path);
  if (file.encoding !== 'base64' || !isSupportedImageMimeType(file.mimeType)) {
    throw new Error(errors.unsupportedType);
  }
  if (file.size > MAX_ATTACHMENT_IMAGE_BYTES) throw new Error(errors.tooLarge);
  const mimeType = file.mimeType;

  return {
    id: `${file.path}-${file.size}`,
    kind: 'image',
    mimeType,
    name,
    sizeBytes: file.size,
    status: 'ready',
    url: `data:${mimeType};base64,${file.content}`,
    block: { type: 'image', data: file.content, mimeType },
  };
}

/** Failure counterpart to `attachmentFromReadFile`, for when the daemon read itself throws
 * (oversized/missing/unreadable) before a `ReadAttachmentFileResult` even exists. */
export function failedComposerAttachmentFromPath(
  path: string,
  errorMessage: string,
): ComposerAttachment {
  const name = fileNameFromPath(path);
  return {
    id: path,
    errorMessage,
    kind: 'image',
    name,
    status: 'failed',
  };
}
