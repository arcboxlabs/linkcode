import type { AgentKind, SessionStatus } from '@linkcode/schema';

export const SHOWCASE_TITLE = 'Mocked streaming showcase';
export const SHOWCASE_TERMINAL_ID = 'mock-terminal-showcase';

export interface SeedSession {
  kind: AgentKind;
  cwd: string;
  title: string;
  status: SessionStatus;
  ageMs: number;
  showcase?: boolean;
  terminalId?: string;
}

/** Canned sessions the host boots with, so the session list and resume flows aren't empty. */
export const SEED_SESSIONS: SeedSession[] = [
  {
    kind: 'codex',
    cwd: '/mock/linkcode',
    title: SHOWCASE_TITLE,
    status: 'running',
    ageMs: 2 * 60000,
    showcase: true,
    terminalId: SHOWCASE_TERMINAL_ID,
  },
  {
    kind: 'claude-code',
    cwd: '/mock/linkcode',
    title: 'Wire the workbench to the daemon',
    status: 'idle',
    ageMs: 20 * 60000,
  },
  {
    kind: 'codex',
    cwd: '/mock/linkcode',
    title: 'Refactor transport reconnect backoff',
    status: 'idle',
    ageMs: 2 * 3_600_000,
  },
  {
    kind: 'claude-code',
    cwd: '/mock/platform',
    title: 'Migrate fleet tables to the sdk',
    status: 'stopped',
    ageMs: 26 * 3_600_000,
  },
  {
    kind: 'opencode',
    cwd: '/mock/scratch',
    title: 'Prototype without git',
    status: 'idle',
    ageMs: 72 * 3_600_000,
  },
];
