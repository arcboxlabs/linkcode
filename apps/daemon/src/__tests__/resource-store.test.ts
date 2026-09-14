import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordSchema, SessionResourceSchema } from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import type { DaemonDatabase } from '../db/database';
import { openDaemonDatabase } from '../db/database';
import { createResourceStore } from '../resource-store';
import { createSessionStore } from '../session-store';

const temporaryDirectories: string[] = [];
const openDatabases = new Set<DaemonDatabase>();

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('SQLite resource store', () => {
  it('persists resources across store instances and deduplicates output locators', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'linkcode-resource-store-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'daemon.db');
    const database = openDaemonDatabase(databasePath);
    openDatabases.add(database);
    const sessions = createSessionStore(database.client);
    const session = SessionRecordSchema.parse({
      sessionId: 'session-resource-test',
      kind: 'codex',
      cwd: directory,
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 1,
      runs: [],
    });
    await sessions.save(session);
    const locatorKey = join(directory, 'report.pdf');
    const resource = SessionResourceSchema.parse({
      resourceId: 'resource-persisted',
      sessionId: session.sessionId,
      direction: 'output',
      name: 'report.pdf',
      kind: 'document',
      status: 'ready',
      locator: { type: 'workspace-file', path: locatorKey },
      createdAt: 2,
      updatedAt: 2,
    });

    const first = createResourceStore(databasePath);
    expect(await first.save(resource, locatorKey)).toBe(true);
    expect(await first.findByLocator(session.sessionId, locatorKey)).toEqual(resource);
    expect(
      await first.save(
        SessionResourceSchema.parse({ ...resource, resourceId: 'resource-duplicate' }),
        locatorKey,
      ),
    ).toBe(false);

    const sourceUrl = 'https://example.com/reference';
    const discoveredSource = SessionResourceSchema.parse({
      resourceId: 'resource-source',
      sessionId: session.sessionId,
      direction: 'source',
      name: 'Reference',
      kind: 'link',
      status: 'ready',
      locator: { type: 'url', url: sourceUrl },
      createdAt: 3,
      updatedAt: 3,
    });
    expect(await first.save(discoveredSource, sourceUrl)).toBe(true);
    const promotedOutput = SessionResourceSchema.parse({
      ...discoveredSource,
      direction: 'output',
      name: 'Published reference',
      updatedAt: 4,
    });
    expect(await first.save(promotedOutput, sourceUrl)).toBe(true);
    expect(await first.findByLocator(session.sessionId, sourceUrl)).toEqual(promotedOutput);

    const restarted = createResourceStore(databasePath);
    expect(await restarted.list(session.sessionId)).toEqual(
      expect.arrayContaining([resource, promotedOutput]),
    );
    await sessions.delete(session.sessionId);
    expect(await restarted.list(session.sessionId)).toEqual([]);
  });
});
