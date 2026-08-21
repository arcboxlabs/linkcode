import { describe, expect, it } from 'vitest';
import {
  attachmentFromReadFile,
  failedComposerAttachmentFromPath,
  pendingComposerAttachment,
} from '../composer-attachments';

describe('composer attachment presentation kinds', () => {
  it.each([
    { kind: 'image', mimeType: 'image/png', name: 'photo.png' },
    { kind: 'file', mimeType: 'image/svg+xml', name: 'vector.svg' },
    { kind: 'audio', mimeType: 'audio/mpeg', name: 'recording.mp3' },
    { kind: 'video', mimeType: 'video/mp4', name: 'clip.mp4' },
    { kind: 'pdf', mimeType: 'application/pdf', name: 'guide.pdf' },
    {
      kind: 'document',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      name: 'notes.docx',
    },
  ] as const)('classifies $name as $kind UI', ({ name, mimeType, kind }) => {
    const attachment = pendingComposerAttachment(new File([], name, { type: mimeType }));

    expect(attachment.kind).toBe(kind);
  });

  it('uses the file extension when a failed native read has no MIME type', () => {
    expect(failedComposerAttachmentFromPath('/tmp/guide.pdf', 'Failed').kind).toBe('pdf');
  });

  it('keeps the basename on image blocks created from native file reads', () => {
    const attachment = attachmentFromReadFile(
      {
        path: String.raw`C:\screenshots\architecture.png`,
        content: 'cG5n',
        encoding: 'base64',
        mimeType: 'image/png',
        size: 3,
      },
      { unsupportedType: 'Unsupported', tooLarge: 'Too large' },
    );

    expect(attachment.block).toEqual({
      type: 'image',
      data: 'cG5n',
      mimeType: 'image/png',
      name: 'architecture.png',
    });
  });
});
