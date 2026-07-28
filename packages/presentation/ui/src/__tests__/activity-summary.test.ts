import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { ActivityRunItem } from '../chat/activity-groups';
import {
  activityRunCurrentDescriptor,
  settledActivityRunDescriptor,
} from '../chat/activity-summary';

type ActivityToolKind = Exclude<ToolCall['kind'], 'task'>;
type ActivityToolItem = Extract<ActivityRunItem, { kind: 'tool' }>;
type ReasoningActivityItem = Extract<ActivityRunItem, { kind: 'reasoning' }> & {
  summary?: string;
};

const RE_SENSITIVE_ACTIVITY_DETAIL = /user|password|private|token|secret/u;

let seq = 0;

function tool(
  kind: ActivityToolKind,
  overrides: Omit<Partial<ToolCall>, 'kind'> = {},
): ActivityToolItem {
  const id = `tool-${seq++}`;
  return {
    kind: 'tool',
    id,
    turnId: 'turn-0',
    toolCall: {
      toolCallId: id,
      title: `${kind} ${id}`,
      kind,
      status: 'completed',
      content: [],
      ...overrides,
    },
  };
}

function reasoning(text: string, isStreaming = false, summary?: string): ReasoningActivityItem {
  return {
    kind: 'reasoning',
    id: `reasoning-${seq++}`,
    turnId: 'turn-0',
    blocks: [{ type: 'text', text }],
    isStreaming,
    summary,
  };
}

describe('settledActivityRunDescriptor', () => {
  it('uses fixed priority for reverse input, keeps files penultimate, and omits thinking', () => {
    const descriptor = settledActivityRunDescriptor([
      reasoning('Initial analysis'),
      tool('search', { status: 'failed', rawInput: { query: 'needle' } }),
      tool('edit', { locations: [{ path: 'src/app.ts' }] }),
      tool('execute', { rawInput: { command: 'pnpm test' } }),
      tool('other', { title: 'mcp__github__create_issue' }),
      tool('think', { title: 'Reviewing result' }),
      tool('fetch', { rawInput: { url: 'https://example.com/docs' } }),
      tool('execute', { rawInput: { command: 'pnpm typecheck' } }),
    ]);

    expect(descriptor).toEqual({
      clauses: [
        { category: 'failure', count: 1 },
        { category: 'integration', count: 1 },
        { category: 'command', count: 2 },
        { category: 'files', count: 1 },
        { category: 'explore', count: 2 },
      ],
    });
  });

  it('counts repeated activity without exposing titles, input, output, or reasoning text', () => {
    const descriptor = settledActivityRunDescriptor([
      tool('execute', {
        title: 'Run command',
        rawInput: { command: 'pnpm test' },
        rawOutput: { secret: 'must-not-leak' },
      }),
      tool('other', {
        title: 'mcp__github__create_issue',
        rawInput: { token: 'other-input-secret' },
        rawOutput: { credential: 'other-output-secret' },
      }),
      reasoning('Done'),
    ]);

    expect(JSON.stringify(descriptor)).not.toContain('must-not-leak');
    expect(JSON.stringify(descriptor)).not.toContain('other-input-secret');
    expect(JSON.stringify(descriptor)).not.toContain('other-output-secret');
    expect(JSON.stringify(descriptor)).not.toContain('mcp__github__create_issue');
    expect(JSON.stringify(descriptor)).not.toContain('Done');
    expect(descriptor.clauses).toEqual([
      { category: 'integration', count: 1 },
      { category: 'command', count: 1 },
    ]);
  });

  it('uses an uncounted thinking fallback only for a successful thinking-only run', () => {
    expect(settledActivityRunDescriptor([reasoning('Private reasoning'), tool('think')])).toEqual({
      clauses: [{ category: 'thinking' }],
    });

    expect(
      settledActivityRunDescriptor([
        reasoning('Private reasoning'),
        tool('think', { status: 'failed' }),
      ]),
    ).toEqual({ clauses: [{ category: 'failure', count: 1 }] });
  });
});

describe('activityRunCurrentDescriptor', () => {
  it.each([
    'pending',
    'in_progress',
  ] as const)('treats a non-thinking %s tool as active when no thinking item is active', (status) => {
    expect(
      activityRunCurrentDescriptor([
        reasoning('Earlier'),
        tool('execute', { status, rawInput: { command: 'pnpm test' } }),
      ]),
    ).toEqual({ category: 'command', kind: 'execute' });
  });

  it('prefers the newest active reasoning or think tool over other active tools', () => {
    expect(
      activityRunCurrentDescriptor([
        reasoning('Earlier', true),
        tool('execute', { status: 'in_progress' }),
      ]),
    ).toEqual({ category: 'thinking', kind: 'reasoning' });

    expect(
      activityRunCurrentDescriptor([
        reasoning('Earlier', true),
        tool('think', { status: 'pending' }),
        tool('execute', { status: 'in_progress' }),
      ]),
    ).toEqual({ category: 'thinking', kind: 'think' });

    expect(
      activityRunCurrentDescriptor([
        tool('think', { status: 'pending' }),
        reasoning('Later', true),
        tool('execute', { status: 'in_progress' }),
      ]),
    ).toEqual({ category: 'thinking', kind: 'reasoning' });
  });

  it('uses the latest active tool within the non-thinking tier', () => {
    expect(
      activityRunCurrentDescriptor([
        tool('execute', { status: 'pending' }),
        tool('fetch', { status: 'in_progress' }),
      ]),
    ).toEqual({ category: 'explore', kind: 'fetch' });
  });

  it('returns a normalized, bounded explicit reasoning summary without projecting blocks', () => {
    const descriptor = activityRunCurrentDescriptor([
      reasoning('block-private-secret', true, `  Public\nsummary ${'🙂'.repeat(200)}  `),
    ]);

    if (descriptor?.kind !== 'reasoning') throw new Error('Expected active reasoning');
    expect(descriptor.summary).not.toContain('\n');
    expect(descriptor.summary).not.toContain('  ');
    expect(descriptor.summary).not.toContain('block-private-secret');
    expect([...(descriptor.summary ?? '')]).toHaveLength(160);
    expect(descriptor.summary?.endsWith('…')).toBe(true);
  });

  it('ignores settled reasoning without reading its blocks', () => {
    expect(activityRunCurrentDescriptor([tool('read'), reasoning('Done')])).toBeUndefined();
  });

  it('never projects sensitive payloads from the active item', () => {
    const descriptor = activityRunCurrentDescriptor([
      tool('fetch', {
        status: 'in_progress',
        title: 'private integration title',
        rawInput: { url: 'https://user:password@example.com/private?token=secret' },
      }),
    ]);

    expect(descriptor).toEqual({ category: 'explore', kind: 'fetch' });
    expect(JSON.stringify(descriptor)).not.toMatch(RE_SENSITIVE_ACTIVITY_DETAIL);
  });
});
