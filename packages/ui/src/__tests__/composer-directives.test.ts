import type { AgentCommand } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { parseComposerDirective } from '../shell/composer-directives';

const CATALOG: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', argumentHint: '<pr>' },
];

describe('parseComposerDirective', () => {
  it('matches a catalog command with and without arguments', () => {
    expect(parseComposerDirective('/compact', { commands: CATALOG, shellEnabled: false })).toEqual({
      kind: 'command',
      name: 'compact',
      arguments: undefined,
    });
    expect(
      parseComposerDirective('/review src/index.ts  ', { commands: CATALOG, shellEnabled: false }),
    ).toEqual({ kind: 'command', name: 'review', arguments: 'src/index.ts' });
  });

  it('keeps a slash token outside the catalog as plain text (pass-through preserved)', () => {
    expect(parseComposerDirective('/unknown', { commands: CATALOG, shellEnabled: false })).toEqual({
      kind: 'text',
    });
    expect(parseComposerDirective('/tmp is full', { commands: [], shellEnabled: false })).toEqual({
      kind: 'text',
    });
  });

  it('does not match a command name embedded mid-text', () => {
    expect(
      parseComposerDirective('run /compact please', { commands: CATALOG, shellEnabled: false }),
    ).toEqual({ kind: 'text' });
  });

  it('parses $ as a shell directive only when enabled, tolerating both $cmd and $ cmd', () => {
    expect(parseComposerDirective('$ git status', { commands: [], shellEnabled: true })).toEqual({
      kind: 'shell',
      command: 'git status',
    });
    expect(parseComposerDirective('$ls', { commands: [], shellEnabled: true })).toEqual({
      kind: 'shell',
      command: 'ls',
    });
    expect(parseComposerDirective('$ git status', { commands: [], shellEnabled: false })).toEqual({
      kind: 'text',
    });
  });

  it('keeps a bare $ (or $ with only whitespace) as text', () => {
    expect(parseComposerDirective('$', { commands: [], shellEnabled: true })).toEqual({
      kind: 'text',
    });
  });
});
