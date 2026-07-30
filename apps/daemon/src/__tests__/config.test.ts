import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CustomMcpServer } from '@linkcode/schema';
import { DAEMON_DEFAULT_PORT, DAEMON_PORT_HUNT_SPAN, daemonBasePort } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  daemonProfile,
  databasePath,
  hqCredentialsPath,
  loadConfig,
  runtimeFilePath,
  saveCustomMcpServers,
} from '../config';
import { logger } from '../logger';
import { daemonChannel, telemetryConfigCachePath } from '../paths';

let savedHome: string | undefined;

// loadConfig() reads the channel's config.json; point HOME at a fresh temp dir per test. The
// channel is pinned to release so these cases keep asserting plain `~/.linkcode` — running the TS
// source would otherwise resolve as development. The channel axis itself is covered further down.
beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-config-'));
  process.env.LINKCODE_CHANNEL = 'release';
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_PROFILE;
  delete process.env.LINKCODE_CHANNEL;
  vi.restoreAllMocks();
});

function writeConfig(providers: unknown): void {
  const dir = join(process.env.HOME ?? '', '.linkcode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ providers }));
}

function writeAccountsConfig(accounts: unknown): void {
  const dir = join(process.env.HOME ?? '', '.linkcode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ accounts }));
}

const validAccount = {
  id: 'acc_1',
  label: 'Personal key',
  credential: { type: 'api-key', key: 'sk-test' },
  createdAt: 0,
};

describe('loadConfig providers', () => {
  it('keeps valid provider entries and drops an invalid one, logging the error', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
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
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
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
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeConfig('nonsense');

    const config = loadConfig();

    expect(config.providers).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it('defaults to an empty object without logging when providers is absent', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeConfig(undefined);
    // JSON.stringify drops an `undefined` value entirely, so the field is simply missing.

    const config = loadConfig();

    expect(config.providers).toEqual({});
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('profile-scoped state paths', () => {
  it('resolves under ~/.linkcode for the default profile', () => {
    expect(daemonProfile()).toBeUndefined();
    expect(databasePath()).toBe(join(process.env.HOME ?? '', '.linkcode', 'daemon.db'));
  });

  it('forks every state path into the profile sibling directory', () => {
    process.env.LINKCODE_PROFILE = 'alpha';
    const root = join(process.env.HOME ?? '', '.linkcode-alpha');
    expect(daemonProfile()).toBe('alpha');
    expect(databasePath()).toBe(join(root, 'daemon.db'));
    expect(runtimeFilePath()).toBe(join(root, 'runtime.json'));
    expect(hqCredentialsPath()).toBe(join(root, 'hq.json'));
    expect(telemetryConfigCachePath()).toBe(join(root, 'telemetry-config.json'));
  });

  it('treats an empty LINKCODE_PROFILE as the default profile', () => {
    process.env.LINKCODE_PROFILE = '';
    expect(daemonProfile()).toBeUndefined();
    expect(databasePath()).toBe(join(process.env.HOME ?? '', '.linkcode', 'daemon.db'));
  });

  it('aborts on an invalid profile name instead of using the default universe', () => {
    process.env.LINKCODE_PROFILE = 'Not_Valid!';
    expect(() => daemonProfile()).toThrow(TypeError);
    expect(() => databasePath()).toThrow(TypeError);
  });

  it('rejects a path-traversal profile instead of resolving outside the home sibling', () => {
    process.env.LINKCODE_PROFILE = '../evil';
    expect(() => runtimeFilePath()).toThrow(TypeError);
    expect(() => databasePath()).toThrow(TypeError);
  });
});

// CODE-460: a local build must never land in the installed release's universe — that shared
// `~/.linkcode` is what let a dev daemon hold 19523 and serve a release client frames it drops.
describe('channel-scoped state paths', () => {
  it('forks the development channel into its own state directory', () => {
    process.env.LINKCODE_CHANNEL = 'development';
    const root = join(process.env.HOME ?? '', '.linkcode.development');
    expect(daemonChannel()).toBe('development');
    expect(databasePath()).toBe(join(root, 'daemon.db'));
    expect(runtimeFilePath()).toBe(join(root, 'runtime.json'));
    expect(hqCredentialsPath()).toBe(join(root, 'hq.json'));
    expect(telemetryConfigCachePath()).toBe(join(root, 'telemetry-config.json'));
  });

  it('composes the channel with a profile, dot before hyphen', () => {
    process.env.LINKCODE_CHANNEL = 'development';
    process.env.LINKCODE_PROFILE = 'alpha';
    expect(databasePath()).toBe(
      join(process.env.HOME ?? '', '.linkcode.development-alpha', 'daemon.db'),
    );
  });

  // The dot separator is what makes this impossible to express as a profile name, so a release
  // build can never be talked into the development directory by `--profile=development`.
  it('keeps a profile named after the channel out of the development directory', () => {
    process.env.LINKCODE_PROFILE = 'development';
    expect(databasePath()).toBe(join(process.env.HOME ?? '', '.linkcode-development', 'daemon.db'));
  });

  // The `channel` identity field cannot defend against a daemon released before it existed: that
  // peer's schema strips the unknown field and its profile-only comparison then reads a
  // development daemon as a double-start of itself. Disjoint ranges are what actually keep an
  // already-shipped release binary away from a development daemon's port.
  it('starts each channel in its own port range, with no overlap between them', () => {
    process.env.LINKCODE_CHANNEL = 'release';
    expect(loadConfig().listeners[0].port).toBe(DAEMON_DEFAULT_PORT);

    process.env.LINKCODE_CHANNEL = 'development';
    expect(loadConfig().listeners[0].port).toBe(DAEMON_DEFAULT_PORT + DAEMON_PORT_HUNT_SPAN);

    const releaseLastPort = daemonBasePort('release') + DAEMON_PORT_HUNT_SPAN - 1;
    expect(daemonBasePort('development')).toBeGreaterThan(releaseLastPort);
  });

  it('defaults to development when nothing is injected — an unstamped build is a working copy', () => {
    delete process.env.LINKCODE_CHANNEL;
    expect(daemonChannel()).toBe('development');
    expect(databasePath()).toBe(join(process.env.HOME ?? '', '.linkcode.development', 'daemon.db'));
  });

  it('aborts on an invalid channel instead of silently picking a universe', () => {
    process.env.LINKCODE_CHANNEL = 'prod';
    expect(() => daemonChannel()).toThrow(TypeError);
    expect(() => databasePath()).toThrow(TypeError);
  });

  it('lets an injected channel outrank the build stamp', () => {
    // The devshell pack ships a bundle stamped `release` inside a development shell.
    process.env.LINKCODE_BUILD_CHANNEL = 'release';
    process.env.LINKCODE_CHANNEL = 'development';
    try {
      expect(daemonChannel()).toBe('development');
    } finally {
      delete process.env.LINKCODE_BUILD_CHANNEL;
    }
  });
});

describe('loadConfig accounts', () => {
  it('keeps valid accounts and drops an invalid one, logging the error', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeAccountsConfig([
      validAccount,
      // Missing the api-key `key` — fails the credential union.
      { id: 'acc_2', label: 'Bad', credential: { type: 'api-key' }, createdAt: 0 },
    ]);

    const config = loadConfig();

    expect(config.accounts).toEqual([validAccount]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls back to an empty array when accounts is not an array', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeAccountsConfig({ not: 'an array' });

    const config = loadConfig();

    expect(config.accounts).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('defaults to an empty array without logging when accounts is absent', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeAccountsConfig(undefined);

    const config = loadConfig();

    expect(config.accounts).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('loadConfig custom MCP servers', () => {
  const validServer = {
    id: 'custom-1',
    enabled: true,
    server: {
      type: 'stdio',
      name: 'github',
      command: 'gh-mcp',
      env: { GITHUB_TOKEN: 'secret' },
    },
    createdAt: 1,
  } as const satisfies CustomMcpServer;

  function writeCustomMcpConfig(customMcpServers: unknown): void {
    const dir = join(process.env.HOME ?? '', '.linkcode');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ customMcpServers }));
  }

  it('keeps valid servers and drops an invalid one without blanking the rest', () => {
    const errorSpy = vi.spyOn(logger, 'warn').mockImplementation(noop);
    writeCustomMcpConfig([validServer, { id: 'broken', server: { type: 'stdio' } }]);

    const config = loadConfig();

    expect(config.customMcpServers).toEqual([validServer]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('round-trips through saveCustomMcpServers preserving other fields at mode 0600', () => {
    writeCustomMcpConfig([]);
    const path = join(process.env.HOME ?? '', '.linkcode', 'config.json');
    writeFileSync(path, JSON.stringify({ providers: {}, customMcpServers: [] }));

    saveCustomMcpServers([validServer]);

    const written: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(written).toEqual({ providers: {}, customMcpServers: [validServer] });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(loadConfig().customMcpServers).toEqual([validServer]);
  });
});
