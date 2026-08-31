import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const FrozenV79SessionOriginSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created') }),
  z.object({
    type: z.literal('imported'),
    historyId: z.string().min(1),
    importedAt: z.number().int().nonnegative(),
  }),
]);

const FrozenV79SessionListedSchema = z.object({
  kind: z.literal('session.listed'),
  replyTo: z.string().min(1),
  sessions: z.array(
    z.object({
      sessionId: z.string().min(1),
      kind: z.enum(['claude-code', 'codex', 'opencode', 'pi', 'grok-build']),
      cwd: z.string(),
      status: z.enum(['starting', 'idle', 'running', 'awaiting-input', 'stopped']),
      createdAt: z.number().int().nonnegative(),
      updatedAt: z.number().int().nonnegative(),
      origin: FrozenV79SessionOriginSchema.optional(),
    }),
  ),
});

function sessionStart(effort: unknown, branch?: unknown) {
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 0,
    payload: {
      kind: 'session.start',
      clientReqId: 'request-1',
      opts: {
        kind: 'claude-code',
        cwd: '/repo',
        effort,
        ...(!(branch === undefined) && { branch }),
      },
    },
  };
}

describe('session wire variants', () => {
  it('accepts a supported initial effort level', () => {
    expect(parseWireMessage(sessionStart('high')).ok).toBe(true);
  });

  it('rejects an unknown initial effort level', () => {
    expect(parseWireMessage(sessionStart('extreme')).ok).toBe(false);
  });

  it.each(['local', 'worktree'])('accepts an explicit %s branch mode', (mode) => {
    expect(parseWireMessage(sessionStart('high', { name: 'feature', mode })).ok).toBe(true);
  });

  it('rejects a branch without an explicit mode', () => {
    expect(parseWireMessage(sessionStart('high', { name: 'feature' })).ok).toBe(false);
  });

  it('accepts a legacy session.imported record whose runs predate runId', () => {
    // ≤v79 daemons emit runs without runId; required-ness waits for the floor bump.
    expect(
      parseWireMessage({
        v: WIRE_PROTOCOL_VERSION,
        id: 'message-1',
        ts: 0,
        payload: {
          kind: 'session.imported',
          replyTo: 'request-1',
          record: {
            sessionId: 'session-1',
            kind: 'claude-code',
            cwd: '/repo',
            origin: { type: 'created' },
            createdAt: 1,
            updatedAt: 2,
            runs: [{ startedAt: 1, historyId: 'native-1' }],
          },
        },
      }).ok,
    ).toBe(true);
  });

  it('keeps fork provenance additive for frozen v79 session-list parsers', () => {
    const payload = {
      kind: 'session.listed' as const,
      replyTo: 'request-1',
      sessions: [
        {
          sessionId: 'session-forked',
          kind: 'codex' as const,
          cwd: '/repo',
          status: 'stopped' as const,
          createdAt: 1,
          updatedAt: 2,
          origin: { type: 'created' as const },
          forkOrigin: {
            sourceSessionId: 'session-source',
            sourceTurnId: 'turn-source',
            forkedAt: 1,
          },
        },
      ],
    };

    const parsed = FrozenV79SessionListedSchema.parse(payload);
    expect(parsed.sessions[0].origin).toEqual({ type: 'created' });
    expect(parsed.sessions[0]).not.toHaveProperty('forkOrigin');
    expect(parseWireMessage({ v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 2, payload }).ok).toBe(
      true,
    );
  });

  it('accepts a frozen v79 session-list frame', () => {
    expect(
      parseWireMessage({
        v: 79,
        id: 'message-1',
        ts: 2,
        payload: {
          kind: 'session.listed',
          replyTo: 'request-1',
          sessions: [
            {
              sessionId: 'session-imported',
              kind: 'claude-code',
              cwd: '/repo',
              status: 'stopped',
              createdAt: 1,
              updatedAt: 2,
              origin: { type: 'imported', historyId: 'native-1', importedAt: 1 },
            },
          ],
        },
      }).ok,
    ).toBe(true);
  });
});
