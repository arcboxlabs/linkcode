import { describe, expect, it } from 'vitest';
import { parseShellEnvironment } from '../shell-env';

describe('project shell environment', () => {
  it('ignores shell output and parses the marked JSON environment', () => {
    const marker = '0123456789abcdef';
    expect(
      parseShellEnvironment(
        `startup output${marker}${JSON.stringify({
          PATH: '/project/bin',
          TOKEN: 'a=b\nc',
        })}${marker}trailing output`,
        marker,
        '/repo',
      ),
    ).toEqual({ PATH: '/project/bin', TOKEN: 'a=b\nc' });
  });

  it('rejects output without a complete marked environment', () => {
    expect(() => parseShellEnvironment('startup output', 'missing', '/repo')).toThrow(
      'Project shell did not return an environment for /repo',
    );
  });
});
