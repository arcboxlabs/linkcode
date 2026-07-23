import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import automation from './release-automation.cjs';

const SHA = 'a'.repeat(40);

function harness({ labels = ['autorelease: pending'], releases = [], tag } = {}) {
  const pull = {
    number: 42,
    base: { ref: 'master' },
    head: { ref: 'release-please--branches--master--components--desktop' },
    labels: labels.map((name) => ({ name })),
    merge_commit_sha: SHA,
    merged_at: '2026-07-23T00:00:00Z',
  };
  const outputs = {};
  const github = {
    paginate: vi.fn((method) => (method === github.rest.repos.listReleases ? releases : [pull])),
    rest: {
      git: {
        getRef: vi.fn(() => {
          if (!tag) throw Object.assign(new Error('missing'), { status: 404 });
          return { data: { object: { sha: tag } } };
        }),
      },
      issues: { addLabels: vi.fn(), removeLabel: vi.fn() },
      pulls: { list: vi.fn() },
      repos: {
        getContent: vi.fn(({ path }) => ({
          data: {
            type: 'file',
            sha: 'blob',
            content: Buffer.from(
              path === 'apps/desktop/package.json' ? '{"version":"0.6.4"}' : '{}',
            ).toString('base64'),
          },
        })),
        listPullRequestsAssociatedWithCommit: vi.fn(() => ({ data: [pull] })),
        listReleases: vi.fn(),
      },
    },
  };
  return {
    core: {
      setOutput(name, value) {
        outputs[name] = value;
      },
    },
    github,
    outputs,
  };
}

describe('release automation', () => {
  it('resolves the exact pending release PR', async () => {
    const { core, github, outputs } = harness();
    await automation.resolveCandidate({
      core,
      github,
      owner: 'arcboxlabs',
      repo: 'linkcode',
      testedSha: SHA,
    });
    expect(outputs).toEqual({ sha: SHA, tag: 'v0.6.4', state: 'pending' });
  });

  it('recovers lifecycle labels after the tag and Release exist', async () => {
    const releases = [{ tag_name: 'v0.6.4', target_commitish: SHA }];
    const { core, github, outputs } = harness({ labels: [], releases, tag: SHA });
    await automation.resolveCandidate({
      core,
      github,
      owner: 'arcboxlabs',
      repo: 'linkcode',
      testedSha: SHA,
    });
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['autorelease: tagged'] }),
    );
    expect(outputs.state).toBe('done');
  });

  it('rejects release policy drift after the tested merge', async () => {
    const { github } = harness();
    github.rest.repos.getContent
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'tested' } })
      .mockResolvedValueOnce({ data: { type: 'file', sha: 'current' } });
    await expect(
      automation.verifyConfig({ github, owner: 'arcboxlabs', repo: 'linkcode', testedSha: SHA }),
    ).rejects.toThrow('changed after CI-tested release candidate');
  });

  it('requires the Desktop Release to target the tag SHA', async () => {
    const releases = [{ tag_name: 'v0.6.4', target_commitish: 'b'.repeat(40) }];
    const { github } = harness({ releases });
    await expect(
      automation.verifyDesktopRelease({
        github,
        owner: 'arcboxlabs',
        repo: 'linkcode',
        sha: SHA,
        tag: 'v0.6.4',
      }),
    ).rejects.toThrow(`expected ${SHA}`);
  });
});
