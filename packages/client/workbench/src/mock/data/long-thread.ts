import type { AgentEvent, MessageId } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';

/** Enough turns to overflow the conversation minimap's rail, which only scrolls past ~38 of them. */
export const LONG_THREAD_TURNS = 48;

const SUBJECTS = [
  'the reconnect backoff',
  'the wire envelope',
  'the fleet table query',
  'the PTY sidecar handshake',
  'the artifact viewer',
  'the approval policy',
  'the compaction marker',
  'the terminal credit window',
];

const ASKS = [
  'Walk me through',
  'What breaks in',
  'Summarize',
  'Find the regression in',
  'Explain the invariant behind',
];

/**
 * A long settled transcript, so surfaces that only misbehave at length — the minimap rail, the
 * virtualizer's windowing — are reachable in dev without a real agent. Turn bodies vary in size on
 * purpose: a rail whose ticks all look alike hides nothing.
 */
export function createLongThreadScript(messageId: (slug: string) => MessageId): AgentEvent[] {
  const script: AgentEvent[] = [{ type: 'status', status: 'running' }];
  for (let turn = 0; turn < LONG_THREAD_TURNS; turn++) {
    const subject = SUBJECTS[turn % SUBJECTS.length];
    const ask = ASKS[turn % ASKS.length];
    script.push(
      {
        type: 'user-message',
        messageId: messageId(`mock-long-user-${turn}`),
        content: [textBlock(`${ask} ${subject}.`)],
      },
      {
        type: 'agent-message-chunk',
        messageId: messageId(`mock-long-reply-${turn}`),
        content: textBlock(replyBody(turn, subject)),
      },
    );
  }
  script.push({ type: 'stop', stopReason: 'end_turn' }, { type: 'status', status: 'idle' });
  return script;
}

function replyBody(turn: number, subject: string): string {
  const lines = [`Turn ${turn + 1} — notes on ${subject}.`, ''];
  // Every third turn is a long one, so the rail shows an uneven, realistic rhythm.
  const paragraphs = turn % 3 === 0 ? 4 : 1;
  for (let i = 0; i < paragraphs; i++) {
    lines.push(
      `${subject} settles once the caller owns the retry budget; paragraph ${i + 1} of turn ${turn + 1} exists to give this reply real height.`,
      '',
    );
  }
  if (turn % 4 === 0) lines.push('- one', '- two', '- three', '');
  return lines.join('\n');
}
