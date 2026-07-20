import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  activityRunCurrentDescriptor,
  settledActivityRunDescriptor,
} from '../chat/activity-summary';
import type { ConversationItem } from '../chat/types';

type ActivityToolKind = Exclude<ToolCall['kind'], 'task'>;
type ActivityRunItem =
  | Extract<ConversationItem, { kind: 'reasoning' }>
  | (Extract<ConversationItem, { kind: 'tool' }> & {
      toolCall: ToolCall & { kind: ActivityToolKind };
    });
type ActivityToolItem = Extract<ActivityRunItem, { kind: 'tool' }>;

let seq = 0;
const RE_SENSITIVE_FRAGMENT = /user|password|private|token|secret/u;

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

function reasoning(text: string, isStreaming = false): ActivityRunItem {
  return {
    kind: 'reasoning',
    id: `reasoning-${seq++}`,
    turnId: 'turn-0',
    blocks: [{ type: 'text', text }],
    isStreaming,
  };
}

describe('settledActivityRunDescriptor', () => {
  it('emits one clause per category with failures first and first-seen category order', () => {
    const descriptor = settledActivityRunDescriptor([
      reasoning('Initial analysis'),
      tool('search', { rawInput: { query: 'needle' } }),
      tool('execute', { status: 'failed', rawInput: { command: 'pnpm test' } }),
      tool('edit', { locations: [{ path: 'src/app.ts' }] }),
      tool('fetch', { rawInput: { url: 'https://example.com/docs' } }),
      tool('other', { title: 'mcp__github__create_issue' }),
      tool('think', { title: 'Reviewing result' }),
      tool('execute', { rawInput: { command: 'pnpm typecheck' } }),
    ]);

    expect(descriptor).toEqual({
      clauses: [
        { category: 'failure' },
        { category: 'thinking' },
        { category: 'explore' },
        { category: 'command' },
        { category: 'files', detail: 'app.ts' },
        { category: 'integration', detail: 'github' },
      ],
    });
    expect(descriptor.clauses).toHaveLength(6);
  });

  it('does not expose raw output in clauses', () => {
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
  });
});

describe('activityRunCurrentDescriptor', () => {
  it.each(['pending', 'in_progress'] as const)('treats %s tools as active', (status) => {
    expect(
      activityRunCurrentDescriptor([
        reasoning('Earlier', true),
        tool('execute', { status, rawInput: { command: 'pnpm test' } }),
      ]),
    ).toEqual({ category: 'command', detail: 'pnpm test', kind: 'execute' });
  });

  it('returns the latest streaming reasoning and ignores settled runs', () => {
    expect(
      activityRunCurrentDescriptor([tool('read'), reasoning('  checking\n the result  ', true)]),
    ).toEqual({ category: 'thinking', detail: 'checking the result', kind: 'reasoning' });
    expect(activityRunCurrentDescriptor([tool('read'), reasoning('Done')])).toBeUndefined();
  });

  it('omits sensitive command detail and reduces URLs to their hostname', () => {
    expect(
      activityRunCurrentDescriptor([
        tool('execute', {
          status: 'in_progress',
          rawInput: { command: 'curl -H "Authorization: Bearer private-token" example.com' },
        }),
      ]),
    ).toEqual({ category: 'command', kind: 'execute' });

    const fetchDescriptor = activityRunCurrentDescriptor([
      tool('fetch', {
        status: 'in_progress',
        rawInput: { url: 'https://user:password@example.com/private?token=secret' },
      }),
    ]);
    expect(fetchDescriptor).toEqual({
      category: 'explore',
      detail: 'example.com',
      kind: 'fetch',
    });
    expect(JSON.stringify(fetchDescriptor)).not.toMatch(RE_SENSITIVE_FRAGMENT);
  });

  it('omits sensitive search and reasoning detail', () => {
    expect(activityRunCurrentDescriptor([reasoning('Using api-key private-value', true)])).toEqual({
      category: 'thinking',
      kind: 'reasoning',
    });
    expect(
      activityRunCurrentDescriptor([
        tool('search', {
          status: 'in_progress',
          rawInput: { query: 'password=private-value' },
        }),
      ]),
    ).toEqual({ category: 'explore', kind: 'search' });
  });

  it.each([
    ['thinking', () => reasoning(`start\n${'x'.repeat(240)}`, true)],
    [
      'command',
      () =>
        tool('execute', {
          status: 'in_progress',
          rawInput: { command: `run\n${'x'.repeat(240)}` },
        }),
    ],
    [
      'explore',
      () =>
        tool('search', { status: 'in_progress', rawInput: { query: `find\n${'x'.repeat(240)}` } }),
    ],
    [
      'explore',
      () =>
        tool('fetch', {
          status: 'in_progress',
          rawInput: {
            url: `https://${'x'.repeat(60)}.${'y'.repeat(60)}.${'z'.repeat(60)}.example.com/path`,
          },
        }),
    ],
    [
      'integration',
      () => tool('other', { status: 'in_progress', title: `integration\n${'x'.repeat(240)}` }),
    ],
  ] as const)('bounds and normalizes %s detail', (category, makeItem) => {
    const descriptor = activityRunCurrentDescriptor([makeItem()]);

    expect(descriptor?.category).toBe(category);
    expect(descriptor?.detail).not.toContain('\n');
    expect(descriptor?.detail).not.toContain('  ');
    expect([...(descriptor?.detail ?? '')]).toHaveLength(160);
    expect(descriptor?.detail?.endsWith('…')).toBe(true);
  });
});
