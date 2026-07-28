import type { Conversation } from '@linkcode/client-core';
import type { ToolCall } from '@linkcode/schema';
import { readWorkspaceFile } from '@linkcode/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileArtifactCandidates, locateFileArtifact } from '../locate';

vi.mock('@linkcode/sdk', () => ({ readWorkspaceFile: vi.fn() }));

const readWorkspaceFileMock = vi.mocked(readWorkspaceFile);

beforeEach(() => {
  readWorkspaceFileMock.mockReset();
});

function toolItem(partial: Partial<ToolCall>): Conversation['items'][number] {
  return {
    kind: 'tool',
    id: partial.toolCallId ?? 'tool-1',
    turnId: null,
    toolCall: {
      toolCallId: 'tool-1',
      title: 'Write',
      kind: 'edit',
      status: 'completed',
      content: [],
      ...partial,
    },
  };
}

describe('fileArtifactCandidates', () => {
  it('returns an absolute path as the only candidate', () => {
    expect(fileArtifactCandidates('/tmp/report.pdf', '/w', [])).toEqual(['/tmp/report.pdf']);
  });

  it('anchors a relative path to cwd when the conversation names no locations', () => {
    expect(fileArtifactCandidates('qingjia.pdf', '/w', [])).toEqual(['/w/qingjia.pdf']);
  });

  it('puts exact basename hits from tool locations before the cwd anchor', () => {
    const items = [toolItem({ locations: [{ path: '/docs/leave/qingjia.pdf' }] })];
    expect(fileArtifactCandidates('qingjia.pdf', '/w', items)).toEqual([
      '/docs/leave/qingjia.pdf',
      '/w/qingjia.pdf',
    ]);
  });

  it('derives sibling candidates from touched directories (Bash-produced files)', () => {
    // The agent wrote qingjia.tex via a tool; qingjia.pdf came from a shell compile
    // and appears in no location — its directory is still a candidate.
    const items = [toolItem({ locations: [{ path: '/docs/leave/qingjia.tex' }] })];
    expect(fileArtifactCandidates('qingjia.pdf', '/w', items)).toEqual([
      '/w/qingjia.pdf',
      '/docs/leave/qingjia.pdf',
    ]);
  });

  it('collects paths from diff content and probes newer tool calls first', () => {
    const items = [
      toolItem({ toolCallId: 'old', locations: [{ path: '/a/one.md' }] }),
      toolItem({
        toolCallId: 'new',
        content: [{ type: 'diff', path: '/b/two.md', newText: '' }],
      }),
    ];
    expect(fileArtifactCandidates('readme.md', '/w', items)).toEqual([
      '/w/readme.md',
      '/b/readme.md',
      '/a/readme.md',
    ]);
  });

  it('ignores relative tool locations and multi-segment clicked paths still anchor everywhere', () => {
    const items = [
      toolItem({ locations: [{ path: 'relative/loc.md' }, { path: '/abs/dir/x.md' }] }),
    ];
    expect(fileArtifactCandidates('sub/report.pdf', '/w', items)).toEqual([
      '/w/sub/report.pdf',
      '/abs/dir/sub/report.pdf',
    ]);
  });

  it('recognizes Windows drive locations and joins with forward slashes', () => {
    const items = [toolItem({ locations: [{ path: String.raw`C:\Users\me\docs\qingjia.tex` }] })];
    expect(fileArtifactCandidates('qingjia.pdf', String.raw`C:\Users\me\proj`, items)).toEqual([
      'C:/Users/me/proj/qingjia.pdf',
      'C:/Users/me/docs/qingjia.pdf',
    ]);
  });

  it('treats Windows drive and UNC clicked paths as final candidates', () => {
    expect(fileArtifactCandidates(String.raw`C:\out\report.pdf`, '/w', [])).toEqual([
      String.raw`C:\out\report.pdf`,
    ]);
    expect(fileArtifactCandidates(String.raw`\\server\share\a.md`, '/w', [])).toEqual([
      String.raw`\\server\share\a.md`,
    ]);
  });
});

describe('locateFileArtifact', () => {
  it('treats an oversized candidate as existing instead of falling back to a stale path', async () => {
    const items = [toolItem({ locations: [{ path: '/stale/clip.mp4' }] })];
    readWorkspaceFileMock
      .mockRejectedValueOnce(Object.assign(new Error('File not found'), { code: 'not_found' }))
      .mockRejectedValueOnce(
        Object.assign(new Error('File exceeds read limit'), { code: 'limit_exceeded' }),
      );

    await expect(locateFileArtifact('clip.mp4', '/actual', items)).resolves.toBe(
      '/actual/clip.mp4',
    );
    expect(readWorkspaceFileMock).toHaveBeenNthCalledWith(1, {
      cwd: '/actual',
      path: '/stale/clip.mp4',
    });
    expect(readWorkspaceFileMock).toHaveBeenNthCalledWith(2, {
      cwd: '/actual',
      path: '/actual/clip.mp4',
    });
  });
});
