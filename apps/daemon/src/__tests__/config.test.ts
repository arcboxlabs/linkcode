import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';

let savedHome: string | undefined;

// loadConfig() reads ~/.linkcode/config.json; point HOME at a fresh temp dir per test.
beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-config-'));
});

afterEach(() => {
  process.env.HOME = savedHome;
  vi.restoreAllMocks();
});

function writeConfig(providers: unknown): void {
  const dir = join(process.env.HOME ?? '', '.linkcode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ providers }));
}

describe('loadConfig providers', () => {
  it('keeps valid provider entries and drops an invalid one, logging the error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(noop);
    writeConfig({
      'claude-code': { enabled: true, defaultModel: 'sonnet' },
      codex: { enabled: 'not-a-boolean' },
    });

    const config = loadConfig();

    expect(config.providers).toEqual({
      'claude-code': { enabled: true, defaultModel: 'sonnet' },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('drops an entry keyed by an unknown agent kind, logging the error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(noop);
    writeConfig({
      'claude-code': { enabled: true },
      'not-a-real-agent': { enabled: true },
    });

    const config = loadConfig();

    expect(config.providers).toEqual({
      'claude-code': { enabled: true },
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls back to an empty object when providers is not an object', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(noop);
    writeConfig('nonsense');

    const config = loadConfig();

    expect(config.providers).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it('defaults to an empty object without logging when providers is absent', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(noop);
    writeConfig(undefined);
    // JSON.stringify drops an `undefined` value entirely, so the field is simply missing.

    const config = loadConfig();

    expect(config.providers).toEqual({});
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
