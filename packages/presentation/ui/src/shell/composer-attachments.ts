import type { ContentBlock } from '@linkcode/schema';
import { isSupportedAttachmentImageMimeType, MAX_ATTACHMENT_BYTES } from '@linkcode/schema';
import type { ChatAttachment, ChatAttachmentKind } from '../chat/attachments';

const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const DOCUMENT_EXTENSIONS = new Set([
  'csv',
  'doc',
  'docx',
  'json',
  'md',
  'markdown',
  'odt',
  'rtf',
  'tsv',
  'txt',
  'xls',
  'xlsx',
  'yaml',
  'yml',
]);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);

export function isSupportedImageMimeType(mimeType: string | undefined): boolean {
  return mimeType !== undefined && isSupportedAttachmentImageMimeType(mimeType);
}

export function isSupportedImageFile(file: File): boolean {
  return isSupportedImageMimeType(file.type);
}

function attachmentKindForFile(name: string, mimeType?: string): ChatAttachmentKind {
  if (isSupportedImageMimeType(mimeType)) return 'image';

  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mimeType?.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (mimeType?.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (mimeType?.startsWith('text/') || DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return 'file';
}

/** A staged composer attachment: the presentational `ChatAttachment` plus the wire payload once
 * decoding succeeds. `block` is absent while `status` is `pending`/`failed`. */
export type ComposerAttachment = ChatAttachment & { block?: ContentBlock };

/** Tray-local identity; never crosses the wire. Random on purpose: the same file staged twice
 * must stay independently addressable, so the id cannot derive from file stats. */
function newAttachmentId(): string {
  return crypto.randomUUID();
}

/** Reads a browser-picked file as base64 without adding a `data:` URL prefix. */
export async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** Reads a `File` into a `data:` URL, used by composer image previews. */
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

/** Decodes a dropped/pasted image `File` into the ready form of `pending` (same id, so the tray
 * swaps it in place). Throws a toast-suitable message when the file cannot be read. */
export async function readImageFileAsComposerAttachment(
  file: File,
  pending: ComposerAttachment,
  readFailed: string,
): Promise<ComposerAttachment> {
  let dataUrl: string;
  try {
    dataUrl = await readFileAsDataUrl(file);
  } catch {
    throw new Error(readFailed);
  }

  return {
    ...pending,
    status: 'ready',
    url: dataUrl,
    block: { type: 'image', data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type },
  };
}

export function pendingComposerAttachment(file: File): ComposerAttachment {
  return {
    id: newAttachmentId(),
    kind: attachmentKindForFile(file.name, file.type),
    mimeType: file.type,
    name: file.name,
    sizeBytes: file.size,
    status: 'pending',
  };
}

/** Failure form of `pending`, keeping its id so the tray swaps it in place. */
export function failedComposerAttachment(
  pending: ComposerAttachment,
  errorMessage: string,
): ComposerAttachment {
  return {
    ...pending,
    errorMessage,
    status: 'failed',
  };
}

/** Structural subset of `@linkcode/schema`'s `WorkspaceFile`, kept local so this stays a plain
 * data shape rather than pulling in the whole schema type for four fields. */
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

/** "Attach"-picker (path) counterpart to `readImageFileAsComposerAttachment`: the daemon-read
 * bytes are already in hand, so this is synchronous — no `FileReader` round trip. */
export function attachmentFromReadFile(
  file: ReadAttachmentFileResult,
  errors: { unsupportedType: string; tooLarge: string },
): ComposerAttachment {
  const name = fileNameFromPath(file.path);
  if (
    file.encoding !== 'base64' ||
    file.mimeType === undefined ||
    !isSupportedImageMimeType(file.mimeType)
  ) {
    throw new Error(errors.unsupportedType);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(errors.tooLarge);
  const mimeType = file.mimeType;

  return {
    id: newAttachmentId(),
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
    id: newAttachmentId(),
    errorMessage,
    kind: attachmentKindForFile(name),
    name,
    status: 'failed',
  };
}
