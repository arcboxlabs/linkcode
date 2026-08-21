import type { AgentKind, SessionResource, SessionStatus, WorkspaceKind } from '@linkcode/schema';

export const SHOWCASE_TITLE = 'Mocked streaming showcase';
export const SHOWCASE_TERMINAL_ID = 'mock-terminal-showcase';

export type SeedSessionResource = Omit<
  SessionResource,
  'resourceId' | 'sessionId' | 'createdAt' | 'updatedAt'
> & { ageMs: number };

export interface SeedSession {
  kind: AgentKind;
  cwd: string;
  title: string;
  status: SessionStatus;
  ageMs: number;
  workspaceKind?: WorkspaceKind;
  showcase?: boolean;
  /** Seeds a long settled transcript instead of the scripted showcase (see `long-thread.ts`). */
  longThread?: boolean;
  terminalId?: string;
  resources?: SeedSessionResource[];
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
    resources: [
      {
        direction: 'source',
        name: 'Task resources requirements.md',
        kind: 'document',
        status: 'ready',
        locator: { type: 'managed-file', path: '/mock/resources/task-resources-requirements.md' },
        mimeType: 'text/markdown',
        sizeBytes: 9284,
        ageMs: 110000,
      },
      {
        direction: 'source',
        name: 'CODE-480 · Task Resources Panel',
        kind: 'link',
        status: 'ready',
        locator: {
          type: 'url',
          url: 'https://linear.app/arcbox/issue/CODE-480/featresources-add-the-task-resources-panel',
        },
        ageMs: 80000,
      },
      {
        direction: 'source',
        name: 'LinkCode architecture',
        kind: 'link',
        status: 'ready',
        locator: {
          type: 'url',
          url: 'https://github.com/arcboxlabs/linkcode/blob/master/docs/ARCHITECTURE.md',
        },
        ageMs: 60000,
      },
      {
        direction: 'output',
        name: 'task-resources-implementation.md',
        kind: 'document',
        status: 'ready',
        locator: {
          type: 'workspace-file',
          path: '/mock/linkcode/docs/task-resources-implementation.md',
        },
        mimeType: 'text/markdown',
        sizeBytes: 14820,
        ageMs: 30000,
      },
      {
        direction: 'output',
        name: 'Resources panel prototype',
        kind: 'site',
        status: 'ready',
        locator: { type: 'url', url: 'https://example.com/linkcode/resources-preview' },
        mimeType: 'text/html',
        ageMs: 10000,
      },
    ],
  },
  {
    kind: 'claude-code',
    cwd: '/mock/linkcode',
    title: 'Long thread · navigation testbed',
    status: 'idle',
    ageMs: 8 * 60000,
    longThread: true,
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
    workspaceKind: 'chat',
  },
];
