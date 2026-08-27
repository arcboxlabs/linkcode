import { describe, expect, it } from 'vitest';
import { parseShellEnvironment, shellProbeCommand } from '../shell-env';

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

describe('shell probe command', () => {
  it('emits fish syntax for fish and POSIX syntax otherwise', () => {
    expect(shellProbeCommand('/opt/homebrew/bin/fish', 'PRINT_ENV')).toBe(
      'if command -v direnv >/dev/null 2>&1; exec direnv exec "$PWD" PRINT_ENV; else; exec PRINT_ENV; end',
    );
    expect(shellProbeCommand('/bin/zsh', 'PRINT_ENV')).toBe(
      'if command -v direnv >/dev/null 2>&1; then exec direnv exec "$PWD" PRINT_ENV; else exec PRINT_ENV; fi',
    );
    expect(shellProbeCommand('/bin/bash', 'PRINT_ENV')).toContain('then exec');
  });
});
