import { WorkspaceRecordSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

const base = {
  workspaceId: 'ws-1',
  cwd: '/repo',
  createdAt: 1,
  lastUsedAt: 2,
};

describe('WorkspaceRecordSchema', () => {
  it('keeps legacy absent-kind project records valid', () => {
    expect(WorkspaceRecordSchema.safeParse(base).success).toBe(true);
  });

  it('requires parentWorkspaceId only for worktree records', () => {
    expect(
      WorkspaceRecordSchema.safeParse({
        ...base,
        kind: 'worktree',
        parentWorkspaceId: 'ws-parent',
      }).success,
    ).toBe(true);
    expect(WorkspaceRecordSchema.safeParse({ ...base, kind: 'worktree' }).success).toBe(false);
    expect(
      WorkspaceRecordSchema.safeParse({
        ...base,
        kind: 'project',
        parentWorkspaceId: 'ws-parent',
      }).success,
    ).toBe(false);
    expect(
      WorkspaceRecordSchema.safeParse({
        ...base,
        kind: 'chat',
        parentWorkspaceId: 'ws-parent',
      }).success,
    ).toBe(false);
  });
});
