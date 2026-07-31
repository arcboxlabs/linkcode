import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexConfiguredSandbox } from '../native/codex';

/** Exercises the real config.toml read + parse + profile/top-level resolution through a throwaway
 * `CODEX_HOME` — mocking the parser would test nothing. */
describe('codexConfiguredSandbox', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codex-cfg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const writeConfig = (toml: string): Promise<void> => writeFile(join(dir, 'config.toml'), toml);
  const readConfigured = () => codexConfiguredSandbox({ CODEX_HOME: dir });

  it('returns undefined when config.toml is absent', async () => {
    expect(await readConfigured()).toBeUndefined();
  });

  it('reads a top-level sandbox_mode', async () => {
    await writeConfig('sandbox_mode = "read-only"\n[projects."/x"]\ntrust_level = "trusted"\n');
    expect(await readConfigured()).toBe('read-only');
  });

  it('does not mistake a sandbox_mode nested in another table for the top-level one', async () => {
    await writeConfig('[projects."/x"]\nsandbox_mode = "danger-full-access"\n');
    expect(await readConfigured()).toBeUndefined();
  });

  it('prefers the active profile over the top-level value', async () => {
    await writeConfig(
      'sandbox_mode = "workspace-write"\nprofile = "safe"\n[profiles.safe]\nsandbox_mode = "read-only"\n',
    );
    expect(await readConfigured()).toBe('read-only');
  });

  it('ignores a sandbox_mode from a profile that is not the active one', async () => {
    await writeConfig(
      'profile = "a"\n[profiles.a]\nmodel = "o3"\n[profiles.b]\nsandbox_mode = "read-only"\n',
    );
    expect(await readConfigured()).toBeUndefined();
  });

  it('rejects a value outside the sandbox enum', async () => {
    await writeConfig('sandbox_mode = "bogus"\n');
    expect(await readConfigured()).toBeUndefined();
  });

  it('returns undefined on malformed TOML instead of throwing', async () => {
    await writeConfig('sandbox_mode = "read-only\n[unclosed');
    expect(await readConfigured()).toBeUndefined();
  });
});
