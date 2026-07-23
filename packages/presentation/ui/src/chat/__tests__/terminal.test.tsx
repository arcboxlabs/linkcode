// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TerminalContent } from '../terminal';

vi.mock('ansi-to-react', () => ({
  default: {
    default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
  },
}));

afterEach(cleanup);

it('renders output when the ANSI component is wrapped by its CommonJS default export', () => {
  render(<TerminalContent>command output</TerminalContent>);

  expect(screen.getByText('command output')).toBeDefined();
});

it('drops trailing newlines so PTY tails do not render as blank panel space', () => {
  const { container } = render(<TerminalContent>{'line one\nline two\n\r\n\n'}</TerminalContent>);

  expect(container.querySelector('pre')?.textContent).toBe('line one\nline two');
});

it('keeps meaningful trailing spaces on the last content line', () => {
  const { container } = render(<TerminalContent>{'Password: \n'}</TerminalContent>);

  expect(container.querySelector('pre')?.textContent).toBe('Password: ');
});
