import { describe, expect, it } from 'vitest';
import { windowsPathFromPosix } from '../windows-path';

describe('windowsPathFromPosix', () => {
  it('rewrites MSYS drive-form paths', () => {
    expect(windowsPathFromPosix('/c/Users/flynn/Desktop/yose-chat/AGENTS.md')).toBe(
      String.raw`C:\Users\flynn\Desktop\yose-chat\AGENTS.md`,
    );
    expect(windowsPathFromPosix('/d/work')).toBe(String.raw`D:\work`);
    expect(windowsPathFromPosix('/c')).toBe('C:\\');
    expect(windowsPathFromPosix('/c/')).toBe('C:\\');
  });

  it('rewrites Cygwin drive-form paths', () => {
    expect(windowsPathFromPosix('/cygdrive/c/Users/foo')).toBe(String.raw`C:\Users\foo`);
    expect(windowsPathFromPosix('/cygdrive/d')).toBe('D:\\');
  });

  it('passes every other shape through untouched', () => {
    expect(windowsPathFromPosix('/usr/bin/git')).toBe('/usr/bin/git');
    expect(windowsPathFromPosix('C:/Users/foo')).toBe('C:/Users/foo');
    expect(windowsPathFromPosix(String.raw`C:\Users\foo`)).toBe(String.raw`C:\Users\foo`);
    expect(windowsPathFromPosix('src/foo.ts')).toBe('src/foo.ts');
    expect(windowsPathFromPosix('//server/share')).toBe('//server/share');
    expect(windowsPathFromPosix('/cygdrive/toolong/foo')).toBe('/cygdrive/toolong/foo');
  });
});
