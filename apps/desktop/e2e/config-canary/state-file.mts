import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { asyncRetry } from 'foxts/async-retry';

const STORAGE_KEY = 'linkcode-config:v1:normal:acme:desktop:canary';
const EMERGENCY_STORAGE_KEY = 'linkcode-config:v1:emergency:acme:desktop';

export interface ConfigState {
  readonly highWater?: { readonly payloadSha256: string; readonly version: string };
  readonly lkg?: { readonly pointer: string; readonly snapshot: string };
  readonly trusted?: { readonly etag?: string; readonly pointer: string };
  readonly version: 1;
}

export interface ConfigStateFile {
  readonly raw: string;
  readonly value: ConfigState;
}

function statePath(home: string, storageKey: string): string {
  return join(
    home,
    '.config',
    'LinkCode Development',
    'config',
    `${Buffer.from(storageKey).toString('base64url')}.json`,
  );
}

export async function readConfigState(home: string): Promise<ConfigStateFile | null> {
  try {
    const raw = await readFile(statePath(home, STORAGE_KEY), 'utf8');
    return { raw, value: JSON.parse(raw) as ConfigState };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function readEmergencyState(home: string): Promise<ConfigStateFile | null> {
  try {
    const raw = await readFile(statePath(home, EMERGENCY_STORAGE_KEY), 'utf8');
    return { raw, value: JSON.parse(raw) as ConfigState };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function waitForConfigState(
  home: string,
  predicate: (state: ConfigStateFile) => boolean,
): Promise<ConfigStateFile> {
  return asyncRetry(
    async () => {
      const state = await readConfigState(home);
      if (!state || !predicate(state)) throw new Error('config state is not ready');
      return state;
    },
    {
      factor: 1,
      maxRetryTime: 30000,
      maxTimeout: 100,
      minTimeout: 100,
      retries: Number.POSITIVE_INFINITY,
    },
  );
}

export function writeCorruptConfigState(home: string): Promise<void> {
  return writeFile(statePath(home, STORAGE_KEY), '{"lkg":"corrupted', 'utf8');
}
