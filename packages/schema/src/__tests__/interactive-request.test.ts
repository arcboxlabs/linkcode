import { describe, expect, it } from 'vitest';
import { AgentEventSchema } from '../agent';
import { WIRE_PROTOCOL_VERSION, WireMessageSchema } from '../wire';

const toolCall = { toolCallId: 'tool-1', title: 'Prompt' };

describe('interactive request schemas', () => {
  it.each([
    {
      type: 'prompt-response-status',
      requestId: 'permission-1',
      status: 'responding',
    },
    {
      type: 'permission-resolved',
      requestId: 'permission-1',
      outcome: { outcome: 'selected', optionId: 'allow' },
      source: 'user',
    },
    {
      type: 'question-resolved',
      requestId: 'question-1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    },
  ])('accepts $type through the complete wire envelope', (event) => {
    expect(
      WireMessageSchema.safeParse({
        v: WIRE_PROTOCOL_VERSION,
        id: 'message-1',
        ts: 0,
        payload: { kind: 'agent.event', sessionId: 'session-1', event },
      }).success,
    ).toBe(true);
  });

  it('accepts valid permission and question events through AgentEventSchema', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'permission-request',
        requestId: 'permission-1',
        toolCall,
        options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
      }).success,
    ).toBe(true);
    expect(
      AgentEventSchema.safeParse({
        type: 'question-request',
        requestId: 'question-1',
        toolCall,
        questions: [
          {
            questionId: 'scope',
            prompt: 'How broad?',
            header: 'Scope',
            multiSelect: false,
            options: [{ optionId: 'focused', label: 'Focused' }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      options: [],
      label: 'no options',
      path: ['options'],
    },
    {
      options: [{ optionId: '', name: 'Allow', kind: 'allow_once' }],
      label: 'empty option ID',
      path: ['options', 0, 'optionId'],
    },
    {
      options: [
        { optionId: 'same', name: 'Allow', kind: 'allow_once' },
        { optionId: 'same', name: 'Reject', kind: 'reject_once' },
      ],
      label: 'duplicate option ID',
      path: ['options', 1, 'optionId'],
    },
    {
      options: [{ optionId: 'allow', name: '  ', kind: 'allow_once' }],
      label: 'empty label',
      path: ['options', 0, 'name'],
    },
  ])('rejects a permission request with $label', ({ options, path }) => {
    const parsed = AgentEventSchema.safeParse({
      type: 'permission-request',
      requestId: 'permission-1',
      toolCall,
      options,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path }));
    }
  });

  it.each([
    {
      questions: [],
      path: ['questions'],
    },
    {
      questions: [
        {
          questionId: 'same',
          prompt: 'First',
          multiSelect: false,
          options: [{ optionId: 'a', label: 'A' }],
        },
        {
          questionId: 'same',
          prompt: 'Second',
          multiSelect: false,
          options: [{ optionId: 'b', label: 'B' }],
        },
      ],
      path: ['questions', 1, 'questionId'],
    },
    {
      questions: [
        {
          questionId: 'scope',
          prompt: 'Choose',
          multiSelect: false,
          options: [
            { optionId: 'same', label: 'A' },
            { optionId: 'same', label: 'B' },
          ],
        },
      ],
      path: ['questions', 0, 'options', 1, 'optionId'],
    },
    {
      questions: [
        {
          questionId: 'scope',
          prompt: 'Choose',
          multiSelect: false,
          options: [],
        },
      ],
      path: ['questions', 0, 'options'],
    },
    {
      questions: [
        {
          questionId: 'scope',
          prompt: 'Choose',
          multiSelect: false,
          options: [{ optionId: '', label: 'A' }],
        },
      ],
      path: ['questions', 0, 'options', 0, 'optionId'],
    },
  ])('rejects invalid question or option IDs', ({ questions, path }) => {
    const parsed = AgentEventSchema.safeParse({
      type: 'question-request',
      requestId: 'question-1',
      toolCall,
      questions,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path }));
    }
  });
});
