import { describe, expect, it } from 'vitest';
import { parseShellEnvironment } from '../process-environment';

describe('project shell environment', () => {
  it('ignores shell output and parses NUL-delimited values without truncating equals signs', () => {
    expect(
      parseShellEnvironment(
        'startup output\u{1E}LINKCODE_ENV\u{1F}PATH=/project/bin\0TOKEN=a=b\0',
        '/repo',
      ),
    ).toEqual({ PATH: '/project/bin', TOKEN: 'a=b' });
  });
});
