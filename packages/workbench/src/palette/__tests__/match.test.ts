import type { SessionId, SessionInfo, SessionStatus } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import type { PaletteCommand, PaletteThreadCandidate } from '../match';
import { matchPaletteCommands, matchPaletteThreads } from '../match';

function candidate(
  title: string,
  opts: {
    updatedAt?: number;
    status?: SessionStatus;
    workspaceLabel?: string | null;
  } = {},
): PaletteThreadCandidate {
  const session: SessionInfo = {
    sessionId: `s-${title}` as SessionId,
    kind: 'codex',
    cwd: '/repo',
    status: opts.status ?? 'idle',
    createdAt: 0,
    updatedAt: opts.updatedAt ?? 0,
  };
  return { session, title, workspaceLabel: opts.workspaceLabel ?? null };
}

function titles(results: readonly PaletteThreadCandidate[]): string[] {
  return results.map((result) => result.title);
}

describe('matchPaletteThreads', () => {
  it('orders the empty query by awaiting-input first, then recency, and caps the list', () => {
    const candidates = [
      candidate('old', { updatedAt: 1 }),
      candidate('newest', { updatedAt: 9 }),
      candidate('waiting', { updatedAt: 2, status: 'awaiting-input' }),
      candidate('mid', { updatedAt: 5 }),
    ];

    expect(titles(matchPaletteThreads(candidates, ''))).toEqual([
      'waiting',
      'newest',
      'mid',
      'old',
    ]);
    expect(titles(matchPaletteThreads(candidates, '', 2))).toEqual(['waiting', 'newest']);
  });

  it('ranks exact > prefix > substring > all-tokens on the title', () => {
    const candidates = [
      candidate('fix lint in ci'), // token-AND for "fix ci"
      candidate('fix ci flake'), // prefix
      candidate('fix ci'), // exact
      candidate('quick fix ci'), // substring
    ];

    expect(titles(matchPaletteThreads(candidates, 'fix ci'))).toEqual([
      'fix ci',
      'fix ci flake',
      'quick fix ci',
      'fix lint in ci',
    ]);
  });

  it('matches CJK titles by substring and drops non-matches', () => {
    const candidates = [
      candidate('为网站添加 TOS 和隐私条款'),
      candidate('打开浏览器'),
      candidate('unrelated'),
    ];

    expect(titles(matchPaletteThreads(candidates, '隐私'))).toEqual(['为网站添加 TOS 和隐私条款']);
  });

  it('ranks any title match above any workspace match, and searches the workspace label', () => {
    const candidates = [
      candidate('deploy pipeline', { workspaceLabel: 'linkcode', updatedAt: 9 }),
      candidate('linkcode palette', { workspaceLabel: 'arcbox', updatedAt: 1 }),
    ];

    expect(titles(matchPaletteThreads(candidates, 'linkcode'))).toEqual([
      'linkcode palette',
      'deploy pipeline',
    ]);
  });

  it('breaks score ties by recency, then shorter title', () => {
    const candidates = [
      candidate('fix a very long title', { updatedAt: 5 }),
      candidate('fix short', { updatedAt: 5 }),
      candidate('fix fresher', { updatedAt: 7 }),
    ];

    expect(titles(matchPaletteThreads(candidates, 'fix'))).toEqual([
      'fix fresher',
      'fix short',
      'fix a very long title',
    ]);
  });
});

function command(label: string, keywords?: readonly string[]): PaletteCommand {
  return { id: label, label, keywords, run: noop };
}

describe('matchPaletteCommands', () => {
  it('returns every command in registration order for the empty query', () => {
    const commands = [command('Open folder…'), command('Settings')];
    expect(matchPaletteCommands(commands, '').map((entry) => entry.id)).toEqual([
      'Open folder…',
      'Settings',
    ]);
  });

  it('scores labels above keyword hits and drops non-matches', () => {
    const commands = [
      command('Toggle sidebar', ['panel']),
      command('Settings', ['preferences', 'panel']),
      command('New thread'),
    ];

    expect(matchPaletteCommands(commands, 'panel').map((entry) => entry.id)).toEqual([
      'Toggle sidebar',
      'Settings',
    ]);
    expect(matchPaletteCommands(commands, 'settings').map((entry) => entry.id)).toEqual([
      'Settings',
    ]);
  });
});
