import { describe, expect, it } from 'vitest';
import { InMemorySessionStore } from '../session/session-store';
import {
  createSessionHarness as harness,
  listedSessions,
  startedSessionId as startedId,
} from './fixtures/session-harness';

/**
 * CODE-618 boundary: `EngineDeps.allowedAgents` must refuse only a *new* live start of an
 * excluded kind. A session persisted before the restriction landed (or created by an unrestricted
 * engine sharing the same store) must keep listing and reading — refusing there was the regression
 * a restricted-brand build previously hit on every `session.list`.
 */
describe('restricted-brand agent allowlist', () => {
  it('keeps listing a persisted session of an excluded kind instead of throwing', async () => {
    const store = new InMemorySessionStore();
    const unrestricted = harness(store);
    await unrestricted.engine.start();
    await unrestricted.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(unrestricted.sent, 'r1');

    // A restricted engine over the same store, excluding the kind of the session just created.
    const restricted = harness(store, undefined, undefined, undefined, undefined, undefined, {
      allowedAgents: ['pi'],
    });
    await restricted.engine.start();
    await restricted.inject({ kind: 'session.list', clientReqId: 'r2' });

    const sessions = listedSessions(restricted.sent, 'r2');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId, cwd: '/repo' });
  });

  it('refuses to start a new session of an excluded kind', async () => {
    const h = harness(
      new InMemorySessionStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        allowedAgents: ['pi'],
      },
    );
    await h.engine.start();

    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'forbidden',
      message: 'claude-code: not available in this build',
    });
    expect(h.adapters).toHaveLength(0);
  });

  it('refuses agent.catalog for an excluded kind before any adapter is constructed', async () => {
    const h = harness(
      new InMemorySessionStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        allowedAgents: ['pi'],
      },
    );
    await h.engine.start();

    await h.inject({ kind: 'agent.catalog', clientReqId: 'r1', agentKind: 'codex' });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      code: 'forbidden',
      message: 'codex: not available in this build',
    });
    expect(h.adapters).toHaveLength(0);
  });

  it('starts a new session of an allowed kind normally', async () => {
    const h = harness(
      new InMemorySessionStore(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        allowedAgents: ['pi'],
      },
    );
    await h.engine.start();

    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'pi', cwd: '/repo' },
    });

    expect(startedId(h.sent, 'r1')).toBeTruthy();
    expect(h.adapters).toHaveLength(1);
  });
});
