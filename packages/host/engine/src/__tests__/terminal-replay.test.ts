import { describe, expect, it } from 'vitest';
import { TerminalReplayJournal } from '../terminal/replay';

describe('TerminalReplayJournal', () => {
  it('shares one sequence across writes/resizes and drops oldest events by UTF-8 bytes', () => {
    const journal = new TerminalReplayJournal(17);

    journal.appendWrite('é');
    journal.appendResize(100, 30);
    journal.appendWrite('x');

    expect(journal.snapshot()).toEqual([
      { type: 'resize', seq: 2, cols: 100, rows: 30 },
      { type: 'write', seq: 3, data: 'x' },
    ]);
    expect(journal.cutoffSeq).toBe(3);
    expect(journal.truncated).toBe(true);
  });

  it('marks an event larger than the whole cap as unavailable without rewinding the cutoff', () => {
    const journal = new TerminalReplayJournal(1);
    journal.appendWrite('too large');

    expect(journal.snapshot()).toEqual([]);
    expect(journal.cutoffSeq).toBe(1);
    expect(journal.truncated).toBe(true);
  });

  it('caps tiny events by count before their object overhead can grow without bound', () => {
    const journal = new TerminalReplayJournal(100, 2);

    journal.appendWrite('a');
    journal.appendWrite('b');
    journal.appendResize(90, 25);

    expect(journal.snapshot()).toEqual([
      { type: 'write', seq: 2, data: 'b' },
      { type: 'resize', seq: 3, cols: 90, rows: 25 },
    ]);
    expect(journal.truncated).toBe(true);
  });
});
