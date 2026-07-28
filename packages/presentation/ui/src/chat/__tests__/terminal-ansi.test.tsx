// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TerminalContent } from '../terminal';

afterEach(cleanup);

it('retains emitted ANSI colors and decorations inside the scoped terminal palette', () => {
  const { container } = render(
    <TerminalContent>{'\u{1B}[1;31mfailed\u{1B}[0m plain'}</TerminalContent>,
  );

  const output = container.querySelector('pre.chat-terminal-output');
  const failed = screen.getByText('failed');
  expect(output).not.toBeNull();
  expect(failed.classList.contains('ansi-red-fg')).toBe(true);
  expect(failed.classList.contains('ansi-bold')).toBe(true);
  expect(output?.textContent).toBe('failed plain');
});
