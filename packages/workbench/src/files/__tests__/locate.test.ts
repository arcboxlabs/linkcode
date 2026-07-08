import type { Conversation } from '@linkcode/client-core';
import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { fileArtifactCandidates } from '../locate';

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
});
