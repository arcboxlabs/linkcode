/**
 * TEMPORARY live drive for CODE-248 — real SDK, real auth (~/.pi/agent/auth.json), real LLM
 * turns. Never committed; skipped unless explicitly requested:
 *   PI_LIVE=1 pnpm vitest run packages/agent-adapter/src/__tests__/pi-live-drive.test.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import { asHistoryId } from '../history-util';
import { PiAdapter } from '../native/pi';

const cwd = mkdtempSync(join(tmpdir(), 'pi-live-'));

function ofType<T extends AgentEvent['type']>(events: AgentEvent[], type: T) {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type);
}

describe.runIf(process.env.PI_LIVE === '1')('pi live drive (real SDK + LLM)', () => {
  it('drives approval, catalog, switching, history convergence, and resume end-to-end', {
    timeout: 300000,
  }, async () => {
    const adapter = new PiAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));

    // Auto-answer permission asks: allow the first bash, reject the second.
    let asks = 0;
    adapter.onEvent((e) => {
      if (e.type !== 'permission-request') return;
      asks += 1;
      const optionId = asks === 1 ? 'allow' : 'reject';
      void adapter.send({
        type: 'permission-response',
        requestId: e.requestId,
        outcome: { outcome: 'selected', optionId },
      });
    });

    await adapter.start({ kind: 'pi', cwd });
    console.log('[live] catalog:', ofType(events, 'available-models-update')[0]?.models.length);
    console.log(
      '[live] policy:',
      ofType(events, 'approval-policy-update')[0]?.state.currentPolicyId,
    );
    console.log('[live] model:', ofType(events, 'model-update')[0]?.model);
    expect(ofType(events, 'available-models-update')[0].models.length).toBeGreaterThan(0);

    // Turn 1: force a bash tool call; the gate should ask, we allow.
    await adapter.send({
      type: 'prompt',
      content: [
        {
          type: 'text',
          text: 'Use the bash tool to run exactly `echo pi-live-drive-marker` and then reply with just: done',
        },
      ],
    });
    console.log('[live] turn1 event types:', events.map((e) => e.type).join(','));
    console.log('[live] turn1 errors:', JSON.stringify(ofType(events, 'error')));
    await vi.waitFor(
      () => {
        expect(ofType(events, 'stop').length).toBeGreaterThan(0);
      },
      { timeout: 60000, interval: 500 },
    );
    const askedTool = ofType(events, 'permission-request')[0];
    console.log('[live] ask1 tool:', askedTool?.toolCall.title, askedTool?.toolCall.toolCallId);
    const liveTools = ofType(events, 'tool-call').map((e) => e.toolCall);
    console.log(
      '[live] tool cards:',
      liveTools.map((t) => `${t.toolCallId}:${t.status}`),
    );
    expect(askedTool?.toolCall.title).toBe('bash');
    expect(liveTools.some((t) => t.status === 'completed')).toBe(true);
    const liveToolId = askedTool.toolCall.toolCallId;

    // Live switching: effort then model (same provider), verify readback reflections.
    events.length = 0;
    await adapter.send({ type: 'set-effort', effort: 'high' });
    console.log('[live] effort-update:', ofType(events, 'effort-update'));
    expect(ofType(events, 'effort-update')[0]?.effort).toBe('high');

    const catalogAll = new PiAdapter();
    // (catalog captured at start above; pick a sibling model of the same provider)
    void catalogAll;

    // Turn 2: deny path — second bash ask gets rejected, turn must still settle.
    await adapter.send({
      type: 'prompt',
      content: [
        {
          type: 'text',
          text: 'Run `echo second-marker` with bash. If the tool is denied, reply with just: denied-ok',
        },
      ],
    });
    await vi.waitFor(
      () => {
        expect(ofType(events, 'stop').length).toBeGreaterThan(0);
      },
      { timeout: 240000, interval: 500 },
    );
    const denied = ofType(events, 'tool-call').flatMap((e) =>
      e.toolCall.status === 'failed' ? [e.toolCall] : [],
    );
    console.log(
      '[live] denied cards:',
      denied.map((t) => `${t.toolCallId}:${t.status}`),
    );
    const answer = ofType(events, 'agent-message-chunk')
      .map((e) => (e.content.type === 'text' ? e.content.text : ''))
      .join('');
    console.log('[live] turn2 answer:', JSON.stringify(answer));
    expect(denied.length).toBeGreaterThan(0);

    const sessionRef = ofType(events, 'session-ref')[0] ?? undefined;
    await adapter.stop();

    // History: list + read must run on a NEVER-started instance; tool ids must converge.
    const cold = new PiAdapter();
    const list = await cold.listHistory({ cwd });
    console.log(
      '[live] history sessions for cwd:',
      list.sessions.map((s) => `${s.historyId}(${s.messageCount})`),
    );
    expect(list.sessions.length).toBeGreaterThan(0);
    const historyId = list.sessions[0].historyId;
    const read = await cold.readHistory({ historyId });
    const coldToolIds = read.events.flatMap((e) =>
      e.event.type === 'tool-call' ? [e.event.toolCall.toolCallId] : [],
    );
    console.log('[live] cold tool ids:', coldToolIds, 'live id:', liveToolId);
    console.log(
      '[live] cold event types:',
      read.events.map((e) => e.event.type),
    );
    expect(coldToolIds).toContain(liveToolId);

    // Resume: continue the same session, ask about earlier context.
    const resumed = new PiAdapter();
    const revents: AgentEvent[] = [];
    resumed.onEvent((e) => revents.push(e));
    await resumed.resumeHistory({ historyId: asHistoryId(historyId) }, { kind: 'pi', cwd });
    expect(ofType(revents, 'session-ref')[0]?.historyId).toBe(historyId);
    await resumed.send({
      type: 'prompt',
      content: [
        {
          type: 'text',
          text: 'What exact marker string did the first echo command in this conversation print? Reply with only that string.',
        },
      ],
    });
    await vi.waitFor(
      () => {
        expect(ofType(revents, 'stop').length).toBeGreaterThan(0);
      },
      { timeout: 240000, interval: 500 },
    );
    const recall = ofType(revents, 'agent-message-chunk')
      .map((e) => (e.content.type === 'text' ? e.content.text : ''))
      .join('');
    console.log('[live] resume recall:', JSON.stringify(recall));
    expect(recall).toContain('pi-live-drive-marker');
    await resumed.stop();

    console.log('[live] session-ref (live):', sessionRef?.historyId, '=== history:', historyId);
  });
});
