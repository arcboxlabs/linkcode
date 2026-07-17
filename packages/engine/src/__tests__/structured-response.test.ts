import type { SessionId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { TurnResult } from '../automation/session-driver';
import { extractJson, promptForStructured } from '../automation/structured-response';

const VerdictSchema = z.object({ passed: z.boolean(), reason: z.string() });

/** A prompt driver whose replies are scripted per attempt; records the prompts it received. */
function scriptedDriver(replies: string[]): {
  prompt: (sessionId: SessionId, text: string) => Promise<TurnResult>;
  prompts: string[];
} {
  const prompts: string[] = [];
  let call = 0;
  return {
    prompts,
    prompt(_sessionId, text) {
      prompts.push(text);
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return Promise.resolve({ stopReason: 'end_turn', text: reply });
    },
  };
}

describe('extractJson', () => {
  it('parses a fenced ```json block, ignoring surrounding prose', () => {
    expect(
      extractJson('Here you go:\n```json\n{"passed": true, "reason": "ok"}\n```\nDone.'),
    ).toEqual({
      passed: true,
      reason: 'ok',
    });
  });

  it('parses a bare balanced object embedded in prose', () => {
    expect(
      extractJson('The verdict is {"passed": false, "reason": "still failing"} overall.'),
    ).toEqual({ passed: false, reason: 'still failing' });
  });

  it('parses a reply that is already bare JSON', () => {
    expect(extractJson('{"passed": true, "reason": "clean"}')).toEqual({
      passed: true,
      reason: 'clean',
    });
  });

  it('handles braces inside strings', () => {
    expect(extractJson('{"reason": "found a { brace", "passed": true}')).toEqual({
      reason: 'found a { brace',
      passed: true,
    });
  });

  it('returns undefined when nothing parses', () => {
    expect(extractJson('no json here at all')).toBeUndefined();
  });
});

describe('promptForStructured', () => {
  it('returns the parsed value on the first usable reply', async () => {
    const driver = scriptedDriver(['{"passed": true, "reason": "done"}']);
    const result = await promptForStructured(driver, 's1' as SessionId, 'judge it', VerdictSchema);
    expect(result).toEqual({ passed: true, reason: 'done' });
    expect(driver.prompts).toHaveLength(1);
  });

  it('re-asks with the validation error until a reply parses', async () => {
    const driver = scriptedDriver(['not json', '{"passed": true, "reason": "fixed"}']);
    const result = await promptForStructured(driver, 's1' as SessionId, 'judge it', VerdictSchema);
    expect(result).toEqual({ passed: true, reason: 'fixed' });
    expect(driver.prompts).toHaveLength(2);
    expect(driver.prompts[1]).toContain('could not be used');
  });

  it('throws once the retry budget is exhausted', async () => {
    const driver = scriptedDriver(['nope']);
    await expect(
      promptForStructured(driver, 's1' as SessionId, 'judge it', VerdictSchema, { maxRetries: 1 }),
    ).rejects.toThrow('could not parse structured output after 2 attempts');
    expect(driver.prompts).toHaveLength(2);
  });
});
