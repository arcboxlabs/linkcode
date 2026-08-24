import type { MessageStructureObject } from 'imapflow';

export interface TextPartRef {
  readonly part: string;
  readonly contentType: string;
  readonly charset?: string;
}

export interface AttachmentRef {
  readonly part: string;
  readonly filename?: string;
  readonly contentType: string;
  readonly size?: number;
  readonly disposition?: string;
}

function leafNodes(root?: MessageStructureObject): MessageStructureObject[] {
  if (!root) return [];
  const out: MessageStructureObject[] = [];
  const walk = (node: MessageStructureObject): void => {
    if (node.childNodes?.length) {
      for (const child of node.childNodes) walk(child);
      return;
    }
    out.push(node);
  };
  walk(root);
  return out;
}

/** Leaf `text/*` parts that can serve as the readable body, preferring text/plain. */
export function selectReadableParts(root?: MessageStructureObject): TextPartRef[] {
  const out: TextPartRef[] = [];
  for (const node of leafNodes(root)) {
    const type = node.type.toLowerCase();
    if (type.startsWith('text/')) {
      out.push({ part: node.part ?? '', contentType: type, charset: node.parameters?.charset });
    }
  }
  return out;
}

export function pickPreferredPart(parts: TextPartRef[]): TextPartRef | undefined {
  if (parts.length === 0) return undefined;
  const plain = parts.find((p) => p.contentType === 'text/plain');
  return plain ?? parts[0];
}

/** Non-body leaves: anything explicitly `attachment`, or non-text leaves (covers inline images). */
export function collectAttachments(root?: MessageStructureObject): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  for (const node of leafNodes(root)) {
    const type = node.type.toLowerCase();
    const disposition = node.disposition?.toLowerCase();
    if (disposition !== 'attachment' && type.startsWith('text/')) continue;
    out.push({
      part: node.part ?? '',
      filename: node.dispositionParameters?.filename ?? node.parameters?.name,
      contentType: type,
      size: node.size,
      disposition,
    });
  }
  return out;
}

/** Decode a raw body part Buffer using the declared charset; Node ships full-ICU TextDecoder (gbk/gb2312/big5). */
export function decodeBodyPart(buffer: Buffer | undefined, charset?: string): string {
  if (!buffer) return '';
  const label = normalizeCharset(charset);
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function normalizeCharset(charset?: string): string {
  if (!charset) return 'utf-8';
  const lower = charset.toLowerCase();
  // gb2312 is a subset of gbk; Node's TextDecoder resolves both to the same decoder.
  if (lower === 'gb2312' || lower === 'gb18030') return 'gbk';
  return lower;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const overflow = text.length - max;
  return `${text.slice(0, max)}\n…[truncated ${overflow} chars]`;
}
