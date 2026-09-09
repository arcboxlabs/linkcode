// @vitest-environment jsdom
import type { Question } from '@linkcode/schema';
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useQuestionResponse } from '../use-question-response';

const questions: Question[] = [
  {
    questionId: 'scope',
    prompt: 'Scope?',
    multiSelect: false,
    options: [
      { optionId: 'small', label: 'Small' },
      { optionId: 'large', label: 'Large' },
    ],
  },
  {
    questionId: 'checks',
    prompt: 'Checks?',
    multiSelect: true,
    options: [
      { optionId: 'unit', label: 'Unit' },
      { optionId: 'native', label: 'Native' },
    ],
  },
];

it('preserves earlier answers when navigating back and submits the entire batch', () => {
  const respond = vi.fn();
  const { result } = renderHook(() => useQuestionResponse(questions, false, respond));
  act(() => result.current.selectOption('small'));
  expect(result.current.current).toBe(2);
  act(() => result.current.selectOption('unit'));
  act(() => result.current.selectOption('native'));
  act(() => result.current.previous(result.current.draft));
  expect(result.current.draft.selected).toEqual(['small']);
  act(() => result.current.selectOption('large'));
  expect(result.current.draft.selected).toEqual(['unit', 'native']);
  act(() => result.current.selectOption('unit'));
  act(() => result.current.advance(result.current.draft));
  expect(respond).toHaveBeenCalledExactlyOnceWith({
    outcome: 'answered',
    answers: [
      { questionId: 'scope', selectedOptionIds: ['large'] },
      { questionId: 'checks', selectedOptionIds: ['native'] },
    ],
  });
});

it('preserves native text across back navigation and gives custom text precedence over choices', () => {
  const respond = vi.fn();
  const { result } = renderHook(() => useQuestionResponse(questions, false, respond));
  act(() => result.current.selectOption('small'));
  act(() => result.current.previous({ selected: ['unit'], customText: '  Smoke tests  ' }));
  act(() => result.current.selectOption('small'));
  expect(result.current.draft.customText).toBe('  Smoke tests  ');
  act(() => result.current.advance(result.current.draft));
  expect(respond.mock.calls[0][0].answers[1]).toEqual({
    questionId: 'checks',
    selectedOptionIds: [],
    customText: 'Smoke tests',
  });
});

it('locks edits and navigation while responding and allows retry afterward', () => {
  const respond = vi.fn();
  const { result, rerender } = renderHook(
    ({ responding }) => useQuestionResponse(questions, responding, respond),
    { initialProps: { responding: false } },
  );
  act(() => result.current.selectOption('small'));
  rerender({ responding: true });
  act(() => {
    result.current.selectOption('unit');
    result.current.setDraft({ selected: [], customText: 'late edit' });
    result.current.previous(result.current.draft);
    result.current.advance(result.current.draft);
  });
  expect(result.current.current).toBe(2);
  expect(result.current.draft).toEqual({ selected: [], customText: '' });
  expect(respond).not.toHaveBeenCalled();
  rerender({ responding: false });
  act(() => result.current.advance(result.current.draft));
  expect(respond).toHaveBeenCalledOnce();
});
