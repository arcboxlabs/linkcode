import type { MessageStructureObject } from 'imapflow';
import { describe, expect, it } from 'vitest';
import {
  collectAttachments,
  decodeBodyPart,
  pickPreferredPart,
  selectReadableParts,
  truncate,
} from '../body';

function part(opts: Partial<MessageStructureObject> & { type: string }): MessageStructureObject {
  return { ...opts };
}

describe('selectReadableParts', () => {
  it('returns nothing for an empty structure', () => {
    expect(selectReadableParts()).toEqual([]);
  });

  it('collects text/plain and text/html leaves from a multipart/alternative', () => {
    const root = part({
      type: 'multipart/alternative',
      childNodes: [
        part({ type: 'text/plain', part: '1', parameters: { charset: 'utf-8' } }),
        part({ type: 'text/html', part: '2' }),
      ],
    });
    const readable = selectReadableParts(root);
    expect(readable.map((p) => p.part)).toEqual(['1', '2']);
    expect(readable[0].contentType).toBe('text/plain');
  });

  it('ignores non-text leaves', () => {
    const root = part({
      type: 'multipart/mixed',
      childNodes: [
        part({ type: 'text/plain', part: '1' }),
        part({
          type: 'application/pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'a.pdf' },
        }),
      ],
    });
    expect(selectReadableParts(root).map((p) => p.part)).toEqual(['1']);
  });
});

describe('pickPreferredPart', () => {
  it('prefers text/plain over html', () => {
    const parts = selectReadableParts(
      part({
        type: 'multipart/alternative',
        childNodes: [
          part({ type: 'text/html', part: '1' }),
          part({ type: 'text/plain', part: '2' }),
        ],
      }),
    );
    expect(pickPreferredPart(parts)?.contentType).toBe('text/plain');
  });

  it('returns undefined when empty', () => {
    expect(pickPreferredPart([])).toBeUndefined();
  });
});

describe('collectAttachments', () => {
  it('captures attachments and inline non-text parts, skipping the body', () => {
    const root = part({
      type: 'multipart/mixed',
      childNodes: [
        part({ type: 'text/plain', part: '1' }),
        part({
          type: 'application/pdf',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'a.pdf' },
          size: 1024,
        }),
        part({
          type: 'image/png',
          part: '3',
          disposition: 'inline',
          dispositionParameters: { filename: 'img.png' },
        }),
      ],
    });
    const attachments = collectAttachments(root);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      part: '2',
      filename: 'a.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    expect(attachments[1]).toMatchObject({
      part: '3',
      filename: 'img.png',
      contentType: 'image/png',
    });
  });

  it('treats a text/* part with disposition=attachment as an attachment', () => {
    const root = part({
      type: 'multipart/mixed',
      childNodes: [
        part({ type: 'text/plain', part: '1' }),
        part({
          type: 'text/csv',
          part: '2',
          disposition: 'attachment',
          dispositionParameters: { filename: 'data.csv' },
        }),
      ],
    });
    const attachments = collectAttachments(root);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe('data.csv');
  });
});

describe('decodeBodyPart', () => {
  it('decodes utf-8 bytes', () => {
    const buf = Buffer.from('héllo', 'utf-8');
    expect(decodeBodyPart(buf, 'utf-8')).toBe('héllo');
  });

  it('decodes gbk bytes when charset is gb2312', () => {
    // "中" in GBK is 0xD6 0xD0.
    const buf = Buffer.from([0xd6, 0xd0]);
    expect(decodeBodyPart(buf, 'gb2312')).toBe('中');
  });

  it('falls back to utf-8 on an unknown charset', () => {
    const buf = Buffer.from('ok', 'utf-8');
    expect(decodeBodyPart(buf, 'not-a-real-charset')).toBe('ok');
  });

  it('returns empty for undefined buffer', () => {
    expect(decodeBodyPart(undefined)).toBe('');
  });
});

describe('truncate', () => {
  it('returns the text unchanged when within the limit', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('slices and notes the overflow', () => {
    const out = truncate('abcdefghij', 4);
    expect(out.startsWith('abcd')).toBe(true);
    expect(out).toContain('6 chars');
  });
});
