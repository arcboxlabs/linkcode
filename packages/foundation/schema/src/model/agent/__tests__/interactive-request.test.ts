import { describe, expect, it } from 'vitest';
import { AgentEventSchema } from '../event';

const toolCall = { toolCallId: 'tool-1', title: 'Prompt' };

describe('interactive request schemas', () => {
  it('accepts modern tool and command permission subjects', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'permission-request',
        requestId: 'permission-1',
        title: 'Edit file',
        description: 'Update the generated client',
        subject: { type: 'tool-call', toolCallId: 'tool-1' },
        options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
      }).success,
    ).toBe(true);
    expect(
      AgentEventSchema.safeParse({
        type: 'permission-request',
        requestId: 'permission-2',
        title: 'Run command',
        subject: {
          type: 'command',
          command: 'pnpm test',
          cwd: '/repo',
          toolCallId: 'tool-2',
          terminalId: 'terminal-1',
        },
        options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
      }).success,
    ).toBe(true);
  });

  it('accepts the legacy embedded tool call and valid question events', () => {
    expect(
      AgentEventSchema.safeParse({
        type: 'permission-request',
        requestId: 'permission-legacy',
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

  it('rejects a permission request without a complete prompt or legacy tool call', () => {
    const parsed = AgentEventSchema.safeParse({
      type: 'permission-request',
      requestId: 'permission-1',
      title: 'Run command',
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ['subject'] }));
    }
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
