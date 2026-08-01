import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexConfiguredModel, codexConfiguredSandbox } from '../native/codex';

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

describe('codexConfiguredModel', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codex-cfg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const writeConfig = (toml: string): Promise<void> => writeFile(join(dir, 'config.toml'), toml);
  const readConfigured = () => codexConfiguredModel({ CODEX_HOME: dir });

  it('returns nothing when config.toml is absent', async () => {
    expect(await readConfigured()).toEqual({});
  });

  it('reads the top-level model and reasoning effort', async () => {
    await writeConfig('model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
    expect(await readConfigured()).toEqual({ model: 'gpt-5.6-sol', effort: 'high' });
  });

  it('prefers the active profile over the top-level values', async () => {
    await writeConfig(
      'model = "gpt-5.4"\nmodel_reasoning_effort = "low"\nprofile = "deep"\n[profiles.deep]\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "xhigh"\n',
    );
    expect(await readConfigured()).toEqual({ model: 'gpt-5.6-sol', effort: 'xhigh' });
  });

  it('ignores a model from a profile that is not the active one', async () => {
    await writeConfig(
      'profile = "a"\n[profiles.a]\nmodel = "gpt-5.4"\n[profiles.b]\nmodel = "o3"\n',
    );
    expect(await readConfigured()).toEqual({ model: 'gpt-5.4' });
  });

  // `minimal` is a real codex level with no LinkCode equivalent; dropping it leaves the model set.
  it('drops an effort outside LinkCode vocabulary but keeps the model', async () => {
    await writeConfig('model = "gpt-5.4"\nmodel_reasoning_effort = "minimal"\n');
    expect(await readConfigured()).toEqual({ model: 'gpt-5.4' });
  });

  it('does not mistake a model nested in another table for the top-level one', async () => {
    await writeConfig('[projects."/x"]\nmodel = "o3"\n');
    expect(await readConfigured()).toEqual({});
  });

  it('returns nothing on malformed TOML instead of throwing', async () => {
    await writeConfig('model = "gpt-5.4\n[unclosed');
    expect(await readConfigured()).toEqual({});
  });
});
