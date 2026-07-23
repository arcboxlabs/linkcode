import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, QuestionOutcome } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
  resolveSettings: () => Promise.resolve({ effective: {} }),
}));

// Keep settingsDefaultMode away from the developer's real ~/.claude/settings.json.
vi.mock('node:fs/promises', () => ({
  readFile: (file: string) => Promise.reject(new Error(`ENOENT: ${file}`)),
}));

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string },
) => Promise<Record<string, unknown>>;

interface QueryInput {
  prompt: AsyncIterable<SDKUserMessage>;
  options: { canUseTool: CanUseTool };
}

/** Never-yielding Query stand-in: only the creation options matter — the tests drive the captured
 * `canUseTool` callback directly instead of feeding SDK messages. */
class FakeQuery {
  readonly options: QueryInput['options'];

  constructor(input: QueryInput) {
    this.options = input.options;
    void (async () => {
      for await (const _ of input.prompt) void _;
    })();
  }

  // eslint-disable-next-line require-yield -- deliberately pending: tests never consume messages
  async *[Symbol.asyncIterator](): AsyncGenerator<never> {
    // Park the consume loop for the test's lifetime.
    await new Promise(noop);
  }
}

const queries: FakeQuery[] = [];

sdkMock.query = (opts) => {
  const q = new FakeQuery(opts as QueryInput);
  queries.push(q);
  return q;
};

afterEach(() => {
  queries.length = 0;
});

const QUESTION_INPUT = {
  questions: [
    {
      question: 'Which library should we use?',
      header: 'Library',
      options: [
        { label: 'foxts', description: 'Already adopted.' },
        { label: 'lodash', description: 'Familiar but heavy.' },
      ],
    },
    {
      question: 'Which features do you want to enable?',
      header: 'Features',
      multiSelect: true,
      options: [{ label: 'Cache' }, { label: 'Retry' }, { label: 'Tracing' }],
    },
  ],
};

interface Harness {
  adapter: ClaudeCodeAdapter;
  events: AgentEvent[];
  canUseTool: CanUseTool;
}

async function makeHarness(): Promise<Harness> {
  const adapter = new ClaudeCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'claude-code', cwd: '/tmp/repo' });
  await adapter.send({ type: 'prompt', content: [textBlock('hi')] });
  return { adapter, events, canUseTool: queries[0].options.canUseTool };
}

/** Ask, wait for the emitted question-request, and answer it — the full round-trip. */
async function askAndAnswer(
  harness: Harness,
  outcome: QuestionOutcome,
): Promise<Record<string, unknown>> {
  const result = harness.canUseTool('AskUserQuestion', QUESTION_INPUT, askOptions());
  await wait(0);
  const request = harness.events.findLast((e) => e.type === 'question-request');
  expect(request).toBeDefined();
  await harness.adapter.send({
    type: 'question-response',
    requestId: request!.requestId,
    outcome,
  });
  return result;
}

function askOptions(): { signal: AbortSignal; toolUseID: string } {
  return { signal: new AbortController().signal, toolUseID: 'toolu_ask1' };
}

describe('ClaudeCodeAdapter AskUserQuestion', () => {
  it('emits a question-request mapped from the tool input', async () => {
    const { events, canUseTool } = await makeHarness();
    void canUseTool('AskUserQuestion', QUESTION_INPUT, askOptions());
    await wait(0);

    const request = events.findLast((e) => e.type === 'question-request');
    expect(request).toBeDefined();
    expect(request!.toolCall.toolCallId).toBe('toolu_ask1');
    expect(request!.questions).toEqual([
      {
        questionId: 'q0',
        prompt: 'Which library should we use?',
        header: 'Library',
        multiSelect: false,
        options: [
          { optionId: 'o0', label: 'foxts', description: 'Already adopted.' },
          { optionId: 'o1', label: 'lodash', description: 'Familiar but heavy.' },
        ],
      },
      {
        questionId: 'q1',
        prompt: 'Which features do you want to enable?',
        header: 'Features',
        multiSelect: true,
        options: [
          { optionId: 'o0', label: 'Cache', description: undefined },
          { optionId: 'o1', label: 'Retry', description: undefined },
          { optionId: 'o2', label: 'Tracing', description: undefined },
        ],
      },
    ]);
  });

  it('folds answers back into updatedInput keyed by question text (multi-select comma-joined)', async () => {
    const harness = await makeHarness();
    const result = await askAndAnswer(harness, {
      outcome: 'answered',
      answers: [
        { questionId: 'q0', selectedOptionIds: ['o0'] },
        { questionId: 'q1', selectedOptionIds: ['o0', 'o2'] },
      ],
    });

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        ...QUESTION_INPUT,
        answers: {
          'Which library should we use?': 'foxts',
          'Which features do you want to enable?': 'Cache, Tracing',
        },
      },
    });
  });

  it('prefers free text over selections for a question answered with customText', async () => {
    const harness = await makeHarness();
    const result = await askAndAnswer(harness, {
      outcome: 'answered',
      answers: [
        { questionId: 'q0', selectedOptionIds: [], customText: 'use the stdlib' },
        { questionId: 'q1', selectedOptionIds: ['o1'] },
      ],
    });

    expect(result).toMatchObject({
      updatedInput: {
        answers: {
          'Which library should we use?': 'use the stdlib',
          'Which features do you want to enable?': 'Retry',
        },
      },
    });
  });

  it('omits skipped questions from the folded answers so the CLI reports them unanswered', async () => {
    const harness = await makeHarness();
    const result = await askAndAnswer(harness, {
      outcome: 'answered',
      answers: [
        { questionId: 'q0', selectedOptionIds: [] },
        { questionId: 'q1', selectedOptionIds: ['o1'] },
      ],
    });

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        ...QUESTION_INPUT,
        answers: {
          'Which features do you want to enable?': 'Retry',
        },
      },
    });
  });

  it('denies with the CLI-native decline message when cancelled', async () => {
    const harness = await makeHarness();
    const result = await askAndAnswer(harness, { outcome: 'cancelled' });

    expect(result).toEqual({
      behavior: 'deny',
      message: 'User declined to answer questions',
    });
  });

  it('falls back to the generic permission ask when the input shape drifted', async () => {
    const { events, canUseTool } = await makeHarness();
    void canUseTool('AskUserQuestion', { questions: 'not-an-array' }, askOptions());
    await wait(0);

    expect(events.some((e) => e.type === 'question-request')).toBe(false);
    const toolIndex = events.findIndex(
      (event) => event.type === 'tool-call' && event.toolCall.toolCallId === 'toolu_ask1',
    );
    const requestIndex = events.findIndex((event) => event.type === 'permission-request');
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(requestIndex).toBeGreaterThan(toolIndex);
    expect(events[requestIndex]).toMatchObject({
      title: 'AskUserQuestion',
      subject: { type: 'tool-call', toolCallId: 'toolu_ask1' },
    });
    expect(events[requestIndex]).not.toHaveProperty('toolCall');
  });
});
