import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { mergeUpdateFeeds } from '../../scripts/update-feed.mts';

describe('mergeUpdateFeeds', () => {
  it('keeps the first arch as the legacy path and lists both arch artifacts', () => {
    const first = `version: 0.13.1
files:
  - url: LinkCode-0.13.1-x64.zip
    sha512: x64
path: LinkCode-0.13.1-x64.zip
sha512: x64
`;
    const second = `version: 0.13.1
files:
  - url: LinkCode-0.13.1-arm64.zip
    sha512: arm64
path: LinkCode-0.13.1-arm64.zip
sha512: arm64
`;

    expect(parse(mergeUpdateFeeds(first, second))).toEqual({
      version: '0.13.1',
      files: [
        { url: 'LinkCode-0.13.1-x64.zip', sha512: 'x64' },
        { url: 'LinkCode-0.13.1-arm64.zip', sha512: 'arm64' },
      ],
      path: 'LinkCode-0.13.1-x64.zip',
      sha512: 'x64',
    });
  });
});
