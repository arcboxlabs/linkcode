import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyClaudeSubagentTranscripts } from '../native/claude-code';

const roots: string[] = [];

async function projectsDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'linkcode-claude-projects-'));
  roots.push(root);
  return root;
}

async function transcript(projects: string, project: string, sessionId: string): Promise<void> {
  await mkdir(path.join(projects, project), { recursive: true });
  await writeFile(path.join(projects, project, `${sessionId}.jsonl`), '{"type":"user"}\n');
}

async function subagent(
  projects: string,
  project: string,
  sessionId: string,
  agentId: string,
): Promise<void> {
  const dir = path.join(projects, project, sessionId, 'subagents');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `agent-${agentId}.jsonl`), `{"agent":"${agentId}"}\n`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('copyClaudeSubagentTranscripts', () => {
  it('copies the source subagent transcripts next to the fork child', async () => {
    const projects = await projectsDir();
    await transcript(projects, '-Users-me-repo', 'source');
    await subagent(projects, '-Users-me-repo', 'source', 'a1');
    await subagent(projects, '-Users-me-repo', 'source', 'a2');
    await transcript(projects, '-Users-me-repo', 'child');

    expect(await copyClaudeSubagentTranscripts(projects, 'source', 'child')).toBe(true);

    const copied = path.join(projects, '-Users-me-repo', 'child', 'subagents');
    expect((await readdir(copied)).sort()).toEqual(['agent-a1.jsonl', 'agent-a2.jsonl']);
    expect(await readFile(path.join(copied, 'agent-a2.jsonl'), 'utf8')).toBe('{"agent":"a2"}\n');
    // The source keeps its own.
    expect(
      await readdir(path.join(projects, '-Users-me-repo', 'source', 'subagents')),
    ).toHaveLength(2);
  });

  it('finds the child in another project directory and copies nothing when the source has none', async () => {
    const projects = await projectsDir();
    await transcript(projects, '-Users-me-repo', 'source');
    await transcript(projects, '-Users-me-other', 'child');

    expect(await copyClaudeSubagentTranscripts(projects, 'source', 'child')).toBe(false);
    expect(await readdir(path.join(projects, '-Users-me-other'))).toEqual(['child.jsonl']);

    await subagent(projects, '-Users-me-repo', 'source', 'a1');
    expect(await copyClaudeSubagentTranscripts(projects, 'source', 'child')).toBe(true);
    expect(await readdir(path.join(projects, '-Users-me-other', 'child', 'subagents'))).toEqual([
      'agent-a1.jsonl',
    ]);
  });

  it('copies nothing for an unknown child, a missing projects dir, or a path-shaped id', async () => {
    const projects = await projectsDir();
    await transcript(projects, '-Users-me-repo', 'source');
    await subagent(projects, '-Users-me-repo', 'source', 'a1');

    expect(await copyClaudeSubagentTranscripts(projects, 'source', 'child')).toBe(false);
    expect(
      await copyClaudeSubagentTranscripts(path.join(projects, 'nope'), 'source', 'child'),
    ).toBe(false);
    expect(await copyClaudeSubagentTranscripts(projects, '../source', 'child')).toBe(false);
    expect(await copyClaudeSubagentTranscripts(projects, 'source', '../../child')).toBe(false);
  });
});
