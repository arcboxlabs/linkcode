import type { TerminalReplayEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { TerminalFlow } from '../terminal/flow';
import { TerminalReplayJournal } from '../terminal/replay';

interface Harness {
  journal: TerminalReplayJournal;
  flow: TerminalFlow;
  delivered: TerminalReplayEvent[];
  grants: number[];
}

function harness(opts?: { windowChars?: number; journalBytes?: number }): Harness {
  const journal = new TerminalReplayJournal(opts?.journalBytes ?? 10 * 1024 * 1024);
  const delivered: TerminalReplayEvent[] = [];
  const grants: number[] = [];
  const flow = new TerminalFlow(
    journal,
    {
      deliver: (event) => delivered.push(event),
      grantRead: (bytes) => grants.push(bytes),
    },
    opts?.windowChars ?? 100,
  );
  return { journal, flow, delivered, grants };
}

function writes(delivered: TerminalReplayEvent[]): string[] {
  return delivered.flatMap((event) => (event.type === 'write' ? [event.data] : []));
}

describe('TerminalFlow', () => {
  it('free-runs and grants immediately while unattached', () => {
    const { journal, flow, delivered, grants } = harness();
    journal.appendWrite('x'.repeat(500));
    flow.pump();
    journal.appendResize(90, 30);
    flow.pump();

    expect(writes(delivered)).toEqual(['x'.repeat(500)]);
    expect(delivered.at(-1)).toMatchObject({ type: 'resize', cols: 90, rows: 30 });
    expect(grants).toEqual([500]);
    expect(flow.drained).toBe(true);
  });

  it('clamps delivery to the window and resumes on ack, granting consumed bytes', () => {
    const { journal, flow, delivered, grants } = harness({ windowChars: 100 });
    flow.attach('a');
    journal.appendWrite('x'.repeat(120));
    journal.appendWrite('tail');
    flow.pump();

    // The first event overshoots the window (whole events only); the second is held.
    expect(writes(delivered)).toEqual(['x'.repeat(120)]);
    expect(grants).toEqual([]);

    flow.ack('a', 120);
    expect(writes(delivered)).toEqual(['x'.repeat(120), 'tail']);
    expect(grants).toEqual([120]);
    expect(flow.drained).toBe(true);
  });

  it('gates on the slowest attachment and recovers when it detaches', () => {
    const { journal, flow, delivered } = harness({ windowChars: 100 });
    flow.attach('fast');
    flow.attach('slow');
    journal.appendWrite('x'.repeat(150));
    journal.appendWrite('tail');
    flow.pump();
    expect(writes(delivered)).toEqual(['x'.repeat(150)]);

    flow.ack('fast', 150);
    expect(writes(delivered)).toEqual(['x'.repeat(150)]);

    flow.detach('slow');
    expect(writes(delivered)).toEqual(['x'.repeat(150), 'tail']);
  });

  it('a mid-stream attach only accounts for chars delivered after its baseline', () => {
    const { journal, flow, delivered } = harness({ windowChars: 100 });
    flow.attach('early');
    journal.appendWrite('x'.repeat(90));
    flow.pump();
    const { replay, cutoffSeq } = flow.attach('late');

    // The late attachment's snapshot carries the already-delivered event; its window starts empty,
    // so the early attachment's 90 outstanding chars still gate the stream.
    expect(replay.at(-1)).toMatchObject({ type: 'write', data: 'x'.repeat(90) });
    journal.appendWrite('y'.repeat(20));
    flow.pump();
    expect(writes(delivered)).toEqual(['x'.repeat(90), 'y'.repeat(20)]);
    journal.appendWrite('held');
    flow.pump();
    expect(writes(delivered)).toEqual(['x'.repeat(90), 'y'.repeat(20)]);

    // Acking only the late attachment can't free the window; the early one is the slowest.
    flow.ack('late', 20);
    expect(writes(delivered)).toHaveLength(2);
    flow.ack('early', 110);
    expect(writes(delivered)).toEqual(['x'.repeat(90), 'y'.repeat(20), 'held']);
    expect(cutoffSeq).toBe(1);
  });

  it('re-attach preserves the accounting epoch (view→control upgrade)', () => {
    const { journal, flow, delivered, grants } = harness({ windowChars: 100 });
    flow.attach('a');
    journal.appendWrite('x'.repeat(80));
    flow.pump();
    flow.attach('a');
    journal.appendWrite('x'.repeat(80));
    journal.appendWrite('held');
    flow.pump();
    expect(writes(delivered)).toEqual(['x'.repeat(80), 'x'.repeat(80)]);

    // The client's acks stay cumulative across the upgrade. A baseline reset at re-attach would
    // credit both events on the first ack (one 160-byte grant) instead of one event per ack.
    flow.ack('a', 80);
    expect(writes(delivered)).toEqual(['x'.repeat(80), 'x'.repeat(80), 'held']);
    expect(grants).toEqual([80]);
    flow.ack('a', 160);
    expect(grants).toEqual([80, 80]);
  });

  it('clamps a hostile over-ack to what was actually delivered', () => {
    const { journal, flow, grants } = harness({ windowChars: 100 });
    flow.attach('a');
    journal.appendWrite('x'.repeat(50));
    flow.pump();

    flow.ack('a', 1_000_000);
    expect(grants).toEqual([50]);
    flow.ack('a', 2_000_000);
    expect(grants).toEqual([50]);
  });

  it('substitutes a clear sequence for a journal-truncation gap', () => {
    // A tiny journal with a stalled window: each oversized append evicts the one before it, so
    // by the time the window reopens the cursor points into truncated history.
    const { journal, flow, delivered } = harness({ windowChars: 10, journalBytes: 100 });
    flow.attach('a');
    journal.appendWrite('x'.repeat(60));
    flow.pump();
    expect(writes(delivered)).toEqual(['x'.repeat(60)]);

    journal.appendWrite('a'.repeat(90));
    journal.appendWrite('b'.repeat(90));
    journal.appendWrite('c'.repeat(95));
    flow.ack('a', 60);

    const resumed = writes(delivered).slice(1);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toBe(`\u001B[2J\u001B[3J\u001B[H${'c'.repeat(95)}`);
    expect(flow.drained).toBe(true);
  });
});
