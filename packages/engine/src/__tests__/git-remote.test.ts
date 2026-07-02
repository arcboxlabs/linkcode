import { describe, expect, it } from 'vitest';
import { parseRemoteIdentity } from '../git/remote';

describe('parseRemoteIdentity', () => {
  it.each([
    ['git@github.com:arcboxlabs/linkcode.git', 'arcboxlabs', 'linkcode'],
    ['git@github.com:arcboxlabs/linkcode', 'arcboxlabs', 'linkcode'],
    ['https://github.com/arcboxlabs/linkcode.git', 'arcboxlabs', 'linkcode'],
    ['https://github.com/arcboxlabs/linkcode', 'arcboxlabs', 'linkcode'],
    ['ssh://git@github.com/arcboxlabs/linkcode.git', 'arcboxlabs', 'linkcode'],
    ['ssh://git@ssh.github.com:443/arcboxlabs/linkcode.git', 'arcboxlabs', 'linkcode'],
    ['git@GitHub.com:arcboxlabs/linkcode.git', 'arcboxlabs', 'linkcode'],
  ])('resolves %s', (url, owner, repo) => {
    expect(parseRemoteIdentity(url)).toEqual({
      provider: 'github',
      host: expect.stringContaining('github.com') as string,
      owner,
      repo,
    });
  });

  it.each([
    // Unsupported hosts stay unresolved until their provider lands.
    'git@gitlab.com:group/project.git',
    'https://bitbucket.org/team/repo.git',
    'https://git.example.com/owner/repo.git',
    // Paths that are not exactly owner/repo.
    'https://github.com/onlyowner',
    'git@github.com:group/sub/repo.git',
    // Not URLs at all.
    '/local/path/repo.git',
    '',
  ])('rejects %s', (url) => {
    expect(parseRemoteIdentity(url)).toBeNull();
  });
});
